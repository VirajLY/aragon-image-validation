import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Loader2 } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';
import { useUpload } from '../hooks/useUpload';
import UploadProgress from './UploadProgress';

export default function UploadZone() {
  const isUploading = useUploadStore((s) => s.isUploading);
  const { upload } = useUpload();
  const [isDragActive, setIsDragActive] = useState(false);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setIsDragActive(false);
      if (acceptedFiles.length > 0) {
        upload(acceptedFiles);
      }
    },
    [upload],
  );

  const { getRootProps, getInputProps, open } = useDropzone({
    onDrop,
    onDragEnter: () => setIsDragActive(true),
    onDragLeave: () => setIsDragActive(false),
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif'],
    },
    noClick: true,
    noKeyboard: false,
    multiple: true,
    disabled: isUploading,
  });

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed
          p-8 text-center transition-colors duration-200 cursor-pointer
          ${
            isDragActive
              ? 'border-primary-400 bg-primary-50'
              : 'border-gray-300 bg-white hover:border-primary-300 hover:bg-gray-50'
          }
          ${isUploading ? 'pointer-events-none opacity-60' : ''}
        `}
        role="button"
        tabIndex={0}
        aria-label="Upload files by clicking or dragging and dropping"
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      >
        <input {...getInputProps()} aria-label="File input" />

        {isUploading ? (
          <>
            <Loader2
              className="h-10 w-10 text-primary-500 animate-spin mb-3"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-gray-700">Uploading…</p>
          </>
        ) : (
          <>
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50">
              <Upload className="h-6 w-6 text-primary-500" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              Click to upload or drag and drop
            </p>
            <p className="text-xs text-gray-400">
              PNG, JPG, HEIC up to 120MB
            </p>
          </>
        )}
      </div>

      {/* Upload-files button */}
      <button
        onClick={open}
        disabled={isUploading}
        className="w-full rounded-md bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white
                   shadow-sm hover:bg-primary-600 focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-2 focus-visible:outline-primary-500
                   disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isUploading ? 'Uploading…' : 'Upload files'}
      </button>

      {/* File progress list */}
      <UploadProgress />
    </div>
  );
}
