import { useState } from 'react';
import {
  Trash2,
  RefreshCw,
  Layers,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  X,
  FileImage,
} from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';
import { getImageUrl, deleteImage, reprocessImage } from '../lib/api';
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
  const showToastMessage = useUploadStore((s) => s.showToastMessage);

  const [selectedImage, setSelectedImage] = useState<UploadImage | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const handleDelete = async (imageId: string) => {
    if (!sessionId) return;
    try {
      await deleteImage(sessionId, imageId);
      removeImage(imageId);
    } catch {
      showToastMessage('Failed to delete image', 'error');
    }
  };

  const handleReprocess = async (imageId: string) => {
    setReprocessingId(imageId);
    try {
      await reprocessImage(imageId);
      showToastMessage('Reprocessing started', 'success');
    } catch (err: any) {
      showToastMessage(err.message || 'Reprocessing failed', 'error');
    } finally {
      setTimeout(() => setReprocessingId(null), 1000);
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
    <>
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
        role="list"
        aria-label="Image thumbnails"
      >
        {images.map((img) => {
          const isAccepted = img.status === 'ACCEPTED';
          const pStatus = img.pipelineStatus || 'PENDING';
          const isReprocessing = reprocessingId === img.id;

          return (
            <div key={img.id} role="listitem" className="group relative flex flex-col">
              {/* Thumbnail Container */}
              <div
                className={`relative aspect-square overflow-hidden rounded-lg bg-gray-100 ${
                  img.status === 'REJECTED'
                    ? 'ring-2 ring-danger-400'
                    : pStatus === 'READY'
                    ? 'ring-2 ring-success-400'
                    : pStatus === 'FAILED'
                    ? 'ring-2 ring-amber-400'
                    : ''
                }`}
              >
                <img
                  src={getImageUrl(img.id, true)}
                  alt={img.originalFilename}
                  loading="lazy"
                  className="h-full w-full object-cover transition-opacity duration-300"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.dataset.fallback) {
                      target.dataset.fallback = '1';
                      target.src = getImageUrl(img.id, false);
                    }
                  }}
                />

                {/* Validation Processing Overlay */}
                {(img.status === 'PENDING' || img.status === 'PROCESSING') && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-400 border-t-transparent" />
                  </div>
                )}

                {/* Top-Right Delete Action */}
                <button
                  onClick={() => handleDelete(img.id)}
                  className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full
                             bg-black/50 text-white opacity-0 transition-opacity
                             group-hover:opacity-100 hover:bg-black/70 focus:opacity-100 z-10"
                  aria-label={`Delete ${img.originalFilename}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>

                {/* Pipeline Inspection Button (when READY) */}
                {isAccepted && pStatus === 'READY' && (
                  <button
                    onClick={() => setSelectedImage(img)}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0
                               transition-opacity group-hover:opacity-100 font-medium text-xs gap-1.5"
                    title="View Variants & Metadata"
                  >
                    <Layers className="h-4 w-4" />
                    <span>View Variants</span>
                  </button>
                )}
              </div>

              {/* Status / Pipeline Badges for Accepted Images */}
              {isAccepted && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {pStatus === 'CONVERTING' && (
                    <div className="flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-medium">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                      <span className="truncate">1/3 Normalizing...</span>
                    </div>
                  )}

                  {pStatus === 'COMPRESSING' && (
                    <div className="flex items-center gap-1 text-[11px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-medium">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                      <span className="truncate">2/3 Compressing...</span>
                    </div>
                  )}

                  {pStatus === 'GENERATING_VARIANTS' && (
                    <div className="flex items-center gap-1 text-[11px] text-purple-600 bg-purple-50 px-2 py-0.5 rounded font-medium">
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                      <span className="truncate">3/3 Creating Variants...</span>
                    </div>
                  )}

                  {pStatus === 'READY' && (
                    <button
                      onClick={() => setSelectedImage(img)}
                      className="flex items-center justify-between text-[11px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded font-medium transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                        <span>3 Variants Ready</span>
                      </span>
                      {img.compressionRatio && (
                        <span className="text-[10px] text-emerald-600 font-bold">
                          -{img.compressionRatio}%
                        </span>
                      )}
                    </button>
                  )}

                  {pStatus === 'FAILED' && (
                    <div className="rounded bg-rose-50 p-1.5 border border-rose-200">
                      <div className="flex items-start gap-1 text-[11px] text-rose-700 font-medium">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-600" />
                        <span className="line-clamp-2">{img.pipelineError || 'Processing failed'}</span>
                      </div>
                      <button
                        onClick={() => handleReprocess(img.id)}
                        disabled={isReprocessing}
                        className="mt-1.5 w-full flex items-center justify-center gap-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-semibold py-1 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${isReprocessing ? 'animate-spin' : ''}`} />
                        <span>{isReprocessing ? 'Retrying...' : 'Reprocess Job'}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Rejection reason */}
              {showRejectionReason && img.rejectionReason && (
                <p className="mt-1 text-xs text-danger-600 line-clamp-2">
                  {img.rejectionReason}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Variant Inspector Modal ────────────────────────────────────── */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-3xl rounded-xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <FileImage className="h-5 w-5 text-primary-500" />
                  {selectedImage.originalFilename}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <span>
                    Original Size:{' '}
                    <strong>
                      {selectedImage.originalSize
                        ? `${(selectedImage.originalSize / 1024).toFixed(1)} KB`
                        : `${(selectedImage.fileSizeBytes / 1024).toFixed(1)} KB`}
                    </strong>
                  </span>
                  {selectedImage.compressedSize && (
                    <span>
                      Compressed:{' '}
                      <strong className="text-emerald-600">
                        {(selectedImage.compressedSize / 1024).toFixed(1)} KB
                      </strong>
                    </span>
                  )}
                  {selectedImage.compressionRatio && (
                    <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 font-bold">
                      Saved {selectedImage.compressionRatio}%
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setSelectedImage(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Generated Variants Grid */}
            <div className="mt-5">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">
                Generated Multi-Resolution Variants
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(selectedImage.variants && selectedImage.variants.length > 0
                  ? selectedImage.variants
                  : [
                      {
                        type: 'THUMBNAIL',
                        width: 250,
                        height: 250,
                        fileSizeBytes: selectedImage.compressedSize ? Math.round(selectedImage.compressedSize * 0.15) : 12000,
                        format: 'jpeg',
                        url: `/api/images/${selectedImage.id}/variants/thumbnail`,
                      },
                      {
                        type: 'WEB',
                        width: 1200,
                        height: 800,
                        fileSizeBytes: selectedImage.compressedSize ? Math.round(selectedImage.compressedSize * 0.6) : 45000,
                        format: 'jpeg',
                        url: `/api/images/${selectedImage.id}/variants/web`,
                      },
                      {
                        type: 'FULL',
                        width: selectedImage.width || 2048,
                        height: selectedImage.height || 1365,
                        fileSizeBytes: selectedImage.compressedSize || 95000,
                        format: 'jpeg',
                        url: `/api/images/${selectedImage.id}/variants/full`,
                      },
                    ]
                ).map((variant) => {
                  const directUrl = `/api/images/${selectedImage.id}/variants/${variant.type.toLowerCase()}`;
                  return (
                    <div
                      key={variant.type}
                      className="flex flex-col rounded-lg border border-gray-200 bg-gray-50 p-3 shadow-sm hover:border-primary-300 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs uppercase tracking-wider text-gray-700">
                          {variant.type}
                        </span>
                        <span className="text-[11px] font-mono text-gray-500">
                          {variant.width}×{variant.height}
                        </span>
                      </div>

                      <div className="relative aspect-square w-full rounded bg-gray-200 overflow-hidden mb-2">
                        <img
                          src={directUrl}
                          alt={`${variant.type} variant`}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = getImageUrl(selectedImage.id, false);
                          }}
                        />
                      </div>

                      <div className="mt-auto flex items-center justify-between text-xs text-gray-500 pt-2 border-t">
                        <span>{(variant.fileSizeBytes / 1024).toFixed(1)} KB</span>
                        <a
                          href={directUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 font-semibold text-primary-600 hover:text-primary-700"
                        >
                          <span>Open</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="mt-6 flex justify-between items-center border-t pt-4">
              <button
                onClick={() => {
                  handleReprocess(selectedImage.id);
                  setSelectedImage(null);
                }}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Re-run Pipeline</span>
              </button>

              <button
                onClick={() => setSelectedImage(null)}
                className="rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-semibold px-4 py-2 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
