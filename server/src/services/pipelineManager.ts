import { Queue, Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import prisma from '../lib/prisma';
import { convertImage } from './conversionService';
import { compressImage } from './compressionService';
import { generateVariants } from './variantService';

export interface PipelineJobData {
  imageId: string;
  simulateFailure?: 'conversion' | 'compression' | 'variant';
}

let conversionQueue: Queue<PipelineJobData> | null = null;
let compressionQueue: Queue<PipelineJobData> | null = null;
let variantQueue: Queue<PipelineJobData> | null = null;

let isRedisOperational = false;

redis.on('ready', () => {
  isRedisOperational = true;
});

redis.on('error', () => {
  isRedisOperational = false;
});

/**
 * Initializes BullMQ Queues for the 3 decoupled stages if Redis is available.
 */
export function getPipelineQueues() {
  if (!isRedisOperational) return null;

  try {
    if (!conversionQueue) {
      conversionQueue = new Queue('media-conversion', { connection: redis });
    }
    if (!compressionQueue) {
      compressionQueue = new Queue('media-compression', { connection: redis });
    }
    if (!variantQueue) {
      variantQueue = new Queue('media-variant-generation', { connection: redis });
    }
    return { conversionQueue, compressionQueue, variantQueue };
  } catch {
    return null;
  }
}

/**
 * Asynchronous in-process pipeline executor for zero-dependency local execution.
 * Executes the 3 stages sequentially while isolating state and catching errors at each stage.
 */
async function executeLocalPipeline(
  imageId: string,
  simulateFailure?: 'conversion' | 'compression' | 'variant'
): Promise<void> {
  console.log(`🚀 [Pipeline Manager] Starting media processing pipeline for image ${imageId}`);

  // Stage 1: Conversion Service
  const conversionResult = await convertImage(
    imageId,
    simulateFailure === 'conversion'
  );
  if (!conversionResult.success) {
    console.warn(`🛑 [Pipeline Manager] Pipeline halted at Stage 1 (Conversion) for image ${imageId}`);
    return;
  }

  // Stage 2: Compression Service
  const compressionResult = await compressImage(
    imageId,
    conversionResult.storageKey,
    simulateFailure === 'compression'
  );
  if (!compressionResult.success) {
    console.warn(`🛑 [Pipeline Manager] Pipeline halted at Stage 2 (Compression) for image ${imageId}`);
    return;
  }

  // Stage 3: Variant Generation Service
  const variantResult = await generateVariants(
    imageId,
    compressionResult.storageKey,
    simulateFailure === 'variant'
  );
  if (!variantResult.success) {
    console.warn(`🛑 [Pipeline Manager] Pipeline halted at Stage 3 (Variant Generation) for image ${imageId}`);
    return;
  }

  console.log(`🎉 [Pipeline Manager] Media processing pipeline completed successfully for image ${imageId}`);
}

/**
 * Starts the media processing pipeline for an image.
 * Uses BullMQ if Redis is running, or falls back to async background runner.
 */
export async function startPipeline(
  imageId: string,
  options?: { simulateFailure?: 'conversion' | 'compression' | 'variant' }
): Promise<void> {
  const queues = getPipelineQueues();

  if (queues && isRedisOperational) {
    try {
      await queues.conversionQueue.add('convert', {
        imageId,
        simulateFailure: options?.simulateFailure,
      });
      return;
    } catch (err) {
      console.warn('Queue.add failed, executing in background:', err);
    }
  }

  // Non-blocking background execution
  setTimeout(() => {
    executeLocalPipeline(imageId, options?.simulateFailure).catch((err) => {
      console.error(`Pipeline execution unhandled error for ${imageId}:`, err);
    });
  }, 50);
}

/**
 * Reprocesses an image through the media processing pipeline.
 * Fully idempotent: clears existing error, resets status to PENDING, and re-runs.
 * Variants are safely updated in-place via database upsert without corrupting state.
 */
export async function reprocessImage(
  imageId: string,
  options?: { simulateFailure?: 'conversion' | 'compression' | 'variant' }
): Promise<{ success: boolean; message: string }> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    throw new Error(`Image ${imageId} not found`);
  }

  console.log(`🔄 [Pipeline Manager] Initiating idempotent reprocessing for image ${imageId}`);

  // Reset status to PENDING and clear previous error
  await prisma.image.update({
    where: { id: imageId },
    data: {
      pipelineStatus: 'PENDING',
      pipelineStage: 'Queued for Reprocessing',
      pipelineError: null,
    },
  });

  // Re-enqueue the pipeline
  await startPipeline(imageId, options);

  return {
    success: true,
    message: `Reprocessing initiated for image ${imageId}`,
  };
}

/**
 * Creates BullMQ workers for all 3 decoupled pipeline services when running with Redis.
 */
export function initPipelineWorkers() {
  if (!isRedisOperational) return null;

  try {
    // Worker 1: Conversion Service
    const conversionWorker = new Worker<PipelineJobData>(
      'media-conversion',
      async (job: Job<PipelineJobData>) => {
        const { imageId, simulateFailure } = job.data;
        const res = await convertImage(imageId, simulateFailure === 'conversion');
        if (res.success && compressionQueue) {
          await compressionQueue.add('compress', { imageId, simulateFailure });
        }
      },
      { connection: redis, concurrency: 3 }
    );

    // Worker 2: Compression Service
    const compressionWorker = new Worker<PipelineJobData>(
      'media-compression',
      async (job: Job<PipelineJobData>) => {
        const { imageId, simulateFailure } = job.data;
        const res = await compressImage(imageId, undefined, simulateFailure === 'compression');
        if (res.success && variantQueue) {
          await variantQueue.add('generate-variants', { imageId, simulateFailure });
        }
      },
      { connection: redis, concurrency: 3 }
    );

    // Worker 3: Variant Generation Service
    const variantWorker = new Worker<PipelineJobData>(
      'media-variant-generation',
      async (job: Job<PipelineJobData>) => {
        const { imageId, simulateFailure } = job.data;
        await generateVariants(imageId, undefined, simulateFailure === 'variant');
      },
      { connection: redis, concurrency: 5 }
    );

    console.log('✅ BullMQ Media Processing Workers initialized (Conversion, Compression, Variant Generation)');

    return { conversionWorker, compressionWorker, variantWorker };
  } catch (err: any) {
    console.warn('BullMQ pipeline workers could not be initialized:', err.message);
    return null;
  }
}
