import type { ProjectFile } from '../../shared/types';
import { useProjectStore } from '../stores/project';
import { useBatchStore, type BatchItem } from '../stores/batch';
import { api } from './api';
import { pickBatchDirectory, updateProjectFile, writeProjectToDirectory } from './batch-files';

export function snapshotProject(): ProjectFile {
  const current = useProjectStore.getState();
  if (!current.imagePath) throw new Error('Chưa mở ảnh.');
  return structuredClone({ version: 5, mode: current.imageMode, imagePath: current.imagePath,
    originalName: useBatchStore.getState().originalName || current.imagePath.split(/[\\/]/).pop(),
    layers: current.layers, horizon: current.horizon });
}

export function restoreBatchItem(item: BatchItem): void {
  const project = structuredClone(item.project);
  const store = useProjectStore.getState();
  store.reset();
  store.openImage(project.imagePath, item.width, item.height);
  useProjectStore.setState({ imageMode: project.mode, layers: project.layers, horizon: project.horizon,
    hasUnsavedChanges: false });
  useBatchStore.getState().setCurrent(item.id, item.originalName);
}

export async function saveCurrentToBatch(): Promise<void> {
  const before = useProjectStore.getState();
  if (!before.imagePath) throw new Error('Chưa mở ảnh.');
  if (before.workflow !== 'viewing') throw new Error('Hãy Apply và quay lại màn hình xem trước khi lưu project vào batch.');
  const batch = useBatchStore.getState();
  const existing = batch.items.find((item) => item.id === batch.activeId);
  // Pick before any network await to retain the browser user gesture.
  const directory = batch.directory ?? await pickBatchDirectory();
  useBatchStore.getState().setDirectory(directory);
  const project = snapshotProject();
  const blob = await api.project.download(project);
  const saved = existing?.fileHandle
    ? (await updateProjectFile(existing.fileHandle, blob), { name: existing.projectName, handle: existing.fileHandle })
    : await writeProjectToDirectory(directory, existing?.projectName ?? project.originalName ?? 'project', blob,
      new Set(batch.items.map((item) => item.projectName)));
  const id = existing?.id ?? crypto.randomUUID();
  const originalName = project.originalName ?? 'image';
  useBatchStore.getState().upsert({ id, projectName: saved.name, originalName, project,
    width: before.imageWidth, height: before.imageHeight, fileHandle: saved.handle });
  useBatchStore.getState().setCurrent(id, originalName);
  // Never clear changes made while packaging/writing an older snapshot.
  const after = useProjectStore.getState();
  if (after.imagePath === before.imagePath && after.layers === before.layers
    && after.horizon === before.horizon && after.imageMode === before.imageMode) after.markProjectSaved();
}

export async function addBatchProjects(files: File[]): Promise<string[]> {
  const errors: string[] = [];
  for (const file of files) {
    try {
      const { project } = await api.project.uploadZip(file);
      const meta = await api.image.open(project.imagePath);
      const originalName = project.originalName || file.name.replace(/\.360project$/i, '');
      useBatchStore.getState().upsert({ id: crypto.randomUUID(), projectName: file.name, originalName,
        project: structuredClone({ ...project, originalName }), width: meta.width, height: meta.height });
    } catch (reason) {
      errors.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Không mở được project.'}`);
    }
  }
  return errors;
}
