import axios from 'axios';
import type { UploadSession, UploadImage } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 120_000, // 2 min timeout for large uploads
});

export async function createSession(): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>('/sessions');
  return data;
}

export async function uploadImage(
  sessionId: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<UploadImage[]> {
  const formData = new FormData();
  formData.append('images', file);

  const { data } = await api.post<{ images?: UploadImage[] } | UploadImage[]>(
    `/sessions/${sessionId}/images`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total && onProgress) {
          const percent = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          onProgress(percent);
        }
      },
    },
  );
  return Array.isArray(data) ? data : (data.images || []);
}

export async function getSession(sessionId: string): Promise<UploadSession> {
  const { data } = await api.get<UploadSession>(`/sessions/${sessionId}`);
  return data;
}

export async function getImageStatus(imageId: string): Promise<any> {
  const { data } = await api.get(`/images/${imageId}/status`);
  return data;
}

export async function reprocessImage(
  imageId: string,
  simulateFailure?: 'conversion' | 'compression' | 'variant'
): Promise<any> {
  const { data } = await api.post(`/images/${imageId}/reprocess`, {
    simulateFailure,
  });
  return data;
}

export async function deleteImage(
  sessionId: string,
  imageId: string,
): Promise<void> {
  await api.delete(`/sessions/${sessionId}/images/${imageId}`);
}

export function getImageUrl(imageId: string, thumbnail = false): string {
  return `/api/images/${imageId}/file${thumbnail ? '?thumbnail=true' : ''}`;
}

export function getVariantUrl(imageId: string, type: 'thumbnail' | 'web' | 'full'): string {
  return `/api/images/${imageId}/variants/${type}`;
}
