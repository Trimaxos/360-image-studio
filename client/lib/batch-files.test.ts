import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectFile } from '../../shared/types';
import {
  allocateBatchFile, exportBatchToDirectory, pickBatchDirectory,
  safeBatchStem, updateProjectFile, writeProjectToDirectory,
} from './batch-files';

function fakeDirectory(existing: string[] = []) {
  const files = new Map<string, Blob>(existing.map((name) => [name, new Blob(['old'])]));
  const handles = new Map<string, FileSystemFileHandle>();
  const directory = {
    name: 'batch',
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      if (!files.has(name)) files.set(name, new Blob());
      if (!handles.has(name)) handles.set(name, {
        name,
        async createWritable() {
          let pending: Blob;
          return {
            async write(blob: Blob) { pending = blob; },
            async close() { files.set(name, pending); },
            async abort() {},
          };
        },
      } as FileSystemFileHandle);
      return handles.get(name)!;
    },
  } as FileSystemDirectoryHandle;
  return { directory, files };
}

const project = (imagePath: string): ProjectFile => ({
  version: 5, mode: '360', imagePath, layers: [], horizon: { roll: 0, pitch: 0, yaw: 0 },
});

test('safe stems preserve Unicode and strip paths, extension, invalid and reserved names', () => {
  assert.equal(safeBatchStem('C:\\folder\\Ảnh biển?:*.jpg'), 'Ảnh biển');
  assert.equal(safeBatchStem('../../旅行.png'), '旅行');
  assert.equal(safeBatchStem('..'), 'panorama');
  assert.equal(safeBatchStem('CON'), '_CON');
  assert.equal(safeBatchStem('NUL.txt'), '_NUL.txt');
  assert.equal(safeBatchStem('a\u0000b. '), 'ab');
  assert.equal(safeBatchStem('e\u0301.png'), 'é');
});

test('project writes suffix disk and reserved collisions; explicit update reuses handle', async () => {
  const { directory, files } = fakeDirectory(['Ảnh.360project']);
  const reserved = new Set(['ảnh (2).360project']);
  const first = await writeProjectToDirectory(directory, 'Ảnh.jpg', new Blob(['first']), reserved);
  assert.equal(first.name, 'Ảnh (3).360project');
  const second = await writeProjectToDirectory(directory, 'Ảnh', new Blob(['second']), reserved);
  assert.equal(second.name, 'Ảnh (4).360project');
  assert.equal(await files.get('Ảnh.360project')!.text(), 'old');
  await updateProjectFile(first.handle, new Blob(['updated']));
  assert.equal(await files.get(first.name)!.text(), 'updated');
  assert.equal(files.size, 3);
});

test('allocation treats directory collisions as occupied and propagates permission errors', async () => {
  const { directory } = fakeDirectory();
  const get = directory.getFileHandle.bind(directory);
  directory.getFileHandle = async (name, options) => {
    if (name === 'name.png') throw new DOMException('Directory', 'TypeMismatchError');
    return get(name, options);
  };
  assert.equal((await allocateBatchFile(directory, 'name', 'png')).name, 'name (2).png');
  directory.getFileHandle = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await assert.rejects(allocateBatchFile(directory, 'name', 'png'), { name: 'NotAllowedError' });
});

test('write failures abort the stream and retain the original error', async () => {
  const failure = new Error('Disk full');
  let aborted = false;
  let closed = false;
  const handle = { async createWritable() { return {
    async write() { throw failure; },
    async close() { closed = true; },
    async abort() { aborted = true; throw new Error('Abort failed'); },
  }; } } as unknown as FileSystemFileHandle;
  await assert.rejects(updateProjectFile(handle, new Blob()), (error) => error === failure);
  assert.equal(aborted, true);
  assert.equal(closed, false);
});

test('export is sequential, snapshots projects, keeps going after errors and reports progress', async () => {
  const { directory, files } = fakeDirectory(['same.webp']);
  const items = ['a', 'b', 'c'].map((id) => ({ id, projectName: 'same', originalName: `${id}.jpg`, project: project(id) }));
  const calls: string[] = [];
  const progress: number[][] = [];
  let active = 0;
  const results = await exportBatchToDirectory({
    directory, items, format: 'webp', quality: 87,
    async exportImage(request) {
      assert.equal(active++, 0);
      calls.push(request.path);
      assert.equal(request.quality, 87);
      assert.equal(request.format, 'webp');
      assert.equal(request.horizon.roll, 0);
      items[2].project.imagePath = 'changed';
      items[2].project.horizon.roll = 90;
      await Promise.resolve();
      active--;
      if (request.path === 'b') throw new Error('Export failed');
      return new Blob([request.path]);
    },
    onProgress(completed, total) { progress.push([completed, total]); },
  });
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(results, [
    { id: 'a', name: 'same (2).webp' }, { id: 'b', error: 'Export failed' }, { id: 'c', name: 'same (3).webp' },
  ]);
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  assert.equal(await files.get('same.webp')!.text(), 'old');
});

test('export supports original naming and empty batches', async () => {
  const { directory } = fakeDirectory();
  const options = { directory, format: 'avif' as const, quality: 90, exportImage: async () => new Blob() };
  assert.deepEqual(await exportBatchToDirectory({ ...options, items: [] }), []);
  assert.deepEqual(await exportBatchToDirectory({ ...options, naming: 'original', items: [
    { id: '1', projectName: 'project', originalName: '/folder/旅行.jpeg', project: project('p') },
  ] }), [{ id: '1', name: '旅行.avif' }]);
});

test('picker reports unsupported browsers and preserves cancellation identity', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    assert.throws(() => pickBatchDirectory(), /Chrome hoặc Edge/);
    const abort = new DOMException('Cancelled', 'AbortError');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      async showDirectoryPicker(options: DirectoryPickerOptions) {
        assert.equal(options.mode, 'readwrite');
        throw abort;
      },
    } });
    await assert.rejects(pickBatchDirectory(), (error) => error === abort);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
