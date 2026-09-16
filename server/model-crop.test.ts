import test from 'node:test';
import assert from 'node:assert/strict';
import { planModelCrop, exactModelSize, isValidModelSize, planPerspectiveCrop } from '../shared/model-crop';

test('crop removes edges around the center without stretching', () => {
  assert.deepEqual(planModelCrop(1000, 700), {
    crop: { x: 4, y: 6, width: 992, height: 688 },
    output: { width: 992, height: 688 },
  });
});

test('small crops use a uniform scale to reach minimum pixels', () => {
  const { crop, output } = planModelCrop(400, 300);
  assert.ok(isValidModelSize(output));
  assert.equal(crop.width * output.height, crop.height * output.width);
  assert.ok(output.width > crop.width);
});

test('crop plans respect bounds, alignment and exact aspect across sizes', () => {
  for (const [w, h] of [[16, 16], [17, 10000], [400, 300], [5000, 800], [800, 5000],
    [5334, 4000], [16000, 8000], [3840, 2160], [1001, 999]]) {
    const { crop, output } = planModelCrop(w, h);
    assert.ok(isValidModelSize(output), `${w}x${h}`);
    assert.ok(Number.isInteger(crop.width) && Number.isInteger(crop.height));
    assert.equal(crop.width * output.height, crop.height * output.width);
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= w && crop.y + crop.height <= h);
    assert.ok(Math.abs(crop.x + crop.width / 2 - w / 2) <= 0.5);
    assert.ok(Math.abs(crop.y + crop.height / 2 - h / 2) <= 0.5);
    assert.deepEqual(exactModelSize(crop.width, crop.height), output);
    assert.deepEqual(exactModelSize(output.width, output.height), output);
  }
});

test('976x544 chooses a near-minimum canvas instead of doubling both edges', () => {
  const { crop, output } = planModelCrop(976, 544);
  assert.deepEqual({ crop, output }, {
    crop: { x: 12, y: 6, width: 952, height: 532 },
    output: { width: 1088, height: 608 },
  });
  assert.ok(output.width * output.height < 700_000);
  assert.ok(crop.width * crop.height > 500_000);
  assert.equal(crop.width * output.height, crop.height * output.width);
  assert.deepEqual(exactModelSize(crop.width, crop.height), output);
});

test('portrait and extreme aspect selections remain centered without a loss cutoff', () => {
  for (const [w, h] of [[544, 976], [5000, 100], [100, 5000]]) {
    const { crop, output } = planModelCrop(w, h);
    assert.ok(isValidModelSize(output));
    assert.equal(crop.width * output.height, crop.height * output.width);
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= w && crop.y + crop.height <= h);
  }
});

test('invalid and sub-16 crops are rejected with an actionable error', () => {
  for (const w of [0, -1, NaN, Infinity, 15]) {
    assert.throws(() => planModelCrop(w, 100), /16/);
  }
});

test('perspective preview uses panorama resolution and keeps viewport center', () => {
  const rect = { x: 200, y: 150, width: 400, height: 300 };
  const plan = planPerspectiveCrop({ width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 }, rect, { width: 8000, height: 4000 });
  assert.ok(isValidModelSize(plan.output));
  assert.equal(plan.rect.x + plan.rect.width / 2, 400);
  assert.equal(plan.rect.y + plan.rect.height / 2, 300);
  assert.ok(plan.rect.width <= rect.width && plan.rect.height <= rect.height);
  assert.ok(Math.abs(plan.rect.width / plan.rect.height - plan.output.width / plan.output.height) < 1e-10);
});
