import { Loader2 } from 'lucide-react';

export default function ProcessingState() {
  return (
    <div className="rounded-lg bg-primary-50 border border-primary-200 p-6 text-center">
      <div className="flex justify-center mb-4">
        <Loader2 className="h-10 w-10 text-primary-500 animate-spin" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-gray-800 mb-2">
        Hang tight – we're checking your photos
      </h3>
      <p className="text-sm text-gray-500 max-w-md mx-auto">
        You're almost there! We're just verifying the quality of your uploads to
        make sure you get the best results.
      </p>
    </div>
  );
}
