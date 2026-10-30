import { Trash2 } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';
import { getImageUrl, deleteImage } from '../lib/api';
import type { UploadImage } from '../types';

interface ImageGridProps {
  images: UploadImage[];
  showRejectionReason?: boolean;
}

export default function ImageGrid({
  images,
  showRejectionReason = false,
}: ImageGridProps) {
  const sessionId = useUploadStore((s) => s.sessionId);
  const removeImage = useUploadStore((s) => s.removeImage);

  const handleDelete = async (imageId: string) => {
    if (!sessionId) return;
    try {
      await deleteImage(sessionId, imageId);
      removeImage(imageId);
    } catch {
      // Silently fail; could show toast
    }
  };

  if (images.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 py-12">
        <p className="text-sm text-gray-400">No images yet</p>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
      role="list"
      aria-label="Image thumbnails"
    >
      {images.map((img) => (
        <div key={img.id} role="listitem" className="group relative">
          {/* Thumbnail */}
          <div
            className={`relative aspect-square overflow-hidden rounded-lg bg-gray-100 ${
              img.status === 'REJECTED'
                ? 'ring-2 ring-danger-400'
                : ''
            }`}
          >
            <img
              src={getImageUrl(img.id, true)}
              alt={img.originalFilename}
              loading="lazy"
              className="h-full w-full object-cover transition-opacity duration-300"
              onError={(e) => {
                // Fallback – try full-size image
                const target = e.currentTarget;
                if (!target.dataset.fallback) {
                  target.dataset.fallback = '1';
                  target.src = getImageUrl(img.id, false);
                }
              }}
            />

            {/* Processing overlay */}
            {(img.status === 'PENDING' || img.status === 'PROCESSING') && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-400 border-t-transparent" />
              </div>
            )}

            {/* Delete button */}
            <button
              onClick={() => handleDelete(img.id)}
              className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full
                         bg-black/50 text-white opacity-0 transition-opacity
                         group-hover:opacity-100 hover:bg-black/70 focus:opacity-100"
              aria-label={`Delete ${img.originalFilename}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Rejection reason */}
          {showRejectionReason && img.rejectionReason && (
            <p className="mt-1 text-xs text-danger-600 line-clamp-2">
              {img.rejectionReason}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
