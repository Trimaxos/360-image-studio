import test from 'node:test';
import assert from 'node:assert/strict';
import { NADIR_PROMPT, WINDOW_PROMPT } from '../../shared/crop-plan';
import { useProjectStore } from '../stores/project';
import { api } from './api';
import { createCropLayers, runCropLayers } from './crop-layers';

const panorama = { width: 10000, height: 5000 };

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const tile = { resultImageId: 'tile', width: 100, height: 100 };
const progress = () => {
  const run = useProjectStore.getState().marksRun;
  return run && { done: run.done, total: run.total };
};

function openImage(path = 'a.jpg') {
  const store = useProjectStore.getState();
  store.reset();
  store.openImage(path, 10000, 5000);
}

test('creates the nadir first, then a draft layer per mark, sending what Apply Rect sends', async (t) => {
  openImage();
  useProjectStore.getState().addMarks([{ name: 'Cửa A', kind: 'window', yaw: [-10, 10], pitch: [-5, 5] }]);
  const calls: any[] = [];
  t.mock.method(api.image, 'perspectiveRender', async (body: any) => {
    calls.push(body);
    return { resultImageId: `tile-${calls.length}`, width: 1000, height: 800, rect: body.rect };
  });
  const progress: Array<[number, number]> = [];

  const outcomes = await createCropLayers({
    imagePath: 'a.jpg', panorama, marks: useProjectStore.getState().marks, includeNadir: true,
    onProgress: (done, total) => progress.push([done, total]),
  });

  assert.deepEqual(outcomes.map((outcome) => [outcome.name, outcome.error]), [['Chân máy', undefined], ['Cửa A', undefined]]);
  assert.equal(outcomes[0].markId, undefined, 'the automatic nadir has no mark');
  assert.equal(outcomes[1].markId, useProjectStore.getState().marks[0].id);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.deepEqual(calls[0].viewPose, { yaw: 0, pitch: -90, roll: 0, fov: 90 });
  assert.deepEqual(calls[0].rect, { x: 400, y: 212, width: 330, height: 330 });
  assert.equal(calls[1].viewPose.fov, 24);
  for (const call of calls) {
    assert.equal(call.imagePath, 'a.jpg');
    assert.deepEqual(call.layers, []);
    assert.deepEqual(call.viewport, { width: 1120, height: 761 });
    assert.equal(call.mode, 'free-select');
    assert.equal(call.scaleFactor, 1);
    assert.equal(call.alignToModel, false);
  }
  const state = useProjectStore.getState();
  assert.deepEqual(state.layers.map((layer) => [layer.name, layer.status, layer.prompt]), [
    ['Chân máy', 'draft', NADIR_PROMPT],
    ['Cửa A', 'draft', WINDOW_PROMPT],
  ]);
  assert.equal(state.layers[1].selection?.sourceView, '360');
  assert.deepEqual(state.layers[1].selection?.tileCoords, { x: 0, y: 0, w: 1000, h: 800 });
  assert.equal(state.workflow, 'viewing');
});

test('one failed crop is reported and the next crops still run', async (t) => {
  openImage();
  useProjectStore.getState().addMarks([
    { name: 'A', kind: 'window', yaw: [-10, 10], pitch: [-5, 5] },
    { name: 'B', kind: 'window', yaw: [40, 60], pitch: [-5, 5] },
  ]);
  let call = 0;
  t.mock.method(api.image, 'perspectiveRender', async (body: any) => {
    call += 1;
    if (call === 1) throw new Error('server busy');
    return { resultImageId: 'tile', width: 100, height: 100, rect: body.rect };
  });

  const outcomes = await createCropLayers({
    imagePath: 'a.jpg', panorama, marks: useProjectStore.getState().marks, includeNadir: false,
  });

  assert.deepEqual(outcomes.map((outcome) => [outcome.name, outcome.error]), [['A', 'server busy'], ['B', undefined]]);
  assert.deepEqual(useProjectStore.getState().layers.map((layer) => layer.name), ['B']);
});

test('layers never land in the project of another image opened meanwhile', async (t) => {
  openImage('a.jpg');
  useProjectStore.getState().addMarks([
    { name: 'A', kind: 'window', yaw: [-10, 10], pitch: [-5, 5] },
    { name: 'B', kind: 'window', yaw: [40, 60], pitch: [-5, 5] },
  ]);
  let calls = 0;
  t.mock.method(api.image, 'perspectiveRender', async (body: any) => {
    calls += 1;
    openImage('b.jpg'); // the user opens another image while the server is rendering
    return { resultImageId: 'tile', width: 100, height: 100, rect: body.rect };
  });

  const outcomes = await createCropLayers({
    imagePath: 'a.jpg', panorama, marks: useProjectStore.getState().marks, includeNadir: false,
  });

  assert.equal(calls, 1, 'no more renders once the image changed');
  assert.ok(outcomes.every((outcome) => outcome.error), JSON.stringify(outcomes));
  assert.deepEqual(useProjectStore.getState().layers, []);
});

test('runCropLayers keeps the progress and the failures in the store and drops only the finished marks', async (t) => {
  openImage();
  useProjectStore.getState().addMarks([
    { name: 'A', kind: 'window', yaw: [-10, 10], pitch: [-5, 5] },
    { name: 'B', kind: 'window', yaw: [40, 60], pitch: [-5, 5] },
  ]);
  const renders: Array<ReturnType<typeof deferred>> = [];
  t.mock.method(api.image, 'perspectiveRender', () => { const render = deferred(); renders.push(render); return render.promise; });

  const run = runCropLayers(true);
  assert.deepEqual(progress(), { done: 0, total: 3 });
  renders[0].resolve(tile);
  await tick();
  assert.deepEqual(progress(), { done: 1, total: 3 });
  renders[1].reject(new Error('server busy'));
  await tick();
  assert.deepEqual(progress(), { done: 2, total: 3 });
  renders[2].resolve(tile);
  const outcomes = await run;

  const state = useProjectStore.getState();
  assert.deepEqual(outcomes.map((outcome) => [outcome.name, outcome.error]), [['Chân máy', undefined], ['A', 'server busy'], ['B', undefined]]);
  assert.equal(state.marksRun, null);
  assert.deepEqual(state.marks.map((mark) => mark.name), ['A'], 'the failed box stays so it can be run again');
  assert.deepEqual(state.marksFailures, ['A: server busy']);
  assert.deepEqual(state.layers.map((layer) => layer.name), ['Chân máy', 'B']);
});

test('runCropLayers ignores a second call while a run is in progress', async (t) => {
  openImage();
  useProjectStore.getState().addMarks([{ name: 'A', kind: 'window', yaw: [-10, 10], pitch: [-5, 5] }]);
  const renders: Array<ReturnType<typeof deferred>> = [];
  t.mock.method(api.image, 'perspectiveRender', () => { const render = deferred(); renders.push(render); return render.promise; });

  const first = runCropLayers(false);
  assert.deepEqual(await runCropLayers(false), [], 'the second click does nothing');
  assert.equal(renders.length, 1);
  renders[0].resolve(tile);
  assert.equal((await first).length, 1);
  assert.deepEqual(useProjectStore.getState().layers.map((layer) => layer.name), ['A']);
});

test('a run left behind by another image never touches the new image or its own run', async (t) => {
  openImage('a.jpg');
  useProjectStore.getState().addMarks([{ name: 'A', kind: 'window', yaw: [-10, 10], pitch: [-5, 5] }]);
  const renders: Array<ReturnType<typeof deferred>> = [];
  t.mock.method(api.image, 'perspectiveRender', () => { const render = deferred(); renders.push(render); return render.promise; });

  const orphan = runCropLayers(false);
  openImage('b.jpg');
  assert.equal(useProjectStore.getState().marksRun, null, 'a new image starts with no run');
  useProjectStore.getState().addMarks([{ name: 'C', kind: 'window', yaw: [30, 50], pitch: [-5, 5] }]);
  const current = runCropLayers(false);
  const runId = useProjectStore.getState().marksRun?.id;
  assert.ok(runId, 'the new image has its own run');

  renders[0].resolve(tile); // the old image's render comes back late
  await orphan;
  const middle = useProjectStore.getState();
  assert.equal(middle.marksRun?.id, runId, 'the late run neither overwrites nor clears the new run');
  assert.deepEqual(middle.marksFailures, [], 'nor does it leave its messages on the new image');
  assert.deepEqual(middle.layers, []);

  renders[1].resolve(tile);
  await current;
  assert.deepEqual(useProjectStore.getState().layers.map((layer) => layer.name), ['C']);
  assert.equal(useProjectStore.getState().marksRun, null);
});
