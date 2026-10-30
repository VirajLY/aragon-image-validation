import multer from 'multer';
import { config } from '../config';

/**
 * Allowed file extensions for image uploads.
 */
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|heic|heif)$/i;

/**
 * Allowed MIME types for image uploads.
 */
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  // Some systems report HEIC as application/octet-stream
  'application/octet-stream',
]);

/**
 * Multer configuration for handling image uploads.
 *
 * - Uses memory storage (files stored as Buffer in memory)
 * - Validates file extension and MIME type
 * - Limits file size to MAX_FILE_SIZE from config
 * - Allows up to 10 files per request
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_FILE_SIZE,
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    const extValid = ALLOWED_EXTENSIONS.test(file.originalname);
    const mimeValid = ALLOWED_MIMES.has(file.mimetype);

    if (extValid && mimeValid) {
      cb(null, true);
    } else {
      cb(
        new multer.MulterError(
          'LIMIT_UNEXPECTED_FILE',
          `Only JPEG, PNG, and HEIC files are allowed. Got: ${file.originalname} (${file.mimetype})`
        )
      );
    }
  },
});

/**
 * Middleware for handling multi-file uploads.
 * Accepts up to 10 files under the "images" field name.
 */
export const uploadImages = upload.array('images', 10);

export default upload;
