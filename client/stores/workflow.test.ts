import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionsFor, transitionWorkflow } from './workflow';

test('workflow follows viewing to rectangle selection to canvas edit', () => {
  assert.equal(transitionWorkflow('viewing', 'EDIT_HERE'), 'rect-select');
  assert.equal(transitionWorkflow('rect-select', 'APPLY_RECT'), 'canvas-edit');
});

test('rectangle selection locks camera and only enables rectangle', () => {
  assert.deepEqual(permissionsFor('rect-select'), {
    camera: false,
    viewControls: false,
    rect: true,
    brush: false,
    lasso: false,
    eraser: false,
    undo: false,
    ai: false,
  });
});

test('canvas edit enables mask tools and AI only', () => {
  assert.deepEqual(permissionsFor('canvas-edit'), {
    camera: false,
    viewControls: false,
    rect: false,
    brush: true,
    lasso: true,
    eraser: true,
    undo: true,
    ai: true,
  });
});
