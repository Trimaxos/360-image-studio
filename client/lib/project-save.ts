// Save / Save As for .360project files. Save writes back to the file the project was opened from (or last saved to);
// Save As always asks for a new place. The target is resolved before any network work: the browser's pickers and
// permission prompts need the user's click to still be active, and packaging a large project can take seconds.
import type { ProjectFile } from '../../shared/types';
import { useProjectStore } from '../stores/project';
import { useBatchStore } from '../stores/batch';
import { api } from './api';
import { pickBatchDirectory, safeBatchStem, updateProjectFile } from './batch-files';
import { downloadBlob } from './canvas-exchange';
import { useConfirmStore } from './confirm-dialog';

export interface ProjectFileSource { handle?: FileSystemFileHandle; name: string; size?: number; lastModified?: number }
export type SaveMode = 'save' | 'saveAs';
export interface SaveDeps {
  supportsFileSystemAccess(): boolean;
  pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle>;
  pickDirectory(): Promise<FileSystemDirectoryHandle>;
  ensureWritable(handle: FileSystemFileHandle): Promise<boolean>;
  confirm(message: string): boolean | Promise<boolean>;
  download(blob: Blob, name: string): void;
}

const PROJECT_TYPES = [{ description: '360 Image Studio project', accept: { 'application/zip': ['.360project'] } }];

/** The real browser. `folderPrompt` is told (with a message, then null) while the folder picker is open. */
export function browserSaveDeps(hooks: { folderPrompt?(message: string | null): void } = {}): SaveDeps {
  return {
    supportsFileSystemAccess: () => typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function',
    pickSaveFile: (suggestedName) => window.showSaveFilePicker!({ suggestedName, id: '360-project', types: PROJECT_TYPES }),
    async pickDirectory() {
      const name = useBatchStore.getState().currentFile?.name;
      hooks.folderPrompt?.(name ? `Chọn thư mục chứa “${name}” để lưu đè (chỉ hỏi khi chưa biết file nằm đâu).` : 'Chọn thư mục để lưu project.');
      try { return await pickBatchDirectory(); } finally { hooks.folderPrompt?.(null); }
    },
    async ensureWritable(handle) {
      const mode = { mode: 'readwrite' as const };
      if ((await handle.queryPermission?.(mode)) === 'granted') return true;
      return ((await handle.requestPermission?.(mode)) ?? 'granted') === 'granted';
    },
    confirm: (message) => useConfirmStore.getState().ask(message),
    download: (blob, name) => downloadBlob(blob, name),
  };
}

export function snapshotProject(): ProjectFile {
  const current = useProjectStore.getState();
  if (!current.imagePath) throw new Error('Chưa mở ảnh.');
  return structuredClone({ version: 5, mode: current.imageMode, imagePath: current.imagePath,
    originalName: useBatchStore.getState().originalName || current.imagePath.split(/[\\/]/).pop(),
    layers: current.layers, horizon: current.horizon });
}

const abort = (message: string) => Object.assign(new Error(message), { name: 'AbortError' });

/**
 * Take back a file this save made if nothing was written to it: a save that fails while packaging must not leave an empty
 * .360project behind. Best effort (not every browser can remove a file); a file with content is never touched.
 */
async function removeIfEmpty(handle: FileSystemFileHandle, directory?: FileSystemDirectoryHandle): Promise<void> {
  try {
    if ((await handle.getFile()).size !== 0) return;
    if (directory) await directory.removeEntry(handle.name);
    else await (handle as FileSystemFileHandle & { remove?(): Promise<void> }).remove?.();
  } catch { /* the save error is what matters; the person can delete an empty file */ }
}
const notFound = (error: unknown) => (error as { name?: string })?.name === 'NotFoundError';

/** The file name a save would use: the current file's, else "<original image stem>.360project". */
export function suggestedProjectName(): string {
  const current = useBatchStore.getState().currentFile;
  if (current?.name) return current.name;
  const original = useBatchStore.getState().originalName || useProjectStore.getState().imagePath?.split(/[\\/]/).pop() || 'project';
  return `${safeBatchStem(original)}.360project`;
}

async function sameFile(handle: FileSystemFileHandle, source: ProjectFileSource): Promise<boolean> {
  if (source.size === undefined || source.lastModified === undefined) return false;
  const file = await handle.getFile();
  return file.size === source.size && file.lastModified === source.lastModified;
}

/**
 * A project opened without a handle (file input, automation): find its file by name in a folder the person picks.
 * The remembered folder is tried first; a folder is remembered only after the file was found (or created there on request).
 */
async function locateInFolder(source: ProjectFileSource, deps: SaveDeps): Promise<{ handle: FileSystemFileHandle; discard?: () => Promise<void> }> {
  const batch = useBatchStore.getState();
  const remembered = batch.directory;
  if (remembered) {
    try { return { handle: await confirmSameFile(await remembered.getFileHandle(source.name), remembered, source, deps) }; }
    catch (error) { if (!notFound(error)) throw error; }
  }
  const directory = await deps.pickDirectory();
  let existing: FileSystemFileHandle;
  try {
    existing = await directory.getFileHandle(source.name);
  } catch (error) {
    if (!notFound(error)) throw error;
    if (!(await deps.confirm(`Không thấy “${source.name}” trong thư mục “${directory.name}”. Lưu thành file mới ở đó?`))) throw abort('Đã huỷ lưu.');
    const created = await directory.getFileHandle(source.name, { create: true });
    batch.setDirectory(directory);
    return { handle: created, discard: () => removeIfEmpty(created, directory) };
  }
  const handle = await confirmSameFile(existing, directory, source, deps);
  batch.setDirectory(directory);
  return { handle };
}

async function confirmSameFile(handle: FileSystemFileHandle, directory: FileSystemDirectoryHandle, source: ProjectFileSource,
  deps: SaveDeps): Promise<FileSystemFileHandle> {
  if (await sameFile(handle, source)) return handle;
  if (!(await deps.confirm(`“${source.name}” trong thư mục “${directory.name}” khác bản bạn đã mở. Ghi đè lên file đó?`))) throw abort('Đã huỷ lưu.');
  return handle;
}

/** Where this save goes: a writable handle, or a browser download when File System Access is missing. */
async function resolveTarget(mode: SaveMode, deps: SaveDeps): Promise<{ handle?: FileSystemFileHandle; name: string; discard?: () => Promise<void> }> {
  const name = suggestedProjectName();
  if (!deps.supportsFileSystemAccess()) return { name };
  const source = useBatchStore.getState().currentFile;
  if (mode === 'saveAs' || !source) {
    const handle = await deps.pickSaveFile(name);
    return { handle, name, discard: () => removeIfEmpty(handle) };
  }
  if (source.handle) {
    if (!(await deps.ensureWritable(source.handle))) {
      throw new Error(`Trình duyệt không cấp quyền ghi vào “${source.name}”. Hãy dùng Save As để lưu chỗ khác.`);
    }
    return { handle: source.handle, name: source.handle.name };
  }
  const { handle, discard } = await locateInFolder(source, deps);
  return { handle, name: source.name, discard };
}

export async function saveProject(mode: SaveMode, options: { addToBatch?: boolean; deps?: SaveDeps } = {}): Promise<'saved' | 'downloaded'> {
  const deps = options.deps ?? browserSaveDeps();
  const before = useProjectStore.getState();
  if (!before.imagePath) throw new Error('Chưa mở ảnh.');
  if (before.workflow !== 'viewing') throw new Error('Hãy Apply và quay lại màn hình xem trước khi lưu project.');
  const batchBefore = useBatchStore.getState();
  const sourceBefore = batchBefore.currentFile;
  const entryBefore = batchBefore.items.find((item) => item.id === batchBefore.activeId);
  const target = await resolveTarget(mode, deps);
  const project = snapshotProject();
  try {
    const blob = await api.project.download(project);
    if (!target.handle) deps.download(blob, target.name);
    else await updateProjectFile(target.handle, blob);
  } catch (error) {
    await target.discard?.();
    throw error;
  }

  // Packaging and picking take seconds: the person may have opened another project meanwhile. What was just written
  // belongs to the project that was saved; the editor and the batch entry of the project now open must not be touched.
  const sameProjectOpen = () => useProjectStore.getState().imagePath === before.imagePath
    && useBatchStore.getState().currentFile === sourceBefore
    && useBatchStore.getState().activeId === (entryBefore?.id ?? null);
  const batch = useBatchStore.getState();
  const open = sameProjectOpen();
  if (target.handle) {
    if (open) batch.setCurrentFile({ handle: target.handle, name: target.handle.name });
    if (options.addToBatch || entryBefore) {
      const id = entryBefore?.id ?? crypto.randomUUID();
      const originalName = project.originalName ?? 'image';
      batch.upsert({ id, projectName: target.handle.name, originalName, project, width: before.imageWidth, height: before.imageHeight,
        fileHandle: target.handle });
      if (open) batch.setCurrent(id, originalName);
    }
  }
  // Never clear changes made while packaging/writing an older snapshot.
  const after = useProjectStore.getState();
  if (after.imagePath === before.imagePath && after.layers === before.layers
    && after.horizon === before.horizon && after.imageMode === before.imageMode) after.markProjectSaved();
  return target.handle ? 'saved' : 'downloaded';
}

/**
 * File menu → Auto item (?auto=1 only): the server writes the project into its projects folder, so the automation needs
 * no file dialog. It never overwrites; the answer says where the file went. Manual Save is not involved.
 */
export async function saveProjectToFolder(): Promise<{ path: string; name: string }> {
  const before = useProjectStore.getState();
  if (!before.imagePath) throw new Error('Chưa mở ảnh.');
  if (before.workflow !== 'viewing') throw new Error('Hãy Apply và quay lại màn hình xem trước khi lưu project.');
  const saved = await api.project.saveToFolder(snapshotProject(), suggestedProjectName());
  // Never clear changes made while the server was writing an older snapshot.
  const after = useProjectStore.getState();
  if (after.imagePath === before.imagePath && after.layers === before.layers
    && after.horizon === before.horizon && after.imageMode === before.imageMode) after.markProjectSaved();
  return saved;
}

/**
 * File → Download Project: a plain copy through the browser's download. A free project counts as saved afterwards
 * (as before); a batch item does not, because "Xuất batch" exports the item's own snapshot, which a download leaves stale.
 */
export async function downloadProject(options: { deps?: SaveDeps } = {}): Promise<void> {
  const deps = options.deps ?? browserSaveDeps();
  const before = useProjectStore.getState();
  if (!before.imagePath) throw new Error('Chưa mở ảnh.');
  const inBatch = useBatchStore.getState().activeId !== null;
  const blob = await api.project.download(snapshotProject());
  deps.download(blob, suggestedProjectName());
  const after = useProjectStore.getState();
  if (!inBatch && after.imagePath === before.imagePath && after.layers === before.layers
    && after.horizon === before.horizon && after.imageMode === before.imageMode) after.markProjectSaved();
}
