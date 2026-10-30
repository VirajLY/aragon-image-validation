import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';
import ImageGrid from './ImageGrid';

export default function RejectedPhotos() {
  const images = useUploadStore((s) => s.images);
  const acceptedCount = useUploadStore((s) => s.acceptedCount);
  const [expanded, setExpanded] = useState(true);

  const rejected = images.filter((img) => img.status === 'REJECTED');

  if (rejected.length === 0) return null;

  return (
    <section className="rounded-lg bg-white shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        aria-expanded={expanded}
        aria-controls="rejected-photos-panel"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-danger-500" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              Some Photos Didn't Meet Our Guidelines
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              You can move to the next step as you've uploaded{' '}
              <span className="font-medium text-gray-600">{acceptedCount}</span>{' '}
              good photos. Replacing these is optional.
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400 shrink-0" aria-hidden="true" />
        )}
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div id="rejected-photos-panel" className="px-5 pb-5">
          <ImageGrid images={rejected} showRejectionReason />
        </div>
      )}
    </section>
  );
}
