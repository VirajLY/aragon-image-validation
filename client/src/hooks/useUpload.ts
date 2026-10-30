import { useCallback, useRef } from 'react';
import { useUploadStore } from '../stores/uploadStore';
import { createSession, uploadImage } from '../lib/api';
import { validateFiles } from '../lib/validators';
import type { LocalFile } from '../types';

/**
 * Provides an `upload` callback that:
 * 1. Creates a session if none exists
 * 2. Validates files client-side
 * 3. Adds valid files to local state
 * 4. Uploads files sequentially
 */
export function useUpload() {
  const {
    sessionId,
    setSession,
    addLocalFiles,
    updateLocalFileProgress,
    updateLocalFileStatus,
    setLocalFileError,
    setUploading,
    setProcessing,
    setImages,
    updateCounts,
    showToastMessage,
    images,
  } = useUploadStore();

  const isUploadingRef = useRef(false);

  const upload = useCallback(
    async (files: File[]) => {
      if (isUploadingRef.current) return;

      // 1 ── Client-side validation ──────────────────────────
      const { valid, errors } = validateFiles(files);

      if (errors.length > 0) {
        const msgs = errors.map((e) => `${e.file.name}: ${e.reason}`);
        showToastMessage(msgs.join('\n'), 'error');
      }

      if (valid.length === 0) return;

      isUploadingRef.current = true;
      setUploading(true);

      // 2 ── Ensure session exists ───────────────────────────
      let sid = sessionId;
      if (!sid) {
        try {
          const res = await createSession();
          sid = res.id;
          setSession(sid);
        } catch {
          showToastMessage('Failed to create upload session.', 'error');
          setUploading(false);
          isUploadingRef.current = false;
          return;
        }
      }

      // 3 ── Build LocalFile entries ─────────────────────────
      const localEntries: LocalFile[] = valid.map((file) => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        progress: 0,
        status: 'queued' as const,
      }));

      addLocalFiles(localEntries);

      // 4 ── Upload sequentially ─────────────────────────────
      for (const entry of localEntries) {
        updateLocalFileStatus(entry.id, 'uploading');
        try {
          const serverImages = await uploadImage(sid, entry.file, (pct) => {
            updateLocalFileProgress(entry.id, pct);
          });

          const serverImg = serverImages?.[0];
          updateLocalFileStatus(
            entry.id,
            'uploaded',
            serverImg?.id,
          );

          // Merge returned images into store
          if (serverImages && serverImages.length > 0) {
            const currentImages = useUploadStore.getState().images;
            const existingIds = new Set(currentImages.map((i) => i.id));
            const newImages = serverImages.filter(
              (i) => !existingIds.has(i.id),
            );
            if (newImages.length > 0) {
              setImages([...currentImages, ...newImages]);
            }
          }
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : 'Upload failed';
          setLocalFileError(entry.id, message);
        }
      }

      // 5 ── Mark processing ─────────────────────────────────
      setUploading(false);
      isUploadingRef.current = false;

      // If any images are still PENDING / PROCESSING, enter processing state
      const allImages = useUploadStore.getState().images;
      const hasPending = allImages.some(
        (img) => img.status === 'PENDING' || img.status === 'PROCESSING',
      );
      if (hasPending) {
        setProcessing(true);
      } else {
        // All already validated
        const accepted = allImages.filter(
          (img) => img.status === 'ACCEPTED',
        ).length;
        const rejected = allImages.filter(
          (img) => img.status === 'REJECTED',
        ).length;
        updateCounts(accepted, rejected);
        if (allImages.length > 0) {
          showToastMessage(
            'Your photos have been successfully uploaded!',
            'success',
          );
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, images],
  );

  return { upload };
}
