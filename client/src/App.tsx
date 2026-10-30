import { Camera } from 'lucide-react';
import ProgressBar from './components/ProgressBar';
import UploadZone from './components/UploadZone';
import PhotoGuidelines from './components/PhotoGuidelines';
import ProcessingState from './components/ProcessingState';
import AcceptedPhotos from './components/AcceptedPhotos';
import RejectedPhotos from './components/RejectedPhotos';
import Toast from './components/Toast';
import { useSSE } from './hooks/useSSE';
import { useUploadStore } from './stores/uploadStore';

export default function App() {
  // Wire up SSE listener
  useSSE();

  const isProcessing = useUploadStore((s) => s.isProcessing);
  const images = useUploadStore((s) => s.images);
  const hasImages = images.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Header ────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500">
              <Camera className="h-4 w-4 text-white" aria-hidden="true" />
            </div>
            <span className="text-lg font-bold text-gray-800">Aragon AI</span>
            <h2
             className="text-sm font-small font-bold text-gray-500">by Viraj Yadav</h2>
          </div>
        </div>

        {/* Progress bar – always visible */}
        <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6 lg:px-8">
          <ProgressBar />
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────── */}
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left sidebar – Upload + Guidelines */}
            <aside className="w-full lg:w-80 shrink-0 space-y-6">
              <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
                <h2 className="text-sm font-semibold text-gray-800 mb-4">
                  Upload Your Photos
                </h2>
                <UploadZone />
              </div>

              <PhotoGuidelines />
            </aside>

            {/* Right main area */}
            <section className="flex-1 space-y-6 min-w-0">
              {/* Processing banner */}
              {isProcessing && <ProcessingState />}

              {/* Accepted */}
              <AcceptedPhotos />

              {/* Rejected */}
              <RejectedPhotos />

              {/* Empty state */}
              {!hasImages && !isProcessing && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white py-20 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
                    <Camera className="h-7 w-7 text-gray-300" aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-medium text-gray-600 mb-1">
                    No photos uploaded yet
                  </h3>
                  <p className="text-sm text-gray-400 max-w-xs">
                    Drag and drop your photos into the upload zone on the left,
                    or click "Upload files" to get started.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* ── Toast ─────────────────────────────────────────── */}
      <Toast />
    </div>
  );
}
