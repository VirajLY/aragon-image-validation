export type ImageStatus = 'PENDING' | 'PROCESSING' | 'ACCEPTED' | 'REJECTED';
export type SessionStatus = 'UPLOADING' | 'PROCESSING' | 'COMPLETED';
export type ValidationRule =
  | 'FORMAT'
  | 'SIZE'
  | 'RESOLUTION'
  | 'BLUR'
  | 'FACE_TOO_SMALL'
  | 'MULTIPLE_FACES'
  | 'NO_FACE'
  | 'SIMILARITY';

export interface ValidationResult {
  id: string;
  imageId: string;
  rule: ValidationRule;
  passed: boolean;
  message: string | null;
  metadata: Record<string, unknown> | null;
}

export interface UploadImage {
  id: string;
  sessionId: string;
  originalFilename: string;
  storageKey: string;
  thumbnailKey: string | null;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  status: ImageStatus;
  rejectionReason: string | null;
  createdAt: string;
  validationResults: ValidationResult[];
}

export interface UploadSession {
  id: string;
  status: SessionStatus;
  totalImages: number;
  acceptedCount: number;
  rejectedCount: number;
  createdAt: string;
  images: UploadImage[];
}

/** Local state representation before upload completes */
export interface LocalFile {
  id: string;
  file: File;
  preview: string;
  progress: number;
  status: 'queued' | 'uploading' | 'uploaded' | 'error';
  error?: string;
  serverImageId?: string;
}

export interface SSEEvent {
  type: 'image:validated' | 'session:completed';
  data: {
    imageId?: string;
    status?: ImageStatus;
    rejectionReason?: string;
    sessionId?: string;
    acceptedCount?: number;
    rejectedCount?: number;
  };
}
