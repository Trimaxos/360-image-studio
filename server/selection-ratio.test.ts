import test from 'node:test';
import assert from 'node:assert/strict';
import { calcPerspectiveResolution, isValidModelSize, roundSelectionSize } from '../shared/model-crop';
import { containRect, mapViewportRectToImage } from '../client/components/rect-selection';
import { fitModelOutputImageSize } from './services/ai-provider';

const ratios = [[1, 1], [2, 3], [3, 2], [4, 3], [3, 4], [16, 9], [9, 16],
  [1, 2], [2, 1], [1, 3], [3, 1]];

test('flat pixel crops and AI sizing retain every preset, including image edges', () => {
  const image = { width: 4031, height: 3023 };
  const bounds = containRect({ width: 913, height: 711 }, image);
  for (const [w, h] of ratios) {
    for (const factor of [1.01, 13.37, 137.123]) {
      const width = w * factor, height = h * factor;
      const scale = bounds.width / image.width;
      const tile = mapViewportRectToImage({
        x: bounds.x + bounds.width - width * scale,
        y: bounds.y + bounds.height - height * scale,
        width: width * scale, height: height * scale,
      }, bounds, image);
      assert.equal(tile.w * h, tile.h * w, `${w}:${h}`);
      assert.ok(tile.x >= 0 && tile.x + tile.w <= image.width);
      assert.ok(tile.y >= 0 && tile.y + tile.h <= image.height);
      const output = fitModelOutputImageSize(tile.w, tile.h);
      assert.ok(isValidModelSize(output));
      assert.equal(output.width * h, output.height * w);
    }
  }
});

test('360 native render dimensions and AI sizing retain every preset at fractional density', () => {
  for (const [w, h] of ratios) {
    for (const scaleFactor of [0.7, 1, 1.5]) {
      const size = calcPerspectiveResolution({ width: 913, height: 711 },
        { yaw: 17, pitch: -11, roll: 3, fov: 73 },
        { x: 11.1, y: 23.3, width: w * 19.137, height: h * 19.137 },
        { width: 8000, height: 4000 }, scaleFactor);
      assert.equal(size.width * h, size.height * w);
      const output = fitModelOutputImageSize(size.width, size.height);
      assert.ok(isValidModelSize(output));
      assert.equal(output.width * h, output.height * w);
    }
  }
});

test('pixel sizing is not a multiple16 grid and does not snap near-preset free ratios', () => {
  assert.deepEqual(roundSelectionSize(16 * 13.1, 9 * 13.1), { width: 208, height: 117 });
  assert.deepEqual(roundSelectionSize(401.2, 300.2), { width: 401, height: 300 });
  assert.deepEqual(roundSelectionSize(0.16, 0.09, { width: 2, height: 2 }), { width: 1, height: 1 });
});
