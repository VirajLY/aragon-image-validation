import { useState } from 'react';
import { CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';
import ImageGrid from './ImageGrid';

export default function AcceptedPhotos() {
  const images = useUploadStore((s) => s.images);
  const [expanded, setExpanded] = useState(true);

  const accepted = images.filter((img) => img.status === 'ACCEPTED');

  if (accepted.length === 0) return null;

  return (
    <section className="rounded-lg bg-white shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        aria-expanded={expanded}
        aria-controls="accepted-photos-panel"
      >
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-success-500" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              Accepted Photos
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              These images passed our scoring test and will all be used to
              generate your AI photos.
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
        <div id="accepted-photos-panel" className="px-5 pb-5">
          {/* Mini progress bar */}
          <div className="mb-4 h-1.5 w-full rounded-full bg-success-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-success-500 transition-all duration-500"
              style={{ width: '100%' }}
            />
          </div>

          <ImageGrid images={accepted} />
        </div>
      )}
    </section>
  );
}
