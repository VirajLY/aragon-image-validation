import sharp from 'sharp';
import prisma from '../lib/prisma';
import * as storageService from './storageService';
import { publishEvent } from '../utils/sse';

export interface VariantDefinition {
  type: 'THUMBNAIL' | 'WEB' | 'FULL';
  maxDimension: number;
  quality: number;
  fit: keyof sharp.FitEnum;
}

export const VARIANT_DEFINITIONS: VariantDefinition[] = [
  {
    type: 'THUMBNAIL',
    maxDimension: 250,
    quality: 75,
    fit: 'cover',
  },
  {
    type: 'WEB',
    maxDimension: 1200,
    quality: 78,
    fit: 'inside',
  },
  {
    type: 'FULL',
    maxDimension: 2048,
    quality: 82,
    fit: 'inside',
  },
];

export interface VariantResultItem {
  type: string;
  storageKey: string;
  url: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  format: string;
}

export interface VariantGenerationResult {
  success: boolean;
  variants?: VariantResultItem[];
  error?: string;
}

/**
 * Service 3: Variant Generation Service
 * 
 * Produces multiple sized versions for different use cases (thumbnail, web, full).
 * - Generates all variants concurrently.
 * - Stores each to S3/storage under logical key structure.
 * - Writes/upserts resulting URLs and metadata to the database idempotently.
 * - Marks the image as READY once complete.
 */
export async function generateVariants(
  imageId: string,
  compressedKey?: string,
  simulateFailure = false
): Promise<VariantGenerationResult> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    throw new Error(`Image ${imageId} not found for variant generation`);
  }

  // Update status to GENERATING_VARIANTS
  await prisma.image.update({
    where: { id: imageId },
    data: {
      pipelineStatus: 'GENERATING_VARIANTS',
      pipelineStage: 'Variant Generation Service',
      pipelineError: null,
    },
  });

  await publishEvent(image.sessionId, 'pipeline:generating_variants', {
    imageId,
    stage: 'Variant Generation Service',
    status: 'GENERATING_VARIANTS',
  });

  try {
    if (simulateFailure) {
      throw new Error('Simulated variant generation failure: S3 upload timeout');
    }

    // 1. Fetch compressed source image (or fallback to original)
    const sourceKey = compressedKey || `compressed/${image.sessionId}/${imageId}/compressed.jpg`;
    let stream;
    try {
      stream = await storageService.getFileStream(sourceKey);
    } catch {
      stream = await storageService.getFileStream(image.storageKey);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const sourceBuffer = Buffer.concat(chunks);

    const sourceMeta = await sharp(sourceBuffer).metadata();
    const sourceWidth = sourceMeta.width ?? 0;
    const sourceHeight = sourceMeta.height ?? 0;

    // 2. Generate variants in parallel
    const generatedVariants: VariantResultItem[] = await Promise.all(
      VARIANT_DEFINITIONS.map(async (def) => {
        let variantBuffer: Buffer;

        if (def.type === 'FULL' && sourceWidth <= def.maxDimension && sourceHeight <= def.maxDimension) {
          // If the source image is already within FULL dimension bounds, use the compressed master directly
          variantBuffer = sourceBuffer;
        } else {
          let pipeline = sharp(sourceBuffer);

          if (def.type === 'THUMBNAIL') {
            pipeline = pipeline.resize(def.maxDimension, def.maxDimension, {
              fit: def.fit,
              position: 'center',
            });
          } else {
            pipeline = pipeline.resize(def.maxDimension, def.maxDimension, {
              fit: def.fit,
              withoutEnlargement: true,
            });
          }

          variantBuffer = await pipeline
            .jpeg({ quality: def.quality, progressive: true, mozjpeg: true })
            .toBuffer();
        }

        const meta = await sharp(variantBuffer).metadata();
        const width = meta.width ?? 0;
        const height = meta.height ?? 0;
        const fileSizeBytes = variantBuffer.length;

        // Logical S3 key structure
        const storageKey = `variants/${image.sessionId}/${imageId}/${def.type.toLowerCase()}.jpg`;
        await storageService.uploadFile(storageKey, variantBuffer, 'image/jpeg');

        const url = await storageService.getFileUrl(storageKey);

        // Idempotent upsert into database (prevents duplicate records on reprocessing)
        await prisma.imageVariant.upsert({
          where: {
            imageId_type: {
              imageId,
              type: def.type,
            },
          },
          create: {
            imageId,
            type: def.type,
            storageKey,
            url,
            width,
            height,
            fileSizeBytes,
            format: 'jpeg',
          },
          update: {
            storageKey,
            url,
            width,
            height,
            fileSizeBytes,
            format: 'jpeg',
            updatedAt: new Date(),
          },
        });

        return {
          type: def.type,
          storageKey,
          url,
          width,
          height,
          fileSizeBytes,
          format: 'jpeg',
        };
      })
    );

    // 3. Mark image pipeline as READY
    await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStatus: 'READY',
        pipelineStage: 'Completed',
        pipelineError: null,
      },
    });

    console.log(
      `✅ [Variant Generation Service] Image ${imageId}: Generated ${generatedVariants.length} variants (THUMBNAIL, WEB, FULL)`
    );

    await publishEvent(image.sessionId, 'pipeline:ready', {
      imageId,
      stage: 'Completed',
      status: 'READY',
      variants: generatedVariants,
      metrics: {
        originalSize: image.originalSize,
        compressedSize: image.compressedSize,
        compressionRatio: image.compressionRatio,
      },
    });

    return {
      success: true,
      variants: generatedVariants,
    };
  } catch (err: any) {
    const errorMsg = err.message || 'Variant generation failed';
    console.error(`❌ [Variant Generation Service] Image ${imageId} failed:`, errorMsg);

    await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStatus: 'FAILED',
        pipelineStage: 'Variant Generation Service',
        pipelineError: `Variant generation failed: ${errorMsg}`,
      },
    });

    await publishEvent(image.sessionId, 'pipeline:failed', {
      imageId,
      stage: 'Variant Generation Service',
      status: 'FAILED',
      error: `Variant generation failed: ${errorMsg}`,
    });

    return {
      success: false,
      error: errorMsg,
    };
  }
}
