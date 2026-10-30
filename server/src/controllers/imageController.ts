import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import * as imageService from '../services/imageService';
import * as storageService from '../services/storageService';
import { enqueueValidation } from '../lib/queue';
import { addClient } from '../utils/sse';
import { NotFoundError, BadRequestError } from '../errors/AppError';

/**
 * Creates a new image upload session.
 * POST /api/sessions
 */
export async function createSession(_req: Request, res: Response): Promise<void> {
  const session = await prisma.uploadSession.create({
    data: {
      status: 'UPLOADING',
      totalImages: 0,
      acceptedCount: 0,
      rejectedCount: 0,
    },
  });

  res.status(201).json(session);
}

/**
 * Gets details of an upload session including all images and their validation results.
 * GET /api/sessions/:id
 */
export async function getSession(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const session = await prisma.uploadSession.findUnique({
    where: { id },
    include: {
      images: {
        include: {
          validationResults: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!session) {
    throw new NotFoundError(`Session with id ${id} not found`);
  }

  res.json(session);
}

/**
 * Uploads one or more images into a session.
 * POST /api/sessions/:id/images
 */
export async function uploadImages(req: Request, res: Response): Promise<void> {
  const { id: sessionId } = req.params;

  // Validate session exists
  const session = await prisma.uploadSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError(`Session with id ${sessionId} not found`);
  }

  // Get uploaded files from multer
  const files = req.files as Express.Multer.File[] | undefined;
  const singleFile = req.file;

  const uploadFiles: Express.Multer.File[] = [];
  if (Array.isArray(files) && files.length > 0) {
    uploadFiles.push(...files);
  } else if (singleFile) {
    uploadFiles.push(singleFile);
  }

  if (uploadFiles.length === 0) {
    throw new BadRequestError('No image files provided for upload');
  }

  const processedImages = [];

  for (const file of uploadFiles) {
    try {
      const imageRecord = await imageService.processAndStore(file, sessionId);
      processedImages.push(imageRecord);

      // Enqueue for async validation
      await enqueueValidation(imageRecord.id, sessionId);
    } catch (err: any) {
      console.error(`Failed to process upload for ${file.originalname}:`, err);
      // If error is BadRequestError (e.g. invalid format), continue or report
      throw err;
    }
  }

  // Update session status to PROCESSING
  await prisma.uploadSession.update({
    where: { id: sessionId },
    data: { status: 'PROCESSING' },
  });

  res.status(201).json({
    message: `Successfully uploaded ${processedImages.length} image(s)`,
    images: processedImages,
  });
}

/**
 * Lists all images for a session.
 * GET /api/sessions/:id/images
 */
export async function getSessionImages(req: Request, res: Response): Promise<void> {
  const { id: sessionId } = req.params;

  const images = await prisma.image.findMany({
    where: { sessionId },
    include: {
      validationResults: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(images);
}

/**
 * Gets a single image by ID.
 * GET /api/sessions/:id/images/:imageId
 */
export async function getImage(req: Request, res: Response): Promise<void> {
  const { id: sessionId, imageId } = req.params;

  const image = await prisma.image.findFirst({
    where: {
      id: imageId,
      sessionId,
    },
    include: {
      validationResults: true,
    },
  });

  if (!image) {
    throw new NotFoundError(`Image ${imageId} not found in session ${sessionId}`);
  }

  res.json(image);
}

/**
 * Deletes an image from storage and database.
 * DELETE /api/sessions/:id/images/:imageId
 */
export async function deleteImage(req: Request, res: Response): Promise<void> {
  const { id: sessionId, imageId } = req.params;

  const image = await prisma.image.findFirst({
    where: {
      id: imageId,
      sessionId,
    },
  });

  if (!image) {
    throw new NotFoundError(`Image ${imageId} not found in session ${sessionId}`);
  }

  await imageService.deleteImage(image);

  res.status(200).json({ message: 'Image deleted successfully', imageId });
}

/**
 * Streams real-time validation events to the client via SSE.
 * GET /api/sessions/:id/events
 */
export function streamEvents(req: Request, res: Response): void {
  const { id: sessionId } = req.params;
  addClient(sessionId, res);
}

/**
 * Streams an image file or thumbnail directly to the client.
 * GET /api/images/:id/file?thumbnail=true
 */
export async function serveImageFile(req: Request, res: Response): Promise<void> {
  const { id: imageId } = req.params;
  const isThumbnail = req.query.thumbnail === 'true';

  const image = await prisma.image.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    throw new NotFoundError(`Image ${imageId} not found`);
  }

  const keyToServe = isThumbnail && image.thumbnailKey ? image.thumbnailKey : image.storageKey;
  const contentType = isThumbnail ? 'image/jpeg' : image.mimeType;

  try {
    const stream = await storageService.getFileStream(keyToServe);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    stream.pipe(res);
  } catch (err: any) {
    res.status(404).json({ error: 'Image file not found in storage' });
  }
}
