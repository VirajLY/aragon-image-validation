import { useEffect, useRef, useCallback } from 'react';
import { useUploadStore } from '../stores/uploadStore';
import { getSession } from '../lib/api';
import type { ImageStatus } from '../types';

/**
 * Opens an EventSource to `/api/sessions/:id/events` and keeps the
 * Zustand store in sync with server-sent validation results.
 */
export function useSSE(): void {
  const sessionId = useUploadStore((s) => s.sessionId);
  const isProcessing = useUploadStore((s) => s.isProcessing);
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

    const handleImageUpdate = (e: MessageEvent) => {
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

        // Refresh full session to get accurate counts
        getSession(sessionId).then((session) => {
          setImages(session.images);
          updateCounts(session.acceptedCount, session.rejectedCount);
        }).catch(() => {
          // Silently ignore – SSE event already updated the image
        });
      } catch {
        // Malformed event – ignore
      }
    };

    es.addEventListener('image:validated', handleImageUpdate);
    es.addEventListener('image:accepted', handleImageUpdate);
    es.addEventListener('image:rejected', handleImageUpdate);

    es.addEventListener('session:completed', () => {
      setProcessing(false);
      showToastMessage(
        'Your photos have been successfully uploaded!',
        'success',
      );

      // Final refresh
      getSession(sessionId).then((session) => {
        setImages(session.images);
        updateCounts(session.acceptedCount, session.rejectedCount);
      }).catch(() => { /* noop */ });
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 3 seconds
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 3_000);
    };
  }, [sessionId, updateImage, updateCounts, setProcessing, setImages, showToastMessage]);

  useEffect(() => {
    if (sessionId && isProcessing) {
      connect();
    }

    return () => {
      sourceRef.current?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [sessionId, isProcessing, connect]);
}
