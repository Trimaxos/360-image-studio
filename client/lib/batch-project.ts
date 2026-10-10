import { useProjectStore } from '../stores/project';
import { useBatchStore, type BatchItem } from '../stores/batch';
import { api } from './api';
import { saveProject, type SaveDeps, type SaveMode } from './project-save';

export { snapshotProject } from './project-save';

export function restoreBatchItem(item: BatchItem): void {
  const project = structuredClone(item.project);
  const store = useProjectStore.getState();
  store.reset();
  store.openImage(project.imagePath, item.width, item.height);
  useProjectStore.setState({ imageMode: project.mode, layers: project.layers, horizon: project.horizon,
    hasUnsavedChanges: false });
  useBatchStore.getState().setCurrent(item.id, item.originalName);
  useBatchStore.getState().setCurrentFile(item.fileHandle ? { handle: item.fileHandle, name: item.projectName }
    : item.sourceFile ? { ...item.sourceFile } : null);
}

/** Save the open project to its file (or a new one with Save As) and keep it in the batch list. */
export async function saveCurrentToBatch(mode: SaveMode = 'save', deps?: SaveDeps): Promise<void> {
  await saveProject(mode, { addToBatch: true, deps });
}

export type ProjectEntry = File | { file: File; handle: FileSystemFileHandle };

export async function addBatchProjects(entries: ProjectEntry[]): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of entries) {
    const file = entry instanceof File ? entry : entry.file;
    const handle = entry instanceof File ? undefined : entry.handle;
    try {
      const { project } = await api.project.uploadZip(file);
      const meta = await api.image.open(project.imagePath);
      const originalName = project.originalName || file.name.replace(/\.360project$/i, '');
      useBatchStore.getState().upsert({ id: crypto.randomUUID(), projectName: file.name, originalName,
        project: structuredClone({ ...project, originalName }), width: meta.width, height: meta.height,
        fileHandle: handle, sourceFile: { name: file.name, size: file.size, lastModified: file.lastModified } });
    } catch (reason) {
      errors.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Không mở được project.'}`);
    }
  }
  return errors;
}
