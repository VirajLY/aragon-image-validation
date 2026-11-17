import sharp from 'sharp';
// @ts-ignore
import heicDecode from 'heic-decode';
import prisma from '../lib/prisma';
import * as storageService from './storageService';
import { publishEvent } from '../utils/sse';

export interface ConversionResult {
  success: boolean;
  convertedBuffer?: Buffer;
  storageKey?: string;
  format?: string;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Service 1: Conversion Service
 * 
 * Normalizes incoming images into a consistent format (JPEG).
 * - Converts HEIC/HEIF to JPEG.
 * - Auto-orients image based on EXIF.
 * - Converts to sRGB colorspace.
 * - On failure, records the reason in the database and stops cleanly.
 */
export async function convertImage(
  imageId: string,
  simulateFailure = false
): Promise<ConversionResult> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    throw new Error(`Image ${imageId} not found for conversion`);
  }

  // Update status to CONVERTING
  await prisma.image.update({
    where: { id: imageId },
    data: {
      pipelineStatus: 'CONVERTING',
      pipelineStage: 'Conversion Service',
      pipelineError: null,
    },
  });

  await publishEvent(image.sessionId, 'pipeline:converting', {
    imageId,
    stage: 'Conversion Service',
    status: 'CONVERTING',
  });

  try {
    if (simulateFailure) {
      throw new Error('Simulated conversion failure: corrupt image bitstream');
    }

    // 1. Fetch raw image from storage
    const stream = await storageService.getFileStream(image.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBuffer = Buffer.concat(chunks);

    if (rawBuffer.length === 0) {
      throw new Error('Retrieved image buffer is empty');
    }

    // 2. Normalize image into standard JPEG
    // - Explicitly handles HEIC/HEIF -> JPEG (via Sharp native libheif or heic-decode fallback)
    // - .rotate() auto-rotates based on EXIF orientation
    // - .toColorspace('srgb') normalizes color profile
    // - .jpeg({ quality: 95, mozjpeg: true }) ensures high fidelity baseline
    const isHeic =
      image.mimeType === 'image/heic' ||
      image.mimeType === 'image/heif' ||
      image.originalFilename.toLowerCase().endsWith('.heic') ||
      image.originalFilename.toLowerCase().endsWith('.heif') ||
      rawBuffer.slice(4, 12).toString().includes('ftypheic') ||
      rawBuffer.slice(4, 12).toString().includes('ftypmif1');

    let normalizedBuffer: Buffer;

    try {
      normalizedBuffer = await sharp(rawBuffer, { failOn: 'none' })
        .rotate()
        .toColorspace('srgb')
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
    } catch (sharpErr: any) {
      if (isHeic) {
        console.log(`ℹ️ [Conversion Service] Decoding HEIC/HEIF via heic-decode for image ${imageId}`);
        try {
          const { data, width, height } = await heicDecode({ buffer: rawBuffer });
          normalizedBuffer = await sharp(Buffer.from(data), {
            raw: { width, height, channels: 4 },
          })
            .rotate()
            .toColorspace('srgb')
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer();
        } catch (heicErr: any) {
          throw new Error(`HEIC decoding failed: ${heicErr.message || 'corrupt or unsupported HEIC file'}`);
        }
      } else {
        throw sharpErr;
      }
    }

    const metadata = await sharp(normalizedBuffer).metadata();
    const width = metadata.width ?? image.width ?? 0;
    const height = metadata.height ?? image.height ?? 0;

    // 3. Store normalized image in storage under logical key
    const convertedKey = `converted/${image.sessionId}/${imageId}/normalized.jpg`;
    await storageService.uploadFile(convertedKey, normalizedBuffer, 'image/jpeg');

    // 4. Update database record
    await prisma.image.update({
      where: { id: imageId },
      data: {
        convertedFormat: 'jpeg',
        width,
        height,
      },
    });

    console.log(`✅ [Conversion Service] Image ${imageId} converted to JPEG (${width}x${height})`);

    return {
      success: true,
      convertedBuffer: normalizedBuffer,
      storageKey: convertedKey,
      format: 'jpeg',
      width,
      height,
    };
  } catch (err: any) {
    const errorMsg = err.message || 'Image conversion failed';
    console.error(`❌ [Conversion Service] Image ${imageId} failed:`, errorMsg);

    // Write failure reason to DB and stop cleanly
    await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStatus: 'FAILED',
        pipelineStage: 'Conversion Service',
        pipelineError: `Conversion failed: ${errorMsg}`,
      },
    });

    await publishEvent(image.sessionId, 'pipeline:failed', {
      imageId,
      stage: 'Conversion Service',
      status: 'FAILED',
      error: `Conversion failed: ${errorMsg}`,
    });

    return {
      success: false,
      error: errorMsg,
    };
  }
}
