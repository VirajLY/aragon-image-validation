import sharp from 'sharp';
// @ts-ignore
import heicDecode from 'heic-decode';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import prisma from '../lib/prisma';
import * as storageService from './storageService';
import { computePerceptualHash } from '../utils/similarity';
import { BadRequestError } from '../errors/AppError';
import type { Image } from '@prisma/client';

/** Allowed MIME types for upload. */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]);

/** Thumbnail width in pixels. */
const THUMBNAIL_WIDTH = 200;

/**
 * Detects the actual MIME type of a buffer by reading magic bytes.
 * Falls back to the provided MIME type if detection fails.
 *
 * @param buffer - The file buffer
 * @param fallbackMime - The declared MIME type from the upload
 * @returns The detected or fallback MIME type
 */
async function detectMimeType(buffer: Buffer, fallbackMime: string): Promise<string> {
  // Dynamic import for ESM-only file-type package
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);
  return detected?.mime ?? fallbackMime;
}

/**
 * Processes an uploaded file: validates, converts if needed, generates thumbnail,
 * computes perceptual hash, uploads to storage, and saves to database.
 *
 * @param file - The multer file object
 * @param sessionId - The upload session ID
 * @returns The created Image record
 */
export async function processAndStore(
  file: Express.Multer.File,
  sessionId: string
): Promise<Image> {
  // 1. Validate MIME type via magic bytes
  const detectedMime = await detectMimeType(file.buffer, file.mimetype);

  if (!ALLOWED_MIME_TYPES.has(detectedMime)) {
    throw new BadRequestError(
      `Unsupported file type: ${detectedMime}. Accepted: JPEG, PNG, HEIC.`
    );
  }

  let processedBuffer = file.buffer;
  let finalMime = detectedMime;

  // 2. Convert HEIC/HEIF to JPEG
  if (
    detectedMime === 'image/heic' ||
    detectedMime === 'image/heif' ||
    file.originalname.toLowerCase().endsWith('.heic') ||
    file.originalname.toLowerCase().endsWith('.heif')
  ) {
    try {
      processedBuffer = await sharp(file.buffer).jpeg({ quality: 90 }).toBuffer();
    } catch {
      try {
        const { data, width: w, height: h } = await heicDecode({ buffer: file.buffer });
        processedBuffer = await sharp(Buffer.from(data), {
          raw: { width: w, height: h, channels: 4 },
        })
          .jpeg({ quality: 90 })
          .toBuffer();
      } catch (heicErr: any) {
        throw new BadRequestError(`Failed to decode HEIC file: ${heicErr.message || 'corrupt bitstream'}`);
      }
    }
    finalMime = 'image/jpeg';
  }

  // 3. Get image metadata (width, height)
  const metadata = await sharp(processedBuffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  // 4. Generate thumbnail (200px wide, maintain aspect ratio)
  const thumbnailBuffer = await sharp(processedBuffer)
    .resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  // 5. Compute perceptual hash
  const perceptualHash = await computePerceptualHash(processedBuffer);

  // 6. Generate storage keys
  const imageId = uuidv4();
  const ext = finalMime === 'image/png' ? '.png' : '.jpg';
  const storageKey = `${sessionId}/${imageId}/original${ext}`;
  const thumbnailKey = `${sessionId}/${imageId}/thumbnail.jpg`;

  // 7. Upload original + thumbnail to MinIO
  await Promise.all([
    storageService.uploadFile(storageKey, processedBuffer, finalMime),
    storageService.uploadFile(thumbnailKey, thumbnailBuffer, 'image/jpeg'),
  ]);

  // 8. Save image record to database and increment session count
  const image = await prisma.$transaction(async (tx) => {
    const img = await tx.image.create({
      data: {
        id: imageId,
        sessionId,
        originalFilename: file.originalname,
        storageKey,
        thumbnailKey,
        mimeType: finalMime,
        fileSizeBytes: file.size,
        width,
        height,
        perceptualHash,
        status: 'PENDING',
      },
    });

    await tx.uploadSession.update({
      where: { id: sessionId },
      data: { totalImages: { increment: 1 } },
    });

    return img;
  });

  return image;
}

/**
 * Retrieves an image record by ID with optional validation results.
 *
 * @param imageId - The image UUID
 * @param includeValidation - Whether to include validation results
 * @returns The image record or null
 */
export async function getImageById(
  imageId: string,
  includeValidation = false
): Promise<Image | null> {
  return prisma.image.findUnique({
    where: { id: imageId },
    include: includeValidation ? { validationResults: true } : undefined,
  });
}

/**
 * Deletes an image from storage and database.
 *
 * @param image - The image record to delete
 */
export async function deleteImage(image: Image): Promise<void> {
  // Delete from storage
  const deletePromises = [storageService.deleteFile(image.storageKey)];
  if (image.thumbnailKey) {
    deletePromises.push(storageService.deleteFile(image.thumbnailKey));
  }
  await Promise.all(deletePromises);

  // Delete from database and decrement session counts
  await prisma.$transaction(async (tx) => {
    await tx.image.delete({ where: { id: image.id } });

    const decrements: Record<string, { decrement: number }> = {
      totalImages: { decrement: 1 },
    };

    if (image.status === 'ACCEPTED') {
      decrements.acceptedCount = { decrement: 1 };
    } else if (image.status === 'REJECTED') {
      decrements.rejectedCount = { decrement: 1 };
    }

    await tx.uploadSession.update({
      where: { id: image.sessionId },
      data: decrements,
    });
  });
}
