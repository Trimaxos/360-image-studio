import type { ProjectFile } from '../../shared/types';
import { api } from './api';

export type BatchExportFormat = 'jpg' | 'jpeg' | 'png' | 'webp' | 'avif';
export interface BatchExportItem {
  id: string;
  projectName: string;
  originalName: string;
  project: ProjectFile;
}
export interface BatchExportResult {
  id: string;
  name?: string;
  error?: string;
}
export interface BatchExportRequest {
  path: string;
  layers: ProjectFile['layers'];
  horizon: ProjectFile['horizon'];
  format: BatchExportFormat;
  quality: number;
}

export function pickBatchDirectory(): Promise<FileSystemDirectoryHandle> {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Trình duyệt không hỗ trợ chọn thư mục để lưu hàng loạt. Vui lòng dùng Chrome hoặc Edge trên HTTPS hoặc localhost.');
  }
  // Keep AbortError intact so cancellation is not reported as a save failure.
  return window.showDirectoryPicker({ id: '360-batch', mode: 'readwrite' });
}

/** Keep Unicode, discard path components and make a portable filename stem. */
export function safeBatchStem(name: string): string {
  let stem = (name.split(/[\\/]/).pop() || '').normalize('NFC')
    .replace(/\.(360project|jpe?g|png|webp|avif|tiff?|bmp|gif)$/i, '')
    .replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '')
    .trim().replace(/[. ]+$/g, '');
  // Bound component size without splitting Unicode code points.
  stem = Array.from(stem).slice(0, 60).join('').replace(/[. ]+$/g, '');
  if (!stem || /^\.+$/.test(stem)) stem = 'panorama';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return stem;
}

function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** Reserve before creating: share the set across saves in the same batch. */
export async function allocateBatchFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  extension: '360project' | BatchExportFormat,
  reservedNames: Set<string> = new Set(),
): Promise<{ name: string; handle: FileSystemFileHandle }> {
  const stem = safeBatchStem(name);
  for (let suffix = 1; ; suffix++) {
    const candidate = `${stem}${suffix === 1 ? '' : ` (${suffix})`}.${extension}`;
    const key = nameKey(candidate);
    if (Array.from(reservedNames).some((reserved) => nameKey(reserved) === key)) continue;
    reservedNames.add(candidate);
    try {
      await directory.getFileHandle(candidate);
      continue;
    } catch (error) {
      // A directory with this name also occupies the entry. Never turn denied
      // permission or other I/O failures into permission to overwrite.
      if ((error as { name?: string })?.name === 'TypeMismatchError') continue;
      if ((error as { name?: string })?.name !== 'NotFoundError') throw error;
    }
    return { name: candidate, handle: await directory.getFileHandle(candidate, { create: true }) };
  }
}

/** The only intentional overwrite path; callers must retain the chosen handle. */
export async function updateProjectFile(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try { await writable.abort(error); } catch { /* Preserve the original failure. */ }
    throw error;
  }
}

export async function writeProjectToDirectory(
  directory: FileSystemDirectoryHandle,
  name: string,
  blob: Blob,
  reservedNames: Set<string> = new Set(),
): Promise<{ name: string; handle: FileSystemFileHandle }> {
  const file = await allocateBatchFile(directory, name, '360project', reservedNames);
  await updateProjectFile(file.handle, blob);
  return file;
}

export async function exportBatchToDirectory(options: {
  directory: FileSystemDirectoryHandle;
  items: readonly BatchExportItem[];
  format: BatchExportFormat;
  quality: number;
  naming?: 'project' | 'original';
  exportImage?: (request: BatchExportRequest) => Promise<Blob>;
  onProgress?: (completed: number, total: number, result: BatchExportResult) => void;
}): Promise<BatchExportResult[]> {
  const { directory, format, quality, naming = 'project', onProgress } = options;
  const exportImage = options.exportImage ?? api.image.export;
  // Clone before the first await: switching tabs or editing cannot change a run.
  const items = structuredClone(options.items.map(({ id, projectName, originalName, project }) =>
    ({ id, projectName, originalName, project })));
  const reservedNames = new Set<string>();
  const results: BatchExportResult[] = [];
  for (const item of items) {
    let result: BatchExportResult;
    try {
      const blob = await exportImage({
        path: item.project.imagePath,
        layers: item.project.layers,
        horizon: item.project.horizon,
        format,
        quality,
      });
      const file = await allocateBatchFile(directory,
        naming === 'original' ? item.originalName : item.projectName, format, reservedNames);
      await updateProjectFile(file.handle, blob);
      result = { id: item.id, name: file.name };
    } catch (error) {
      result = { id: item.id, error: error instanceof Error ? error.message : String(error) };
    }
    results.push(result);
    onProgress?.(results.length, items.length, result);
  }
  return results;
}
