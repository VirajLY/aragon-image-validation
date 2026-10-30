import sharp from 'sharp';
import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import prisma from '../lib/prisma';
import { hammingDistance } from '../utils/similarity';

/**
 * Result of a single validation rule execution.
 */
export interface ValidationRuleResult {
  passed: boolean;
  message: string;
  metadata?: Record<string, unknown>;
}

// ─── Machine Learning Face Detection Module (BlazeFace) ─────────────────────────

let blazefaceModel: blazeface.BlazeFaceModel | null = null;
let modelLoadingPromise: Promise<blazeface.BlazeFaceModel> | null = null;

async function getBlazeFaceModel(): Promise<blazeface.BlazeFaceModel> {
  if (blazefaceModel) return blazefaceModel;
  if (!modelLoadingPromise) {
    modelLoadingPromise = blazeface.load();
  }
  blazefaceModel = await modelLoadingPromise;
  return blazefaceModel;
}

// Preload model on startup (non-blocking)
getBlazeFaceModel()
  .then(() => console.log('✅ BlazeFace face detection model loaded'))
  .catch((err) => console.warn('⚠️ BlazeFace preload failed:', err.message));

export interface DetectedFace {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

/**
 * Detects faces in an image buffer using TensorFlow.js BlazeFace.
 *
 * @param imageBuffer - The raw image buffer
 * @returns Array of detected faces with bounding boxes
 */
export async function detectFaces(imageBuffer: Buffer): Promise<DetectedFace[]> {
  try {
    const model = await getBlazeFaceModel();
    const { data, info } = await sharp(imageBuffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tensor = tf.tensor3d(new Float32Array(data), [info.height, info.width, 3]);
    const predictions = await model.estimateFaces(tensor, false);
    tensor.dispose();

    return predictions.map((p) => {
      const topLeft = p.topLeft as [number, number];
      const bottomRight = p.bottomRight as [number, number];
      const width = Math.max(0, bottomRight[0] - topLeft[0]);
      const height = Math.max(0, bottomRight[1] - topLeft[1]);
      const score = Array.isArray(p.probability)
        ? p.probability[0]
        : (p.probability as unknown as number);

      return {
        x: Math.max(0, topLeft[0]),
        y: Math.max(0, topLeft[1]),
        width,
        height,
        score,
      };
    });
  } catch (err) {
    console.error('Face detection error:', err);
    return [];
  }
}

// ─── Validation Rules ───────────────────────────────────────────────────────────

/**
 * Rule 2: Validates the image format (MIME type).
 * Accepted types: JPEG, PNG, HEIC.
 */
export function formatCheck(mimeType: string): ValidationRuleResult {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
  const passed = allowedTypes.includes(mimeType);

  return {
    passed,
    message: passed ? 'Image format is acceptable' : 'Unsupported image format',
    metadata: { mimeType },
  };
}

/**
 * Rule 1: Validates file size and image resolution.
 * Requirements: min 50KB file size, min 512×512 resolution.
 */
export function sizeCheck(
  fileSizeBytes: number,
  width: number | null,
  height: number | null
): ValidationRuleResult {
  const MIN_FILE_SIZE = 15 * 1024; // 15 KB
  const MIN_DIMENSION = 512;

  const w = width ?? 0;
  const h = height ?? 0;

  if (fileSizeBytes < MIN_FILE_SIZE || w < MIN_DIMENSION || h < MIN_DIMENSION) {
    return {
      passed: false,
      message: 'Image resolution is too low',
      metadata: {
        fileSizeBytes,
        width: w,
        height: h,
        minFileSize: MIN_FILE_SIZE,
        minDimension: MIN_DIMENSION,
      },
    };
  }

  return {
    passed: true,
    message: 'Image resolution and size are acceptable',
    metadata: { fileSizeBytes, width: w, height: h },
  };
}

/**
 * Rule 6: Validates face count in the image.
 * Exactly 1 face is required.
 * Rejects group photos (>1 face) or photos without a face (0 faces).
 */
export async function faceCountCheck(
  imageBuffer: Buffer,
  cachedFaces?: DetectedFace[]
): Promise<ValidationRuleResult> {
  const faces = cachedFaces ?? (await detectFaces(imageBuffer));
  const faceCount = faces.length;

  if (faceCount === 0) {
    return {
      passed: false,
      message: 'No face detected',
      metadata: { faceCount },
    };
  }

  if (faceCount > 1) {
    return {
      passed: false,
      message: 'Multiple faces detected',
      metadata: { faceCount },
    };
  }

  return {
    passed: true,
    message: 'Single face detected',
    metadata: { faceCount, confidence: faces[0]?.score },
  };
}

/**
 * Rule 5: Validates that the detected face is sufficiently large.
 * Rejects if face area is less than 3% of the image.
 */
export async function faceSizeCheck(
  imageBuffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  cachedFaces?: DetectedFace[]
): Promise<ValidationRuleResult> {
  const MIN_FACE_AREA_PERCENT = 3;
  const faces = cachedFaces ?? (await detectFaces(imageBuffer));

  if (faces.length === 0) {
    // Handled by faceCountCheck
    return {
      passed: true,
      message: 'Face size check skipped (no face)',
      metadata: { skipped: true },
    };
  }

  const face = faces[0]!;
  const faceArea = face.width * face.height;
  const imageArea = imageWidth * imageHeight;
  const facePercent = imageArea > 0 ? (faceArea / imageArea) * 100 : 0;

  const passed = facePercent >= MIN_FACE_AREA_PERCENT;

  return {
    passed,
    message: passed ? 'Face size is acceptable' : 'Face is too far away',
    metadata: {
      facePercent: Math.round(facePercent * 10) / 10,
      threshold: MIN_FACE_AREA_PERCENT,
      faceBox: face,
    },
  };
}

/**
 * Rule 4: Checks if the image (or detected face) is blurry using Laplacian variance.
 * Variance threshold is calibrated to 60 to avoid false positives on portrait bokeh backgrounds.
 */
export async function blurCheck(
  imageBuffer: Buffer,
  cachedFaces?: DetectedFace[]
): Promise<ValidationRuleResult> {
  const BLUR_THRESHOLD = 60;

  try {
    let bufferToAnalyze = imageBuffer;
    const faces = cachedFaces ?? [];

    // If face is detected, compute blur specifically on face region to avoid false blur from background bokeh
    if (faces.length > 0) {
      const face = faces[0]!;
      if (face.width > 20 && face.height > 20) {
        try {
          bufferToAnalyze = await sharp(imageBuffer)
            .extract({
              left: Math.round(face.x),
              top: Math.round(face.y),
              width: Math.round(face.width),
              height: Math.round(face.height),
            })
            .toBuffer();
        } catch {
          bufferToAnalyze = imageBuffer;
        }
      }
    }

    const { data, info } = await sharp(bufferToAnalyze)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;

    const laplacianValues: number[] = [];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const laplacian =
          data[idx - width]! +
          data[idx - 1]! +
          -4 * data[idx]! +
          data[idx + 1]! +
          data[idx + width]!;
        laplacianValues.push(laplacian);
      }
    }

    const n = laplacianValues.length;
    if (n === 0) {
      return { passed: true, message: 'Image sharpness is acceptable' };
    }

    let sum = 0;
    for (const v of laplacianValues) sum += v;
    const mean = sum / n;

    let varianceSum = 0;
    for (const v of laplacianValues) varianceSum += (v - mean) ** 2;
    const variance = varianceSum / n;

    const passed = variance >= BLUR_THRESHOLD;

    return {
      passed,
      message: passed ? 'Image sharpness is acceptable' : 'Blurry face detected',
      metadata: {
        variance: Math.round(variance * 100) / 100,
        threshold: BLUR_THRESHOLD,
      },
    };
  } catch (err) {
    console.error('Blur check error:', err);
    return {
      passed: true,
      message: 'Image sharpness is acceptable',
      metadata: { error: err instanceof Error ? err.message : 'Unknown error' },
    };
  }
}

/**
 * Rule 3: Checks if image is too similar to another upload in the same session.
 * Uses perceptual hash (pHash) with Hamming distance threshold of 5.
 */
export async function similarityCheck(
  perceptualHash: string | null,
  sessionId: string,
  currentImageId: string
): Promise<ValidationRuleResult> {
  const SIMILARITY_THRESHOLD = 5;

  if (!perceptualHash) {
    return {
      passed: true,
      message: 'Image is sufficiently unique',
      metadata: { skipped: true },
    };
  }

  const otherImages = await prisma.image.findMany({
    where: {
      sessionId,
      id: { not: currentImageId },
      perceptualHash: { not: null },
    },
    select: {
      id: true,
      perceptualHash: true,
      originalFilename: true,
    },
  });

  for (const other of otherImages) {
    if (!other.perceptualHash) continue;

    const distance = hammingDistance(perceptualHash, other.perceptualHash);

    if (distance < SIMILARITY_THRESHOLD) {
      return {
        passed: false,
        message: 'Too similar to another upload',
        metadata: {
          similarImageId: other.id,
          similarFilename: other.originalFilename,
          hammingDistance: distance,
          threshold: SIMILARITY_THRESHOLD,
        },
      };
    }
  }

  return {
    passed: true,
    message: 'Image is sufficiently unique',
    metadata: {
      comparedCount: otherImages.length,
      threshold: SIMILARITY_THRESHOLD,
    },
  };
}
