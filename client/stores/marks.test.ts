import test from 'node:test';
import assert from 'node:assert/strict';
import type { SelectionDraft } from '../../shared/types';
import { useProjectStore } from './project';

const selection = (prompt = 'p'): SelectionDraft => ({
  sourceView: '360',
  mode: 'free-select',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  viewport: { width: 1120, height: 761 },
  tileCoords: { x: 0, y: 0, w: 640, h: 480 },
  viewPose: { yaw: 10, pitch: 5, roll: 0, fov: 60 },
  prompt,
});

function fresh() {
  const store = useProjectStore.getState();
  store.reset();
  store.openImage('a.jpg', 10000, 5000);
}

test('marks get unique ids, keep their order and can be removed or cleared', () => {
  fresh();
  const { addMarks } = useProjectStore.getState();
  addMarks([
    { name: 'A', kind: 'window', yaw: [0, 10], pitch: [0, 5] },
    { name: 'B', kind: 'window', yaw: [20, 30], pitch: [0, 5] },
  ]);
  const marks = useProjectStore.getState().marks;
  assert.deepEqual(marks.map((mark) => mark.name), ['A', 'B']);
  assert.notEqual(marks[0].id, marks[1].id);
  useProjectStore.getState().removeMark(marks[0].id);
  assert.deepEqual(useProjectStore.getState().marks.map((mark) => mark.name), ['B']);
  useProjectStore.getState().clearMarks();
  assert.deepEqual(useProjectStore.getState().marks, []);
});

test('opening another image drops the marks and stops drawing', () => {
  fresh();
  useProjectStore.getState().addMarks([{ name: 'A', kind: 'window', yaw: [0, 10], pitch: [0, 5] }]);
  useProjectStore.getState().setMarksUi({ open: true, draw: true });
  useProjectStore.getState().openImage('b.jpg', 10000, 5000);
  const state = useProjectStore.getState();
  assert.deepEqual(state.marks, []);
  assert.equal(state.marksUi.draw, false);
  assert.equal(state.marksUi.open, true, 'the panel stays open');
});

test('resetting the project drops the marks and stops drawing', () => {
  fresh();
  useProjectStore.getState().addMarks([{ name: 'A', kind: 'window', yaw: [0, 10], pitch: [0, 5] }]);
  useProjectStore.getState().setMarksUi({ draw: true });
  useProjectStore.getState().reset();
  assert.deepEqual(useProjectStore.getState().marks, []);
  assert.equal(useProjectStore.getState().marksUi.draw, false);
});

test('setMarksUi merges the patch', () => {
  fresh();
  // The store is a singleton and keeps the panel flags across reset, so start from a known state.
  useProjectStore.getState().setMarksUi({ open: false, grid: true, draw: false });
  useProjectStore.getState().setMarksUi({ grid: false });
  assert.deepEqual(useProjectStore.getState().marksUi, { open: false, grid: false, draw: false });
});

test('addDraftLayer adds a named draft layer and stays on the viewing screen', () => {
  fresh();
  useProjectStore.getState().addDraftLayer(selection('Remove it'), 'tile-1', 640, 480, 'Cửa A');
  useProjectStore.getState().addDraftLayer(selection(), 'tile-2', 800, 600, 'Chân máy');
  const state = useProjectStore.getState();
  assert.deepEqual(state.layers.map((layer) => [layer.name, layer.status, layer.order, layer.type]), [
    ['Cửa A', 'draft', 1, 'perspective'],
    ['Chân máy', 'draft', 2, 'perspective'],
  ]);
  assert.deepEqual(state.layers[0].tileCoords, { x: 0, y: 0, w: 640, h: 480 });
  assert.equal(state.layers[0].resultImageId, 'tile-1');
  assert.equal(state.layers[0].yaw, 10);
  assert.equal(state.workflow, 'viewing');
  assert.equal(state.activeLayerId, null);
  assert.equal(state.hasUnsavedChanges, true);
});

test('a draft layer opens in the editor with its prompt already filled in', () => {
  fresh();
  useProjectStore.getState().addDraftLayer(selection('Remove it'), 'tile-1', 640, 480, 'Cửa A');
  const id = useProjectStore.getState().layers[0].id;
  useProjectStore.getState().openLayerEditor(id);
  const state = useProjectStore.getState();
  assert.equal(state.workflow, 'canvas-edit');
  assert.equal(state.activeLayerId, id);
  assert.equal(state.selectionDraft?.prompt, 'Remove it');
});
