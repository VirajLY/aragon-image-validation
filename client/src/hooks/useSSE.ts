import { useEffect, useRef, useCallback } from 'react';
import { useUploadStore } from '../stores/uploadStore';
import { getSession } from '../lib/api';
import type { ImageStatus, PipelineStatus, ImageVariant } from '../types';

/**
 * Opens an EventSource to `/api/sessions/:id/events` and keeps the
 * Zustand store in sync with server-sent validation results and media pipeline stages.
 */
export function useSSE(): void {
  const sessionId = useUploadStore((s) => s.sessionId);
  const updateImage = useUploadStore((s) => s.updateImage);
  const updateCounts = useUploadStore((s) => s.updateCounts);
  const setProcessing = useUploadStore((s) => s.setProcessing);
  const setImages = useUploadStore((s) => s.setImages);
  const showToastMessage = useUploadStore((s) => s.showToastMessage);

  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!sessionId) return;

    // Clean up any previous connection
    sourceRef.current?.close();

    const es = new EventSource(`/api/sessions/${sessionId}/events`);
    sourceRef.current = es;

    // 1. Image validation status updates
    const handleValidationUpdate = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as {
          imageId: string;
          status: ImageStatus;
          rejectionReason?: string | null;
        };

        updateImage(payload.imageId, {
          status: payload.status,
          rejectionReason: payload.rejectionReason ?? null,
        });

        getSession(sessionId)
          .then((session) => {
            setImages(session.images);
            updateCounts(session.acceptedCount, session.rejectedCount);
          })
          .catch(() => {});
      } catch {
        // Malformed event – ignore
      }
    };

    es.addEventListener('image:validated', handleValidationUpdate);
    es.addEventListener('image:accepted', handleValidationUpdate);
    es.addEventListener('image:rejected', handleValidationUpdate);

    // 2. Media processing pipeline stage updates (Part 2)
    const handlePipelineStage = (stageName: string, status: PipelineStatus) => (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as {
          imageId: string;
          stage?: string;
          status?: PipelineStatus;
          error?: string;
          variants?: ImageVariant[];
          metrics?: {
            originalSize?: number;
            compressedSize?: number;
            compressionRatio?: number;
          };
        };

        updateImage(payload.imageId, {
          pipelineStatus: status,
          pipelineStage: payload.stage || stageName,
          pipelineError: payload.error || null,
          variants: payload.variants,
          originalSize: payload.metrics?.originalSize,
          compressedSize: payload.metrics?.compressedSize,
          compressionRatio: payload.metrics?.compressionRatio,
        });

        if (status === 'READY' || status === 'FAILED') {
          getSession(sessionId)
            .then((session) => {
              setImages(session.images);
            })
            .catch(() => {});
        }
      } catch {
        // Malformed event – ignore
      }
    };

    es.addEventListener('pipeline:converting', handlePipelineStage('Conversion Service', 'CONVERTING'));
    es.addEventListener('pipeline:compressing', handlePipelineStage('Compression Service', 'COMPRESSING'));
    es.addEventListener('pipeline:generating_variants', handlePipelineStage('Variant Generation Service', 'GENERATING_VARIANTS'));
    es.addEventListener('pipeline:ready', handlePipelineStage('Completed', 'READY'));
    es.addEventListener('pipeline:failed', handlePipelineStage('Failed', 'FAILED'));

    // 3. Session completion
    es.addEventListener('session:completed', () => {
      setProcessing(false);
      showToastMessage(
        'Your photos have been successfully uploaded & verified!',
        'success',
      );

      getSession(sessionId)
        .then((session) => {
          setImages(session.images);
          updateCounts(session.acceptedCount, session.rejectedCount);
        })
        .catch(() => {});
    });

    es.onerror = () => {
      es.close();
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 3_000);
    };
  }, [sessionId, updateImage, updateCounts, setProcessing, setImages, showToastMessage]);

  useEffect(() => {
    if (sessionId) {
      connect();
    }

    return () => {
      sourceRef.current?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [sessionId, connect]);
}
