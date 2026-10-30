import { create } from 'zustand';
import type { LocalFile, UploadImage } from '../types';

interface UploadState {
  // Session
  sessionId: string | null;
  sessionStatus: string;

  // Local files (pre-upload)
  localFiles: LocalFile[];

  // Server-side images (post-upload, with validation results)
  images: UploadImage[];

  // Counts
  acceptedCount: number;
  rejectedCount: number;
  totalUploaded: number;
  maxImages: number;

  // UI state
  isUploading: boolean;
  isProcessing: boolean;
  showToast: boolean;
  toastMessage: string;
  toastType: 'success' | 'error';

  // Actions
  setSession: (id: string) => void;
  addLocalFiles: (files: LocalFile[]) => void;
  updateLocalFileProgress: (id: string, progress: number) => void;
  updateLocalFileStatus: (
    id: string,
    status: LocalFile['status'],
    serverImageId?: string,
  ) => void;
  setLocalFileError: (id: string, error: string) => void;
  removeLocalFile: (id: string) => void;
  setImages: (images: UploadImage[]) => void;
  updateImage: (imageId: string, updates: Partial<UploadImage>) => void;
  removeImage: (imageId: string) => void;
  setUploading: (val: boolean) => void;
  setProcessing: (val: boolean) => void;
  updateCounts: (accepted: number, rejected: number) => void;
  showToastMessage: (message: string, type: 'success' | 'error') => void;
  hideToast: () => void;
  reset: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  // Session
  sessionId: null,
  sessionStatus: 'UPLOADING',

  // Local files
  localFiles: [],

  // Server images
  images: [],

  // Counts
  acceptedCount: 0,
  rejectedCount: 0,
  totalUploaded: 0,
  maxImages: 10,

  // UI
  isUploading: false,
  isProcessing: false,
  showToast: false,
  toastMessage: '',
  toastType: 'success',

  // ── Actions ──────────────────────────────────────────────

  setSession: (id) => set({ sessionId: id }),

  addLocalFiles: (files) =>
    set((state) => ({
      localFiles: [...state.localFiles, ...files],
    })),

  updateLocalFileProgress: (id, progress) =>
    set((state) => ({
      localFiles: state.localFiles.map((f) =>
        f.id === id ? { ...f, progress } : f,
      ),
    })),

  updateLocalFileStatus: (id, status, serverImageId) =>
    set((state) => ({
      localFiles: state.localFiles.map((f) =>
        f.id === id ? { ...f, status, ...(serverImageId ? { serverImageId } : {}) } : f,
      ),
      totalUploaded:
        status === 'uploaded' ? state.totalUploaded + 1 : state.totalUploaded,
    })),

  setLocalFileError: (id, error) =>
    set((state) => ({
      localFiles: state.localFiles.map((f) =>
        f.id === id ? { ...f, status: 'error' as const, error } : f,
      ),
    })),

  removeLocalFile: (id) =>
    set((state) => ({
      localFiles: state.localFiles.filter((f) => f.id !== id),
    })),

  setImages: (images) => set({ images }),

  updateImage: (imageId, updates) =>
    set((state) => ({
      images: state.images.map((img) =>
        img.id === imageId ? { ...img, ...updates } : img,
      ),
    })),

  removeImage: (imageId) =>
    set((state) => {
      const removed = state.images.find((img) => img.id === imageId);
      const wasAccepted = removed?.status === 'ACCEPTED';
      const wasRejected = removed?.status === 'REJECTED';
      return {
        images: state.images.filter((img) => img.id !== imageId),
        acceptedCount: wasAccepted
          ? state.acceptedCount - 1
          : state.acceptedCount,
        rejectedCount: wasRejected
          ? state.rejectedCount - 1
          : state.rejectedCount,
        totalUploaded: state.totalUploaded - 1,
      };
    }),

  setUploading: (val) => set({ isUploading: val }),

  setProcessing: (val) =>
    set({ isProcessing: val, sessionStatus: val ? 'PROCESSING' : 'COMPLETED' }),

  updateCounts: (accepted, rejected) =>
    set({ acceptedCount: accepted, rejectedCount: rejected }),

  showToastMessage: (message, type) =>
    set({ showToast: true, toastMessage: message, toastType: type }),

  hideToast: () => set({ showToast: false }),

  reset: () =>
    set({
      sessionId: null,
      sessionStatus: 'UPLOADING',
      localFiles: [],
      images: [],
      acceptedCount: 0,
      rejectedCount: 0,
      totalUploaded: 0,
      isUploading: false,
      isProcessing: false,
      showToast: false,
      toastMessage: '',
      toastType: 'success',
    }),
}));
