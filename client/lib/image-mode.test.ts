import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImageMode, resolveImageMode } from './image-mode';

test('2:1 images are treated as 360 panoramas', () => {
  assert.equal(detectImageMode(4000, 2000), '360');
  assert.equal(detectImageMode(8192, 4096), '360');
});

test('mode detection tolerates 5% around the 2:1 ratio', () => {
  assert.equal(detectImageMode(1900, 1000), '360');
  assert.equal(detectImageMode(2100, 1000), '360');
  assert.equal(detectImageMode(1899, 1000), 'flat');
  assert.equal(detectImageMode(2101, 1000), 'flat');
});

test('non-panorama aspect ratios are treated as flat images', () => {
  assert.equal(detectImageMode(1920, 1080), 'flat');
  assert.equal(detectImageMode(1000, 1000), 'flat');
  assert.equal(detectImageMode(1080, 1920), 'flat');
});

test('missing dimensions default to flat instead of mounting the 360 viewer', () => {
  assert.equal(detectImageMode(0, 0), 'flat');
});

test('invalid dimensions such as NaN default to flat', () => {
  assert.equal(detectImageMode(NaN, 100), 'flat');
});

test('resolveImageMode prefers a valid saved mode over detection', () => {
  assert.equal(resolveImageMode('flat', '360'), 'flat');
  assert.equal(resolveImageMode('360', 'flat'), '360');
});

test('resolveImageMode falls back to detection for missing or invalid saved modes', () => {
  assert.equal(resolveImageMode(undefined, 'flat'), 'flat');
  assert.equal(resolveImageMode('panorama', '360'), '360');
});
