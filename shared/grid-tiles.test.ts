import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGridPrompt, gridCells, suggestGrids } from './grid-tiles';

const g = (cols: number, rows: number) => ({ cols, rows });

test('suggestGrids proposes grids that follow the aspect ratio and defaults to the first with 3+ cells', () => {
  const cases: Array<[number, number, Array<{ cols: number; rows: number }>, number]> = [
    [3000, 1000, [g(3, 1), g(6, 2)], 0],
    [3000, 2000, [g(2, 1), g(3, 2)], 1],
    [1000, 1000, [g(2, 2), g(3, 3)], 0],
    [1920, 1080, [g(2, 1), g(4, 2)], 1],
    [2000, 3000, [g(1, 2), g(2, 3)], 1],
    [8000, 1000, [], -1],
    [1000, 8000, [], -1],
  ];
  for (const [width, height, grids, defaultIndex] of cases) {
    assert.deepEqual(suggestGrids(width, height), { grids, defaultIndex }, `${width}x${height}`);
  }
});

test('gridCells covers the image exactly, without gaps or overlaps, left to right then top to bottom', () => {
  const cells = gridCells(1001, 667, 3, 2);
  assert.equal(cells.length, 6);
  assert.deepEqual(cells[0], { x: 0, y: 0, w: 334, h: 334 });
  assert.equal(cells[1].x, cells[0].x + cells[0].w);
  assert.equal(cells[3].y, cells[0].y + cells[0].h);
  assert.equal(cells.reduce((sum, cell) => sum + cell.w * cell.h, 0), 1001 * 667);
  const covered = new Uint8Array(1001 * 667);
  for (const cell of cells) {
    for (let y = cell.y; y < cell.y + cell.h; y += 1) for (let x = cell.x; x < cell.x + cell.w; x += 1) covered[y * 1001 + x] += 1;
  }
  assert.ok(covered.every((count) => count === 1));
});

test('buildGridPrompt states the tile count and grid', () => {
  assert.equal(
    buildGridPrompt(3, 2),
    'Chia ảnh này thành 6 tile riêng biệt theo lưới 3 cột × 2 hàng, bằng nhau. Giữ nguyên ảnh gốc, chỉ cắt, không vẽ lại, không chỉnh sửa. Các tile không chồng mép, ghép lại phải khớp đúng ảnh gốc. Xuất từng tile thành file riêng, đánh số từ trái sang phải, từ trên xuống dưới.',
  );
});
