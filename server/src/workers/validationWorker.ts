import { Worker, Job, Queue } from 'bullmq';
import prisma from '../lib/prisma';
import { redis } from '../lib/redis';
import * as storageService from '../services/storageService';
import * as validationService from '../services/validationService';
import { startPipeline } from '../services/pipelineManager';
import { publishEvent } from '../utils/sse';

export type ValidationRule =
  | 'FORMAT'
  | 'SIZE'
  | 'RESOLUTION'
  | 'BLUR'
  | 'FACE_TOO_SMALL'
  | 'MULTIPLE_FACES'
  | 'NO_FACE'
  | 'SIMILARITY';

export interface ValidationJobData {
  imageId: string;
  sessionId: string;
}

interface ValidationExecution {
  rule: ValidationRule;
  execute: () => Promise<validationService.ValidationRuleResult>;
}

let queueInstance: Queue<ValidationJobData> | null = null;
let workerInstance: Worker<ValidationJobData> | null = null;
let isRedisOperational = false;

redis.on('ready', () => {
  isRedisOperational = true;
});

redis.on('error', () => {
  isRedisOperational = false;
});

export function getValidationQueue(): Queue<ValidationJobData> | null {
  if (queueInstance) return queueInstance;
  try {
    queueInstance = new Queue<ValidationJobData>('image-validation', {
      connection: redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    return queueInstance;
  } catch {
    return null;
  }
}

/**
 * Runs the complete validation pipeline for an image.
 */
export async function processValidationJob(imageId: string, sessionId: string): Promise<void> {
  console.log(`🔍 Processing validation for image ${imageId}`);

  const image = await prisma.image.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    console.warn(`Image ${imageId} not found — skipping validation`);
    return;
  }

  // Update status to PROCESSING
  await prisma.image.update({
    where: { id: imageId },
    data: { status: 'PROCESSING' },
  });

  await publishEvent(sessionId, 'image:processing', {
    imageId,
    status: 'PROCESSING',
  });

  // Fetch the image buffer from storage
  let imageBuffer: Buffer;
  try {
    const stream = await storageService.getFileStream(image.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    imageBuffer = Buffer.concat(chunks);
  } catch (err) {
    console.error(`Failed to fetch image ${imageId} from storage:`, err);
    await prisma.image.update({
      where: { id: imageId },
      data: {
        status: 'REJECTED',
        rejectionReason: 'Failed to retrieve image from storage',
      },
    });
    await publishEvent(sessionId, 'image:rejected', {
      imageId,
      status: 'REJECTED',
      rejectionReason: 'Failed to retrieve image from storage',
    });
    return;
  }

  // Pre-detect faces once for both face count, size, and face blur checks
  const detectedFaces = await validationService.detectFaces(imageBuffer);

  // Ordered validation pipeline prioritizing primary structural issues:
  // 1. Format (PNG/JPG/HEIC)
  // 2. Size & Resolution (min 512x512, 50KB)
  // 3. Face Count (Multiple faces / No face) -> Rule 6
  // 4. Face Size (Face too small / far away) -> Rule 5
  // 5. Blur Detection (Blurry face) -> Rule 4
  // 6. Similarity Detection (Duplicates) -> Rule 3
  const validations: ValidationExecution[] = [
    {
      rule: 'FORMAT',
      execute: () => Promise.resolve(validationService.formatCheck(image.mimeType)),
    },
    {
      rule: 'NO_FACE',
      execute: () => validationService.faceCountCheck(imageBuffer, detectedFaces),
    },
    {
      rule: 'FACE_TOO_SMALL',
      execute: () =>
        validationService.faceSizeCheck(
          imageBuffer,
          image.width ?? 0,
          image.height ?? 0,
          detectedFaces
        ),
    },
    {
      rule: 'SIZE',
      execute: () =>
        Promise.resolve(
          validationService.sizeCheck(
            image.fileSizeBytes,
            image.width,
            image.height
          )
        ),
    },
    {
      rule: 'BLUR',
      execute: () => validationService.blurCheck(imageBuffer, detectedFaces),
    },
    {
      rule: 'SIMILARITY',
      execute: () =>
        validationService.similarityCheck(
          image.perceptualHash,
          sessionId,
          imageId
        ),
    },
  ];

  let allPassed = true;
  let rejectionReason: string | null = null;

  for (const validation of validations) {
    try {
      const result = await validation.execute();

      await prisma.validationResult.create({
        data: {
          imageId,
          rule: validation.rule,
          passed: result.passed,
          message: result.message,
          metadata: result.metadata
            ? typeof result.metadata === 'string'
              ? result.metadata
              : JSON.stringify(result.metadata)
            : undefined,
        },
      });

      if (!result.passed) {
        allPassed = false;
        // The first failing check sets the primary user-facing rejection reason
        if (!rejectionReason) {
          rejectionReason = result.message;
        }
      }

      await publishEvent(sessionId, 'validation:result', {
        imageId,
        rule: validation.rule,
        passed: result.passed,
        message: result.message,
      });
    } catch (err) {
      console.error(`Validation rule ${validation.rule} error for image ${imageId}:`, err);
      allPassed = false;
      if (!rejectionReason) {
        rejectionReason = `${validation.rule} validation failed`;
      }
    }
  }

  const finalStatus = allPassed ? 'ACCEPTED' : 'REJECTED';

  await prisma.image.update({
    where: { id: imageId },
    data: {
      status: finalStatus,
      rejectionReason: allPassed ? null : rejectionReason,
    },
  });

  if (allPassed) {
    await prisma.uploadSession.update({
      where: { id: sessionId },
      data: { acceptedCount: { increment: 1 } },
    });

    // Enter media processing pipeline automatically upon passing validation
    await startPipeline(imageId);
  } else {
    await prisma.uploadSession.update({
      where: { id: sessionId },
      data: { rejectedCount: { increment: 1 } },
    });
  }

  const session = await prisma.uploadSession.findUnique({
    where: { id: sessionId },
  });

  if (session) {
    const totalProcessed = session.acceptedCount + session.rejectedCount;
    if (totalProcessed >= session.totalImages && session.totalImages > 0) {
      await prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED' },
      });
      await publishEvent(sessionId, 'session:completed', {
        sessionId,
        totalImages: session.totalImages,
        acceptedCount: session.acceptedCount,
        rejectedCount: session.rejectedCount,
      });
    }
  }

  await publishEvent(sessionId, 'image:validated', {
    imageId,
    status: finalStatus,
    rejectionReason: allPassed ? null : rejectionReason,
  });

  await publishEvent(sessionId, `image:${finalStatus.toLowerCase()}`, {
    imageId,
    status: finalStatus,
    rejectionReason: allPassed ? null : rejectionReason,
  });

  console.log(`✅ Image ${imageId} validation complete: ${finalStatus} (${rejectionReason || 'Passed'})`);
}

export async function enqueueValidation(imageId: string, sessionId: string): Promise<void> {
  const queue = getValidationQueue();
  if (queue && isRedisOperational) {
    try {
      await queue.add('validate', { imageId, sessionId });
      return;
    } catch {
      // fallback
    }
  }

  setTimeout(() => {
    processValidationJob(imageId, sessionId).catch((err) => {
      console.error(`Background validation error for ${imageId}:`, err);
    });
  }, 100);
}

export function createValidationWorker(): Worker<ValidationJobData> | null {
  try {
    workerInstance = new Worker<ValidationJobData>(
      'image-validation',
      async (job: Job<ValidationJobData>) => {
        await processValidationJob(job.data.imageId, job.data.sessionId);
      },
      {
        connection: redis,
        concurrency: 3,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      }
    );
    return workerInstance;
  } catch {
    return null;
  }
}
