import { useEffect } from 'react';
import { CheckCircle, X, AlertCircle } from 'lucide-react';
import { useUploadStore } from '../stores/uploadStore';

export default function Toast() {
  const showToast = useUploadStore((s) => s.showToast);
  const toastMessage = useUploadStore((s) => s.toastMessage);
  const toastType = useUploadStore((s) => s.toastType);
  const hideToast = useUploadStore((s) => s.hideToast);

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    if (!showToast) return;
    const timer = setTimeout(() => hideToast(), 5_000);
    return () => clearTimeout(timer);
  }, [showToast, hideToast]);

  if (!showToast) return null;

  const isSuccess = toastType === 'success';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-6 right-6 z-50 flex items-start gap-3 rounded-lg bg-white px-5 py-4 shadow-lg border border-gray-200 max-w-sm animate-slide-up"
    >
      {isSuccess ? (
        <CheckCircle className="h-5 w-5 shrink-0 text-success-500 mt-0.5" aria-hidden="true" />
      ) : (
        <AlertCircle className="h-5 w-5 shrink-0 text-danger-500 mt-0.5" aria-hidden="true" />
      )}

      <p className="text-sm text-gray-700 whitespace-pre-line flex-1">
        {toastMessage}
      </p>

      <button
        onClick={hideToast}
        className="shrink-0 rounded-md p-1 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Close notification"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Inline keyframes for slide-up animation */}
      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }
      `}</style>
    </div>
  );
}
