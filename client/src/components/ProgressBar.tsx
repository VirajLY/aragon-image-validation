import { useUploadStore } from '../stores/uploadStore';

interface ProgressBarProps {
  className?: string;
}

export default function ProgressBar({ className = '' }: ProgressBarProps) {
  const acceptedCount = useUploadStore((s) => s.acceptedCount);
  const maxImages = useUploadStore((s) => s.maxImages);

  const pct = Math.min((acceptedCount / maxImages) * 100, 100);

  // Gradient shifts from red → yellow → green as progress increases
  const barColor =
    pct < 40
      ? 'bg-danger-500'
      : pct < 70
        ? 'bg-yellow-400'
        : 'bg-success-500';

  return (
    <div className={`w-full ${className}`} role="progressbar" aria-valuenow={acceptedCount} aria-valuemin={0} aria-valuemax={maxImages}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-500">Upload Progress</span>
        <span className="text-xs font-semibold text-gray-700">
          {acceptedCount} of {maxImages}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
