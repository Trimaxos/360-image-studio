import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Layer, ProjectFile } from '../../shared/types';
import { useProjectStore } from '../stores/project';
import { useBatchStore } from '../stores/batch';
import { api } from './api';
import { restoreBatchItem } from './batch-project';
import { browserSaveDeps, downloadProject, saveProject, saveProjectToFolder, snapshotProject, type SaveDeps } from './project-save';

const layer = (): Layer => ({ id: 'layer', order: 1, type: 'flat', visible: true, yaw: 0, pitch: 0, roll: 0, fov: 90,
  tileCoords: { x: 0, y: 0, w: 100, h: 50 }, maskData: [], prompt: 'p', resultImageId: 'r', status: 'committed' });

function fileHandle(name: string, existing?: { size: number; lastModified: number }) {
  const writes: string[] = [];
  const handle = {
    name,
    async getFile() { return { size: existing?.size ?? 0, lastModified: existing?.lastModified ?? 0 }; },
    async createWritable() { return { async write(blob: Blob) { writes.push(await blob.text()); }, async close() {}, async abort() {} }; },
  } as unknown as FileSystemFileHandle;
  return { handle, writes };
}

function deps(over: Partial<SaveDeps> = {}) {
  const calls: string[] = [];
  const base: SaveDeps = {
    supportsFileSystemAccess: () => true,
    pickSaveFile: async (name) => { calls.push(`saveAs:${name}`); return fileHandle(name).handle; },
    pickDirectory: async () => { calls.push('dir'); throw new Error('unexpected directory picker'); },
    ensureWritable: async () => { calls.push('perm'); return true; },
    confirm: () => { calls.push('confirm'); return true; },
    download: (_blob, name) => { calls.push(`download:${name}`); },
  };
  return { deps: { ...base, ...over }, calls };
}

beforeEach(() => {
  useProjectStore.getState().reset();
  useBatchStore.setState({ items: [], directory: null, activeId: null, originalName: '', currentFile: null });
  useProjectStore.getState().openImage('/uploads/source.jpg', 1000, 500);
  useProjectStore.setState({ layers: [layer()] });
  useBatchStore.getState().setCurrent(null, 'Greens 2_hdr.jpg');
});

test('save writes in place when the project was opened with a file handle, without any picker', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip-v2']));
  const opened = fileHandle('Greens 2_hdr.360project');
  useBatchStore.getState().setCurrentFile({ handle: opened.handle, name: opened.handle.name });
  const { deps: d, calls } = deps();
  assert.equal(await saveProject('save', { deps: d }), 'saved');
  assert.deepEqual(opened.writes, ['zip-v2']);
  assert.deepEqual(calls, ['perm']);
  assert.equal(useProjectStore.getState().hasUnsavedChanges, false);
});

test('save of a file opened without a handle asks for its folder once, then overwrites the same name', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const existing = fileHandle('Greens 2_hdr.360project', { size: 10, lastModified: 5 });
  let pickedDirs = 0;
  const directory = {
    name: 'projects',
    async getFileHandle(name: string) { assert.equal(name, 'Greens 2_hdr.360project'); return existing.handle; },
  } as unknown as FileSystemDirectoryHandle;
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr.360project', size: 10, lastModified: 5 });
  const { deps: d, calls } = deps({ pickDirectory: async () => { pickedDirs++; return directory; } });
  await saveProject('save', { deps: d });
  await saveProject('save', { deps: d });
  assert.equal(pickedDirs, 1, 'folder asked once');
  assert.deepEqual(existing.writes, ['zip', 'zip']);
  assert.equal(calls.includes('confirm'), false, 'same file: no confirmation');
  assert.equal(useBatchStore.getState().currentFile?.handle, existing.handle);
});

test('a different file with the same name in the chosen folder needs confirmation; declining writes nothing', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const other = fileHandle('Greens 2_hdr.360project', { size: 999, lastModified: 7 });
  const directory = { name: 'projects', async getFileHandle() { return other.handle; } } as unknown as FileSystemDirectoryHandle;
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr.360project', size: 10, lastModified: 5 });
  const { deps: d } = deps({ pickDirectory: async () => directory, confirm: () => false });
  await assert.rejects(saveProject('save', { deps: d }), { name: 'AbortError' });
  assert.deepEqual(other.writes, []);
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
});

test('a missing file in the chosen folder is created there only after confirmation', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const created = fileHandle('Greens 2_hdr.360project');
  const asked: Array<boolean | undefined> = [];
  const directory = {
    name: 'projects',
    async getFileHandle(_name: string, options?: { create?: boolean }) {
      asked.push(options?.create);
      if (!options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return created.handle;
    },
  } as unknown as FileSystemDirectoryHandle;
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr.360project', size: 10, lastModified: 5 });
  const { deps: d, calls } = deps({ pickDirectory: async () => directory });
  await saveProject('save', { deps: d });
  assert.deepEqual(asked, [undefined, true]);
  assert.equal(calls.filter((call) => call === 'confirm').length, 1);
  assert.deepEqual(created.writes, ['zip']);
});

test('save of a new project and every save-as show the save picker with a suggested name', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const { deps: d, calls } = deps();
  await saveProject('save', { deps: d });
  await saveProject('saveAs', { deps: d });
  assert.deepEqual(calls.filter((call) => call.startsWith('saveAs')), ['saveAs:Greens 2_hdr.360project', 'saveAs:Greens 2_hdr.360project']);
});

test('without File System Access both modes download; denied permission keeps the project unsaved', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const plain = deps({ supportsFileSystemAccess: () => false });
  assert.equal(await saveProject('save', { deps: plain.deps }), 'downloaded');
  assert.deepEqual(plain.calls, ['download:Greens 2_hdr.360project']);
  useProjectStore.getState().updateLayer('layer', { prompt: 'changed' });
  useBatchStore.getState().setCurrentFile({ handle: fileHandle('x.360project').handle, name: 'x.360project' });
  const denied = deps({ ensureWritable: async () => false });
  await assert.rejects(saveProject('save', { deps: denied.deps }), /quyền ghi/);
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
});

test('saving from the batch adds the project to the list with its handle; unapplied canvas work is refused first', async (t) => {
  const download = t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  useProjectStore.setState({ workflow: 'canvas-edit' });
  const { deps: d } = deps();
  await assert.rejects(saveProject('save', { addToBatch: true, deps: d }), /Apply/);
  assert.equal(download.mock.callCount(), 0);
  useProjectStore.setState({ workflow: 'viewing' });
  await saveProject('save', { addToBatch: true, deps: d });
  const [item] = useBatchStore.getState().items;
  assert.equal(item.projectName, 'Greens 2_hdr.360project');
  assert.ok(item.fileHandle);
  assert.equal(useBatchStore.getState().activeId, item.id);
});

const projectOf = (name: string) => ({ version: 5 as const, mode: 'flat' as const, imagePath: `/uploads/${name}.jpg`,
  originalName: `${name}.jpg`, layers: [layer()], horizon: { yaw: 0, pitch: 0, roll: 0 } });

test('a save that finishes after the user opened another project leaves that project and its batch entry alone', async (t) => {
  const handleA = fileHandle('A.360project');
  const handleB = fileHandle('B.360project');
  const itemA = { id: 'a', projectName: 'A.360project', originalName: 'A.jpg', project: projectOf('a'), width: 1000, height: 500, fileHandle: handleA.handle };
  const itemB = { id: 'b', projectName: 'B.360project', originalName: 'B.jpg', project: projectOf('b'), width: 800, height: 400, fileHandle: handleB.handle };
  useBatchStore.setState({ items: [itemA, itemB] });
  restoreBatchItem(itemA);
  useProjectStore.getState().updateLayer('layer', { prompt: 'A edited' });
  let release!: (blob: Blob) => void;
  t.mock.method(api.project, 'download', () => new Promise<Blob>((resolve) => { release = resolve; }));
  const saving = saveProject('save', { deps: deps().deps });
  await new Promise((resolve) => setTimeout(resolve, 0));   // the save is now waiting for the packaged zip
  restoreBatchItem(itemB);                                  // the user switches to B while A is still being packaged
  useProjectStore.getState().updateLayer('layer', { prompt: 'B edited' });
  release(new Blob(['zip-A']));
  assert.equal(await saving, 'saved');
  assert.deepEqual(handleA.writes, ['zip-A']);
  assert.deepEqual(handleB.writes, [], 'B file is never written with the data of A');
  const batch = useBatchStore.getState();
  assert.equal(batch.activeId, 'b');
  assert.equal(batch.originalName, 'B.jpg');
  assert.equal(batch.currentFile?.handle, handleB.handle, 'the next Save of B goes to B');
  const [entryA, entryB] = batch.items;
  assert.equal(entryA.project.layers[0].prompt, 'A edited', 'the saved entry shows what was saved');
  assert.equal(entryA.fileHandle, handleA.handle);
  assert.equal(entryB, itemB, 'the entry of B is untouched');
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true, 'B keeps its own unsaved edit');
});

test('a remembered folder that does not hold the file is not trusted: the folder is asked again and the right one remembered', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const target = fileHandle('Greens 2_hdr.360project', { size: 10, lastModified: 5 });
  const wrong = { name: 'wrong', async getFileHandle() { throw Object.assign(new Error('missing'), { name: 'NotFoundError' }); } } as unknown as FileSystemDirectoryHandle;
  const right = { name: 'right', async getFileHandle() { return target.handle; } } as unknown as FileSystemDirectoryHandle;
  useBatchStore.setState({ directory: wrong });
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr.360project', size: 10, lastModified: 5 });
  let asked = 0;
  const { deps: d, calls } = deps({ pickDirectory: async () => { asked++; return right; } });
  await saveProject('save', { deps: d });
  assert.equal(asked, 1);
  assert.deepEqual(target.writes, ['zip']);
  assert.equal(calls.includes('confirm'), false, 'the same file was found: nothing to confirm');
  assert.equal(useBatchStore.getState().directory, right);
});

test('a folder is remembered only once the file was found or created there; declining leaves the memory as it was', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const empty = { name: 'empty', async getFileHandle() { throw Object.assign(new Error('missing'), { name: 'NotFoundError' }); } } as unknown as FileSystemDirectoryHandle;
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr.360project', size: 10, lastModified: 5 });
  const { deps: d } = deps({ pickDirectory: async () => empty, confirm: () => false });
  await assert.rejects(saveProject('save', { deps: d }), { name: 'AbortError' });
  assert.equal(useBatchStore.getState().directory, null);
});

test('cancelling the folder or the save picker saves nothing, remembers nothing and keeps the project unsaved', async (t) => {
  const download = t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const cancel = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
  useBatchStore.getState().setCurrentFile({ name: 'x.360project', size: 1, lastModified: 1 });
  await assert.rejects(saveProject('save', { deps: deps({ pickDirectory: async () => { throw cancel(); } }).deps }), { name: 'AbortError' });
  useBatchStore.getState().setCurrentFile(null);
  await assert.rejects(saveProject('saveAs', { deps: deps({ pickSaveFile: async () => { throw cancel(); } }).deps }), { name: 'AbortError' });
  assert.equal(download.mock.callCount(), 0, 'nothing was packaged');
  assert.equal(useBatchStore.getState().directory, null);
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
});

test('download copies the project to disk but never marks a batch item saved, so its stale snapshot still prompts', async (t) => {
  t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  const { deps: d, calls } = deps();
  await downloadProject({ deps: d });
  assert.deepEqual(calls, ['download:Greens 2_hdr.360project']);
  assert.equal(useProjectStore.getState().hasUnsavedChanges, false, 'a free project now has a copy');
  useProjectStore.getState().updateLayer('layer', { prompt: 'fixed by hand' });
  useBatchStore.setState({ items: [{ id: 'x', projectName: 'x.360project', originalName: 'Greens 2_hdr.jpg', project: snapshotProject(), width: 1000, height: 500 }], activeId: 'x' });
  await downloadProject({ deps: d });
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true, 'Xuất batch would otherwise export the old snapshot silently');
});

test('the folder question is announced while the picker is open and cleared afterwards, also when it is cancelled', async () => {
  const hints: Array<string | null> = [];
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr.360project' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      async showDirectoryPicker() { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); },
    } });
    const d = browserSaveDeps({ folderPrompt: (message) => { hints.push(message); } });
    await assert.rejects(d.pickDirectory(), { name: 'AbortError' });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
  assert.equal(hints.length, 2);
  assert.match(hints[0] ?? '', /Greens 2_hdr\.360project/);
  assert.equal(hints[1], null);
});

test('when packaging fails after a new file was made in the chosen folder, that empty file is taken back; an existing project is never touched', async (t) => {
  t.mock.method(api.project, 'download', async () => { throw new Error('packaging failed'); });
  const removed: string[] = [];
  const made = fileHandle('Greens 2_hdr.360project');             // size 0: it was just created
  const roomy = {
    name: 'projects',
    async getFileHandle(_name: string, options?: { create?: boolean }) {
      if (!options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return made.handle;
    },
    async removeEntry(name: string) { removed.push(name); },
  } as unknown as FileSystemDirectoryHandle;
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr.360project', size: 10, lastModified: 5 });
  await assert.rejects(saveProject('save', { deps: deps({ pickDirectory: async () => roomy }).deps }), /packaging failed/);
  assert.deepEqual(removed, ['Greens 2_hdr.360project'], 'the empty file made for this save is removed again');

  useBatchStore.setState({ directory: null });
  const existing = fileHandle('Greens 2_hdr.360project', { size: 10, lastModified: 5 });
  const holder = {
    name: 'projects', async getFileHandle() { return existing.handle; },
    async removeEntry(name: string) { removed.push(`WRONG: ${name}`); },
  } as unknown as FileSystemDirectoryHandle;
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr.360project', size: 10, lastModified: 5 });
  await assert.rejects(saveProject('save', { deps: deps({ pickDirectory: async () => holder }).deps }), /packaging failed/);
  assert.deepEqual(removed, ['Greens 2_hdr.360project'], 'a project that was already there stays');

  const opened = { ...fileHandle('Greens 2_hdr.360project').handle, remove: async () => { removed.push('WRONG: opened file'); } } as unknown as FileSystemFileHandle;
  useBatchStore.getState().setCurrentFile({ handle: opened, name: 'Greens 2_hdr.360project' });
  await assert.rejects(saveProject('save', { deps: deps().deps }), /packaging failed/);
  assert.deepEqual(removed, ['Greens 2_hdr.360project'], 'the file the project was opened from is never removed, even when empty');
});

test('a file made by the save picker is taken back when packaging fails (where the browser can), a file with content is kept', async (t) => {
  t.mock.method(api.project, 'download', async () => { throw new Error('packaging failed'); });
  const removed: string[] = [];
  const picked = (name: string, size: number) => ({ ...fileHandle(name, { size, lastModified: 1 }).handle, remove: async () => { removed.push(name); } }) as unknown as FileSystemFileHandle;
  await assert.rejects(saveProject('saveAs', { deps: deps({ pickSaveFile: async (name) => picked(name, 0) }).deps }), /packaging failed/);
  assert.deepEqual(removed, ['Greens 2_hdr.360project']);
  await assert.rejects(saveProject('saveAs', { deps: deps({ pickSaveFile: async (name) => picked(`old ${name}`, 5000) }).deps }), /packaging failed/);
  assert.deepEqual(removed, ['Greens 2_hdr.360project'], 'an existing project the person chose to overwrite is left as it was');
});

const savedAs = { path: 'D:\\projects\\assets\\output\\projects\\Greens 2_hdr.360project', name: 'Greens 2_hdr.360project' };

test('saving into the projects folder sends the project under the usual name, uses no picker or download, and counts as saved', async (t) => {
  const sent: Array<{ project: ProjectFile; name: string }> = [];
  t.mock.method(api.project, 'saveToFolder', async (project: ProjectFile, name: string) => { sent.push({ project, name }); return savedAs; });
  const download = t.mock.method(api.project, 'download', async () => new Blob(['zip']));
  useProjectStore.getState().updateLayer('layer', { prompt: 'fixed by hand' });
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
  const expected = snapshotProject();

  assert.deepEqual(await saveProjectToFolder(), savedAs);

  assert.deepEqual(sent, [{ project: expected, name: 'Greens 2_hdr.360project' }]);
  assert.equal(download.mock.callCount(), 0, 'the manual download path is not involved');
  assert.equal(useProjectStore.getState().hasUnsavedChanges, false);
  assert.equal(useBatchStore.getState().currentFile, null, 'the next manual Save still asks where to write');
});

test('saving into the projects folder is refused without an image or before the viewing screen, like a manual Save', async (t) => {
  const saveToFolder = t.mock.method(api.project, 'saveToFolder', async () => savedAs);
  useProjectStore.setState({ workflow: 'canvas-edit' });
  await assert.rejects(saveProjectToFolder(), /Apply/);
  useProjectStore.getState().reset();
  await assert.rejects(saveProjectToFolder(), /Chưa mở ảnh/);
  assert.equal(saveToFolder.mock.callCount(), 0);
});

test('a change made while the server writes keeps the project unsaved', async (t) => {
  let finish!: () => void;
  t.mock.method(api.project, 'saveToFolder', () => new Promise<typeof savedAs>((resolve) => { finish = () => resolve(savedAs); }));
  useProjectStore.getState().updateLayer('layer', { prompt: 'first' });
  const saving = saveProjectToFolder();
  await new Promise((resolve) => setTimeout(resolve, 0));   // the server is now writing the first snapshot
  useProjectStore.getState().updateLayer('layer', { prompt: 'second' });
  finish();
  await saving;
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true, 'the second edit is not in the file');
});

test('when the server cannot save, the error reaches the caller and the project stays unsaved', async (t) => {
  t.mock.method(api.project, 'saveToFolder', async () => { throw new Error('ENOSPC: no space left on device'); });
  useProjectStore.getState().updateLayer('layer', { prompt: 'fixed by hand' });
  await assert.rejects(saveProjectToFolder(), /ENOSPC/);
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
});

test('saving into the projects folder names the file after the image, also for a project that was opened from "<name> (3).360project"', async (t) => {
  const names: string[] = [];
  t.mock.method(api.project, 'saveToFolder', async (_project: ProjectFile, name: string) => { names.push(name); return savedAs; });
  useBatchStore.getState().setCurrentFile({ name: 'Greens 2_hdr (3).360project' });

  await saveProjectToFolder();

  assert.deepEqual(names, ['Greens 2_hdr.360project'], 'the server adds the next (N); the opened file name must not be stacked on');
});
