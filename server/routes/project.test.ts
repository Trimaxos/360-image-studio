import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProjectToV4, migrateProjectToV5 } from './project';

test('migrating a v4 project to v5 records 360 mode', () => {
  const project: { version: number; mode?: '360' | 'flat'; layers: any[] } = {
    version: 4,
    layers: [],
  };
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, '360');
});

test('migrating preserves an explicit flat mode', () => {
  const project: { version: number; mode?: '360' | 'flat'; layers: any[] } = {
    version: 4,
    mode: 'flat',
    layers: [],
  };
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, 'flat');
});

test('a v2 project migrates to v5 through v4 with variants and 360 mode', () => {
  const project: any = {
    version: 2,
    layers: [{
      id: 'layer-1',
      resultImageId: 'legacy-result',
      status: 'committed',
      tileCoords: { x: 0, y: 0, w: 100, h: 100 },
    }],
  };
  migrateProjectToV4(project);
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, '360');
  assert.equal(project.layers[0].variants.length, 1);
  assert.equal(project.layers[0].variants[0].resultImageId, 'legacy-result');
  assert.equal(project.layers[0].variants[0].applied, true);
});

test('migrating normalizes an invalid mode to 360', () => {
  const project: any = { version: 4, mode: 'panorama', layers: [] };
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, '360');
});
