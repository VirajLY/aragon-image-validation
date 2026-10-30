import { Loader2, CheckCircle, AlertCircle, ImageIcon } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';

export default function UploadProgress() {
  const localFiles = useUploadStore((s) => s.localFiles);

  if (localFiles.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-400 mb-2">
        It can take up to 1 minute to upload
      </p>

      <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Upload file list">
        {localFiles.map((f) => (
          <li
            key={f.id}
            className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm"
          >
            {/* Icon */}
            {f.status === 'uploading' && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary-500" aria-hidden="true" />
            )}
            {f.status === 'uploaded' && (
              <CheckCircle className="h-4 w-4 shrink-0 text-success-500" aria-hidden="true" />
            )}
            {f.status === 'error' && (
              <AlertCircle className="h-4 w-4 shrink-0 text-danger-500" aria-hidden="true" />
            )}
            {f.status === 'queued' && (
              <ImageIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            )}

            {/* Filename */}
            <span className="flex-1 truncate text-gray-700" title={f.file.name}>
              {f.file.name}
            </span>

            {/* Status / progress */}
            {f.status === 'uploading' && (
              <span className="shrink-0 text-xs tabular-nums text-gray-400">
                {f.progress}%
              </span>
            )}
            {f.status === 'error' && (
              <span className="shrink-0 text-xs text-danger-500 max-w-[120px] truncate" title={f.error}>
                {f.error}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
