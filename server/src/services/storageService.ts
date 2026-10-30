import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { config } from '../config';

let s3Client: S3Client | null = null;
let useLocalStorage = false;
const BUCKET = config.MINIO_BUCKET || 'aragon-images';
const LOCAL_STORAGE_DIR = path.join(__dirname, '../../uploads');

// Ensure local uploads directory exists
if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
  fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
}

/**
 * Initializes the storage service. Tries S3/MinIO first; falls back to local storage if unreachable.
 */
export async function initBucket(): Promise<void> {
  try {
    s3Client = new S3Client({
      endpoint: `${config.MINIO_USE_SSL ? 'https' : 'http'}://${config.MINIO_ENDPOINT}:${config.MINIO_PORT}`,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.MINIO_ACCESS_KEY,
        secretAccessKey: config.MINIO_SECRET_KEY,
      },
      forcePathStyle: true,
      maxAttempts: 2,
    });

    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET }));
      console.log(`✅ S3/MinIO Bucket "${BUCKET}" connected`);
      useLocalStorage = false;
    } catch (headErr: any) {
      if (headErr?.name === 'NotFound' || headErr?.$metadata?.httpStatusCode === 404) {
        await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET }));
        console.log(`✅ Created S3/MinIO bucket "${BUCKET}"`);
        useLocalStorage = false;
      } else {
        throw headErr;
      }
    }
  } catch (err: any) {
    console.warn(
      `⚠️ S3/MinIO unavailable (${err.message || 'connection failed'}). Using local filesystem storage at: ${LOCAL_STORAGE_DIR}`
    );
    useLocalStorage = true;
    s3Client = null;
  }
}

/**
 * Uploads a file buffer to S3/MinIO or local filesystem.
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  if (!useLocalStorage && s3Client) {
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        })
      );
      return;
    } catch (err) {
      console.warn(`S3 upload failed for ${key}, falling back to local:`, err);
    }
  }

  // Local storage fallback
  const localPath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, path.sep));
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await fs.promises.writeFile(localPath, buffer);
}

/**
 * Generates a URL for downloading or viewing a file.
 */
export async function getFileUrl(key: string): Promise<string> {
  if (!useLocalStorage && s3Client) {
    try {
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
      return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    } catch {
      // fallback to proxy
    }
  }
  return `/api/storage/${key}`;
}

/**
 * Returns a readable stream for the given storage key.
 */
export async function getFileStream(key: string): Promise<Readable> {
  if (!useLocalStorage && s3Client) {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: key })
      );
      if (response.Body) {
        return response.Body as Readable;
      }
    } catch (err) {
      console.warn(`S3 getFileStream failed for ${key}, trying local:`, err);
    }
  }

  const localPath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, path.sep));
  if (!fs.existsSync(localPath)) {
    throw new Error(`File not found: ${key}`);
  }
  return fs.createReadStream(localPath);
}

/**
 * Deletes a file from storage.
 */
export async function deleteFile(key: string): Promise<void> {
  if (!useLocalStorage && s3Client) {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err) {
      console.warn(`S3 delete failed for ${key}:`, err);
    }
  }

  const localPath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, path.sep));
  if (fs.existsSync(localPath)) {
    await fs.promises.unlink(localPath);
  }
}
