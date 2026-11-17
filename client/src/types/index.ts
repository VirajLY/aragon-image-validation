export type ImageStatus = 'PENDING' | 'PROCESSING' | 'ACCEPTED' | 'REJECTED';
export type SessionStatus = 'UPLOADING' | 'PROCESSING' | 'COMPLETED';
export type PipelineStatus =
  | 'PENDING'
  | 'CONVERTING'
  | 'COMPRESSING'
  | 'GENERATING_VARIANTS'
  | 'READY'
  | 'FAILED';

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

export interface ImageVariant {
  id: string;
  imageId: string;
  type: 'THUMBNAIL' | 'WEB' | 'FULL';
  storageKey: string;
  url: string;
  directUrl?: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  format: string;
  createdAt: string;
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
  
  // Media processing pipeline fields
  pipelineStatus?: PipelineStatus;
  pipelineStage?: string | null;
  pipelineError?: string | null;
  originalSize?: number | null;
  compressedSize?: number | null;
  compressionRatio?: number | null;
  convertedFormat?: string | null;
  variants?: ImageVariant[];

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
  type:
    | 'image:validated'
    | 'image:accepted'
    | 'image:rejected'
    | 'session:completed'
    | 'pipeline:converting'
    | 'pipeline:compressing'
    | 'pipeline:generating_variants'
    | 'pipeline:ready'
    | 'pipeline:failed';
  data: {
    imageId?: string;
    status?: ImageStatus | PipelineStatus;
    stage?: string;
    rejectionReason?: string;
    error?: string;
    sessionId?: string;
    acceptedCount?: number;
    rejectedCount?: number;
    variants?: ImageVariant[];
    metrics?: {
      originalSize?: number;
      compressedSize?: number;
      compressionRatio?: number;
    };
  };
}
