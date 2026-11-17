import sharp from 'sharp';
import prisma from '../lib/prisma';
import * as storageService from './storageService';
import { publishEvent } from '../utils/sse';

export interface CompressionResult {
  success: boolean;
  compressedBuffer?: Buffer;
  storageKey?: string;
  originalSize?: number;
  compressedSize?: number;
  compressionRatio?: number;
  error?: string;
}

/**
 * Service 2: Compression Service
 * 
 * Reduces file size while maintaining high perceptual quality.
 * - Uses mozjpeg compression with progressive scan and trellis quantization.
 * - Tracks original size, compressed size, and compression ratio.
 * - Stores compressed asset to storage and updates database metrics.
 */
export async function compressImage(
  imageId: string,
  convertedKey?: string,
  simulateFailure = false
): Promise<CompressionResult> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    throw new Error(`Image ${imageId} not found for compression`);
  }

  // Update status to COMPRESSING
  await prisma.image.update({
    where: { id: imageId },
    data: {
      pipelineStatus: 'COMPRESSING',
      pipelineStage: 'Compression Service',
      pipelineError: null,
    },
  });

  await publishEvent(image.sessionId, 'pipeline:compressing', {
    imageId,
    stage: 'Compression Service',
    status: 'COMPRESSING',
  });

  try {
    if (simulateFailure) {
      throw new Error('Simulated compression failure: encoder memory exhaustion');
    }

    // 1. Fetch input image (converted normalized image or original)
    const sourceKey = convertedKey || `converted/${image.sessionId}/${imageId}/normalized.jpg`;
    let stream;
    try {
      stream = await storageService.getFileStream(sourceKey);
    } catch {
      // Fallback to original storageKey if normalized not found
      stream = await storageService.getFileStream(image.storageKey);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const inputBuffer = Buffer.concat(chunks);
    // True original size from the uploaded file on disk, falling back to input buffer
    const originalSize = image.fileSizeBytes || inputBuffer.length;

    // 2. Compress with Sharp using MozJPEG configuration
    // Quality 82 provides 40-70% file size reduction with virtually imperceptible difference
    const compressedBuffer = await sharp(inputBuffer)
      .jpeg({
        quality: 82,
        progressive: true,
        mozjpeg: true,
        trellisQuantisation: true,
        overshootDeringing: true,
      })
      .toBuffer();

    const compressedSize = compressedBuffer.length;
    // Calculate percentage reduction: e.g. 100KB -> 40KB is 60% reduction
    const rawRatio = ((originalSize - compressedSize) / originalSize) * 100;
    const compressionRatio = Math.max(0, Math.round(rawRatio * 10) / 10);

    // 3. Store compressed image under logical key
    const compressedKey = `compressed/${image.sessionId}/${imageId}/compressed.jpg`;
    await storageService.uploadFile(compressedKey, compressedBuffer, 'image/jpeg');

    // 4. Update database metrics
    await prisma.image.update({
      where: { id: imageId },
      data: {
        originalSize,
        compressedSize,
        compressionRatio,
      },
    });

    console.log(
      `✅ [Compression Service] Image ${imageId}: ${(originalSize / 1024).toFixed(1)}KB -> ${(compressedSize / 1024).toFixed(1)}KB (saved ${compressionRatio}%)`
    );

    return {
      success: true,
      compressedBuffer,
      storageKey: compressedKey,
      originalSize,
      compressedSize,
      compressionRatio,
    };
  } catch (err: any) {
    const errorMsg = err.message || 'Image compression failed';
    console.error(`❌ [Compression Service] Image ${imageId} failed:`, errorMsg);

    await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStatus: 'FAILED',
        pipelineStage: 'Compression Service',
        pipelineError: `Compression failed: ${errorMsg}`,
      },
    });

    await publishEvent(image.sessionId, 'pipeline:failed', {
      imageId,
      stage: 'Compression Service',
      status: 'FAILED',
      error: `Compression failed: ${errorMsg}`,
    });

    return {
      success: false,
      error: errorMsg,
    };
  }
}
