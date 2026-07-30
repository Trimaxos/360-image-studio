import test from 'node:test';
import assert from 'node:assert/strict';
import { canUpdateViewPose, degreesToRadians, radiansToDegrees } from './view-controls';

test('view control converts degrees and radians', () => {
  assert.equal(degreesToRadians(180), Math.PI);
  assert.equal(radiansToDegrees(Math.PI / 2), 90);
});

test('view pose only changes while viewing', () => {
  assert.equal(canUpdateViewPose('viewing'), true);
  assert.equal(canUpdateViewPose('rect-select'), false);
  assert.equal(canUpdateViewPose('canvas-edit'), false);
});
