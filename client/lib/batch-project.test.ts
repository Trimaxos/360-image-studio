import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Layer, ProjectFile } from '../../shared/types';
import { useProjectStore } from '../stores/project';
import { useBatchStore, type BatchItem } from '../stores/batch';
import { api } from './api';
import { addBatchProjects, restoreBatchItem, saveCurrentToBatch, snapshotProject } from './batch-project';

const layer = (): Layer => ({
  id: 'layer', order: 1, type: 'flat', visible: true,
  yaw: 0, pitch: 0, roll: 0, fov: 90,
  tileCoords: { x: 0, y: 0, w: 100, h: 50 },
  maskData: [], prompt: 'original prompt', resultImageId: 'result', status: 'committed',
});
const project = (): ProjectFile => ({
  version: 5, mode: 'flat', imagePath: '/uploads/source.jpg', originalName: 'Original.jpg',
  layers: [layer()], horizon: { yaw: 12, pitch: 3, roll: 1 },
});
const item = (): BatchItem => ({
  id: 'existing', projectName: 'Original.360project', originalName: 'Original.jpg',
  project: project(), width: 1000, height: 500,
});

function mockDirectory(failure?: 'write' | 'close') {
  const writes: Blob[] = [];
  const calls: string[] = [];
  const handle = {
    name: 'Original.360project',
    async createWritable() {
      calls.push('createWritable');
      return {
        async write(blob: Blob) { calls.push('write'); if (failure === 'write') throw new Error('disk full'); writes.push(blob); },
        async close() { calls.push('close'); if (failure === 'close') throw new Error('close failed'); },
        async abort() { calls.push('abort'); },
      };
    },
  } as unknown as FileSystemFileHandle;
  const directory = {
    name: 'projects',
    async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
      calls.push(`get:${name}:${!!options?.create}`);
      if (!options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return handle;
    },
    async removeEntry() { calls.push('removeEntry'); },
  } as unknown as FileSystemDirectoryHandle;
  return { directory, handle, writes, calls };
}

beforeEach(() => {
  useProjectStore.getState().reset();
  useProjectStore.setState({ selectedModel: null });
  useBatchStore.setState({ items: [], directory: null, activeId: null, originalName: '' });
});

function openCurrent() {
  useProjectStore.getState().openImage('/uploads/source.jpg', 1000, 500);
  useProjectStore.setState({ layers: [layer()], horizon: { yaw: 12, pitch: 3, roll: 1 }, imageMode: 'flat' });
  useBatchStore.getState().setCurrent(null, 'Original.jpg');
}

test('snapshot includes project data and original filename without sharing nested state', () => {
  assert.throws(snapshotProject, /Chưa mở ảnh/);
  openCurrent();
  const snapshot = snapshotProject();
  assert.deepEqual(snapshot, project());
  useProjectStore.getState().layers[0].tileCoords.x = 9;
  useProjectStore.getState().horizon.yaw = 99;
  assert.equal(snapshot.layers[0].tileCoords.x, 0);
  assert.equal(snapshot.horizon.yaw, 12);
  useBatchStore.getState().setCurrent(null, '');
  useProjectStore.setState({ imagePath: 'C:\\photos\\fallback.jpg' });
  assert.equal(snapshotProject().originalName, 'fallback.jpg');
});

test('save writes a snapshot, retains its handle, and marks saved only after close', async (t) => {
  openCurrent();
  const fs = mockDirectory();
  useBatchStore.getState().setDirectory(fs.directory);
  const blob = new Blob(['zip']);
  t.mock.method(api.project, 'download', async (snapshot: ProjectFile) => {
    assert.deepEqual(snapshot, project());
    assert.notEqual(snapshot.layers, useProjectStore.getState().layers);
    assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
    assert.equal(useBatchStore.getState().items.length, 0);
    return blob;
  });
  await saveCurrentToBatch();
  const batch = useBatchStore.getState();
  assert.equal(batch.items.length, 1);
  assert.equal(batch.activeId, batch.items[0].id);
  assert.deepEqual(batch.items[0].project, project());
  assert.equal(batch.items[0].fileHandle, fs.handle);
  assert.equal(batch.items[0].width, 1000);
  assert.equal(batch.items[0].height, 500);
  assert.equal(batch.items[0].originalName, 'Original.jpg');
  assert.deepEqual(fs.writes, [blob]);
  assert.equal(fs.calls.at(-1), 'close');
  assert.equal(useProjectStore.getState().hasUnsavedChanges, false);
  useProjectStore.getState().updateLayer('layer', { prompt: 'later edit' });
  assert.equal(batch.items[0].project.layers[0].prompt, 'original prompt');
});

test('saving active item updates the same ID and handle without allocating another file', async (t) => {
  openCurrent();
  const fs = mockDirectory();
  const original = { ...item(), fileHandle: fs.handle };
  useBatchStore.setState({ directory: fs.directory, items: [original], activeId: original.id });
  useProjectStore.getState().updateLayer('layer', { prompt: 'updated' });
  t.mock.method(api.project, 'download', async () => new Blob(['updated zip']));
  await saveCurrentToBatch();
  assert.equal(useBatchStore.getState().items.length, 1);
  const saved = useBatchStore.getState().items[0];
  assert.equal(saved.id, original.id);
  assert.equal(saved.projectName, original.projectName);
  assert.equal(saved.fileHandle, original.fileHandle);
  assert.equal(saved.project.layers[0].prompt, 'updated');
  assert.deepEqual(fs.calls, ['createWritable', 'write', 'close']);
});

for (const failure of ['download', 'write', 'close'] as const) {
  test(`${failure} failure preserves dirty state and existing batch snapshot`, async (t) => {
    openCurrent();
    const fs = mockDirectory(failure === 'download' ? undefined : failure);
    const original = { ...item(), fileHandle: fs.handle };
    useBatchStore.setState({ directory: fs.directory, items: [original], activeId: original.id });
    useProjectStore.getState().updateLayer('layer', { prompt: 'unsaved' });
    t.mock.method(api.project, 'download', async () => {
      if (failure === 'download') throw new Error('network failed');
      return new Blob(['zip']);
    });
    await assert.rejects(saveCurrentToBatch(), /failed|disk full/);
    assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
    assert.equal(useBatchStore.getState().items[0], original);
    assert.equal(useBatchStore.getState().activeId, original.id);
    assert.equal(fs.calls.includes('abort'), failure !== 'download');
  });
}

test('edits made while packaging do not mark the newer project saved', async (t) => {
  openCurrent();
  const fs = mockDirectory();
  useBatchStore.getState().setDirectory(fs.directory);
  t.mock.method(api.project, 'download', async (snapshot: ProjectFile) => {
    useProjectStore.getState().updateLayer('layer', { prompt: 'edited during save' });
    assert.equal(snapshot.layers[0].prompt, 'original prompt');
    return new Blob(['old snapshot']);
  });
  await saveCurrentToBatch();
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
  assert.equal(useProjectStore.getState().layers[0].prompt, 'edited during save');
  assert.equal(useBatchStore.getState().items[0].project.layers[0].prompt, 'original prompt');
});

test('save rejects missing images and unapplied canvas work before API calls', async (t) => {
  const download = t.mock.method(api.project, 'download', async () => new Blob());
  await assert.rejects(saveCurrentToBatch(), /Chưa mở ảnh/);
  openCurrent();
  for (const workflow of ['rect-select', 'canvas-edit', 'generating', 'ai-review'] as const) {
    useProjectStore.setState({ workflow });
    await assert.rejects(saveCurrentToBatch(), /Apply/);
  }
  assert.equal(download.mock.callCount(), 0);
});

test('imports continue after upload and image-open errors without replacing the current editor', async (t) => {
  openCurrent();
  const current = useProjectStore.getState();
  const files = ['bad.360project', 'missing.360project', 'Good.360project', 'Other.360project']
    .map((name) => new File(['zip'], name));
  const uploaded = project();
  delete uploaded.originalName;
  const opened: string[] = [];
  t.mock.method(api.project, 'uploadZip', async (file: File) => {
    if (file.name === 'bad.360project') throw new Error('invalid zip');
    return { project: file.name === 'missing.360project' ? { ...uploaded, imagePath: '/missing' } : uploaded };
  });
  t.mock.method(api.image, 'open', async (path: string) => {
    opened.push(path);
    if (path === '/missing') throw 'unreadable';
    return { path, width: 1200, height: 600 };
  });
  const errors = await addBatchProjects(files);
  assert.deepEqual(errors, ['bad.360project: invalid zip', 'missing.360project: Không mở được project.']);
  assert.deepEqual(opened, ['/missing', uploaded.imagePath, uploaded.imagePath]);
  const batch = useBatchStore.getState();
  assert.deepEqual(batch.items.map((entry) => entry.originalName), ['Good', 'Other']);
  assert.equal(new Set(batch.items.map((entry) => entry.id)).size, 2);
  assert.equal(batch.items[0].width, 1200);
  assert.equal(batch.items[0].height, 600);
  assert.equal(batch.items[0].fileHandle, undefined);
  assert.equal(batch.activeId, null);
  assert.equal(useProjectStore.getState(), current);
  uploaded.layers[0].prompt = 'mutated response';
  assert.equal(batch.items[0].project.layers[0].prompt, 'original prompt');
});

test('empty imports do not call APIs or change the queue', async (t) => {
  const upload = t.mock.method(api.project, 'uploadZip', async () => { throw new Error('unexpected upload'); });
  const before = useBatchStore.getState();
  assert.deepEqual(await addBatchProjects([]), []);
  assert.equal(upload.mock.callCount(), 0);
  assert.equal(useBatchStore.getState(), before);
});

test('removing queue entries never touches files or the current editor', () => {
  openCurrent();
  const current = useProjectStore.getState();
  const fs = mockDirectory();
  const active = { ...item(), fileHandle: fs.handle };
  const other = { ...item(), id: 'other' };
  useBatchStore.setState({ items: [active, other], directory: fs.directory, activeId: active.id });
  useBatchStore.getState().remove('other');
  assert.equal(useBatchStore.getState().activeId, active.id);
  useBatchStore.getState().remove(active.id);
  assert.deepEqual(useBatchStore.getState().items, []);
  assert.equal(useBatchStore.getState().activeId, null);
  assert.equal(useBatchStore.getState().directory, fs.directory);
  assert.equal(useBatchStore.getState().originalName, 'Original.jpg');
  assert.equal(useProjectStore.getState(), current);
  assert.deepEqual(fs.calls, []);
});

test('restoration clones saved content and clears transient editor state', () => {
  openCurrent();
  useProjectStore.setState({
    workflow: 'ai-review', activeLayerId: 'old', activeTool: 'rect', viewMode: 'canvas',
    viewLock: { yaw: 40, pitch: 20, roll: 10, fov: 70 },
    rectSelect: { x: 1, y: 2, w: 3, h: 4, nativeW: 100, nativeH: 50 },
    regionEdit: { points: [{ x: 1, y: 2 }], maskBase64: 'mask' },
    editSnapshot: { layer: layer(), selection: null }, dirty: true,
    generatedVariants: [{ id: 'temp', base64Result: 'abc', modelId: 'model' }],
    selectedVariantId: 'temp', previewImage: 'preview', previewLayer: { id: 'preview' },
    pendingFitVariant: { layerId: 'old', variantId: 'temp' },
  });
  const saved = item();
  restoreBatchItem(saved);
  const state = useProjectStore.getState();
  assert.equal(state.imagePath, saved.project.imagePath);
  assert.equal(state.imageWidth, saved.width);
  assert.equal(state.imageHeight, saved.height);
  assert.equal(state.imageMode, 'flat');
  assert.deepEqual(state.layers, saved.project.layers);
  assert.deepEqual(state.horizon, saved.project.horizon);
  assert.equal(state.workflow, 'viewing');
  assert.equal(state.viewMode, 'viewer');
  assert.equal(state.dirty, false);
  assert.equal(state.hasUnsavedChanges, false);
  for (const key of ['activeLayerId', 'activeTool', 'viewLock', 'rectSelect', 'selectionDraft', 'regionEdit',
    'editSnapshot', 'selectedVariantId', 'previewImage', 'previewLayer', 'pendingFitVariant'] as const) {
    assert.equal(state[key], null, key);
  }
  assert.deepEqual(state.generatedVariants, []);
  assert.equal(useBatchStore.getState().activeId, saved.id);
  assert.equal(useBatchStore.getState().originalName, saved.originalName);
  state.layers[0].tileCoords.x = 99;
  state.horizon.yaw = 99;
  assert.equal(saved.project.layers[0].tileCoords.x, 0);
  assert.equal(saved.project.horizon.yaw, 12);
});
