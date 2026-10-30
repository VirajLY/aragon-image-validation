const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif'];
const MAX_FILE_SIZE = 120 * 1024 * 1024; // 120 MB

export interface ValidationError {
  file: File;
  reason: string;
}

export function validateFile(file: File): string | null {
  // Check extension
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return 'Invalid format. Only PNG, JPG, and HEIC files are allowed.';
  }

  // Check MIME type (may be empty for HEIC on some browsers)
  if (file.type && !ALLOWED_TYPES.includes(file.type)) {
    return `Invalid file type: ${file.type}. Only PNG, JPG, and HEIC files are allowed.`;
  }

  // Check size
  if (file.size > MAX_FILE_SIZE) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 120MB.`;
  }

  if (file.size === 0) {
    return 'File is empty.';
  }

  return null;
}

export function validateFiles(
  files: File[],
): { valid: File[]; errors: ValidationError[] } {
  const valid: File[] = [];
  const errors: ValidationError[] = [];

  for (const file of files) {
    const error = validateFile(file);
    if (error) {
      errors.push({ file, reason: error });
    } else {
      valid.push(file);
    }
  }

  return { valid, errors };
}
