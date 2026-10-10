import test from 'node:test';
import assert from 'node:assert/strict';
import { projectScreenPoint } from '../server/services/perspective-projector';
import { NADIR_PROMPT, VIEWPORT, WINDOW_PROMPT, compileMark, markRects, nadirMark, nextMarkNumber, normalizeYaw, parseMarkLines, presetRectAround, projectToViewer, type CropMark } from './crop-plan';

/** The server's own inverse (viewer pixel -> panorama direction), the independent oracle. */
function viewerToAngles(point: { x: number; y: number }, pose: { yaw: number; pitch: number; fov: number }) {
  const p = projectScreenPoint(point, VIEWPORT, { ...pose, roll: 0 }, { width: 36000, height: 18000 });
  return { yaw: p.x / 100 - 180, pitch: 90 - p.y / 100 };
}

test('normalizeYaw folds any yaw into (-180, 180]', () => {
  assert.equal(normalizeYaw(181), -179);
  assert.equal(normalizeYaw(-181), 179);
  assert.equal(normalizeYaw(180), 180);
  assert.equal(normalizeYaw(-180), 180);
  assert.equal(normalizeYaw(540), 180);
  assert.equal(normalizeYaw(0), 0);
});

test('projectToViewer matches hand-computed pixels', () => {
  const pose = { yaw: 0, pitch: 0, fov: 60 };
  // tan(20°)/(aspect·tan(30°)) = 0.4283 -> x = 1120·(1 + 0.4283)/2 = 799.87
  const right = projectToViewer(20, 0, pose)!;
  assert.ok(Math.abs(right.x - 799.87) < 0.05, `x was ${right.x}`);
  assert.ok(Math.abs(right.y - 380.5) < 0.05, `y was ${right.y}`);
  // tan(10°)/tan(30°) = 0.3054 -> y = 761·(1 − 0.3054)/2 = 264.30
  const up = projectToViewer(0, 10, pose)!;
  assert.ok(Math.abs(up.x - 560) < 0.05, `x was ${up.x}`);
  assert.ok(Math.abs(up.y - 264.3) < 0.05, `y was ${up.y}`);
  assert.equal(projectToViewer(180, 0, pose), null, 'behind the camera');
});

test('projectToViewer is the inverse of the server projection', () => {
  const cases: Array<[number, number, { yaw: number; pitch: number; fov: number }]> = [
    [20, 10, { yaw: 0, pitch: 0, fov: 60 }],
    [-170, 5, { yaw: 175, pitch: 3, fov: 70 }],
    [95, -30, { yaw: 80, pitch: -10, fov: 90 }],
    [0, 60, { yaw: 0, pitch: 50, fov: 100 }],
  ];
  for (const [yaw, pitch, pose] of cases) {
    const point = projectToViewer(yaw, pitch, pose)!;
    assert.ok(point, `(${yaw}, ${pitch}) must be in front of the camera`);
    const back = viewerToAngles(point, pose);
    assert.ok(Math.abs(normalizeYaw(back.yaw - yaw)) < 0.05, `yaw ${yaw} came back as ${back.yaw}`);
    assert.ok(Math.abs(back.pitch - pitch) < 0.05, `pitch ${pitch} came back as ${back.pitch}`);
  }
});

test('parseMarkLines reads named and unnamed lines, negatives, decimals and a reversed range', () => {
  const { marks, errors } = parseMarkLines('Cửa lớn: yaw 76..106, pitch -10..14\nyaw 20.5 .. 10, pitch 5..-3');
  assert.deepEqual(errors, []);
  assert.deepEqual(marks, [
    { name: 'Cửa lớn', kind: 'window', yaw: [76, 106], pitch: [-10, 14] },
    { name: 'Cửa 2', kind: 'window', yaw: [10, 20.5], pitch: [-3, 5] },
  ]);
});

test('parseMarkLines accepts a yaw past ±180 for a window across the seam', () => {
  const { marks, errors } = parseMarkLines('Mép: yaw 176..186, pitch -4..10');
  assert.deepEqual(errors, []);
  assert.deepEqual(marks[0].yaw, [176, 186]);
});

test('parseMarkLines names unnamed lines after the boxes already there', () => {
  const { marks } = parseMarkLines('yaw 0..10, pitch 0..5', 4);
  assert.equal(marks[0].name, 'Cửa 4');
});

test('parseMarkLines reports each bad line by number and still keeps the good ones', () => {
  const input = [
    'A: yaw 0..10, pitch 0..5',
    'yaw 0..10',
    'B: yaw 0..400, pitch 0..5',
    'C: yaw 0..10, pitch 0..95',
    'D: yaw 5..5, pitch 0..5',
    '',
    'E: yaw -20..-10, pitch 1..2',
  ].join('\n');
  const { marks, errors } = parseMarkLines(input);
  assert.deepEqual(marks.map((mark) => mark.name), ['A', 'E']);
  assert.deepEqual(errors.map((error) => error.line), [2, 3, 4, 5]);
  assert.equal(errors[0].text, 'yaw 0..10');
});

test('markRects maps degrees onto the flat image and splits a box across the seam', () => {
  const image = { width: 3600, height: 1800 }; // 10 px per degree
  assert.deepEqual(markRects({ yaw: [0, 10], pitch: [-5, 15] }, image), [
    { x: 1800, y: 750, width: 100, height: 200 },
  ]);
  assert.deepEqual(markRects({ yaw: [176, 186], pitch: [0, 10] }, image), [
    { x: 3560, y: 800, width: 40, height: 100 },
    { x: 0, y: 800, width: 60, height: 100 },
  ]);
  assert.deepEqual(markRects({ yaw: [-190, -170], pitch: [0, 10] }, image), [
    { x: 3500, y: 800, width: 100, height: 100 },
    { x: 0, y: 800, width: 100, height: 100 },
  ]);
});

test('markRects keeps a box that ends exactly on the seam in one piece (no hairline on the far edge)', () => {
  const image = { width: 10000, height: 5000 };
  for (const yaw of [[156.2, 180], [160.1, 180], [170, 180]] as Array<[number, number]>) {
    const rects = markRects({ yaw, pitch: [0, 10] }, image);
    assert.equal(rects.length, 1, `yaw ${yaw} gave ${JSON.stringify(rects)}`);
    assert.ok(rects[0].x + rects[0].width <= image.width, `yaw ${yaw} sticks out: ${JSON.stringify(rects[0])}`);
  }
});

const panorama = { width: 10000, height: 5000 };
const mark = (name: string, yaw: [number, number], pitch: [number, number]): CropMark =>
  ({ id: name, name, kind: 'window', yaw, pitch });
const insideRect = (point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

test('compileMark picks the smallest FOV that fits (hand-derived: 24°) and a matching rect', () => {
  // box 20°x10° -> margins 7° / 4° -> 34°x18°, below the 28°x21° floor only vertically -> region 34°x21°.
  // width needs tan(f/2) >= tan(17°)/(1.4717·0.9857) = 0.2107 -> f >= 23.8 -> 24.
  const spec = compileMark(mark('A', [-10, 10], [-5, 5]), { panorama });
  assert.deepEqual(spec.pose, { yaw: 0, pitch: 0, roll: 0, fov: 24 });
  assert.equal(spec.kind, 'window');
  assert.equal(spec.prompt, WINDOW_PROMPT);
  assert.deepEqual(spec.warnings, []);
  // hand-derived: the region projects to x 12.72..1107.28, y 33.56..727.44 -> whole pixels 12..1108 x 33..728 (1096x695).
  // Only 3:2 holds that inside 1120x761 (366 x 3 = 1098 wide, 366 x 2 = 732 tall), centred: x 11, y 14.
  assert.deepEqual(spec.rect, { x: 11, y: 14, width: 1098, height: 732 });
});

test('a window across the left/right seam becomes one crop centred on the seam', () => {
  const spec = compileMark(mark('Mép', [176, 186], [-4, 10]), { panorama });
  assert.equal(spec.pose.yaw, -179);
  for (const [yaw, pitch] of [[176, -4], [186, -4], [176, 10], [186, 10]] as const) {
    const point = projectToViewer(yaw, pitch, spec.pose)!;
    assert.ok(point && insideRect(point, spec.rect), `corner (${yaw}, ${pitch}) outside ${JSON.stringify(spec.rect)}`);
  }
});

test('a tiny distant window still gets at least a 28° wide crop', () => {
  const spec = compileMark(mark('Xa', [-24.5, -19.5], [-1.5, 6]), { panorama });
  const middle = spec.rect.y + spec.rect.height / 2;
  const left = viewerToAngles({ x: spec.rect.x, y: middle }, spec.pose);
  const right = viewerToAngles({ x: spec.rect.x + spec.rect.width, y: middle }, spec.pose);
  assert.ok(Math.abs(normalizeYaw(right.yaw - left.yaw)) >= 27, `span was ${right.yaw - left.yaw}`);
});

test('a wide flat box never produces a crop wider than 3:1', () => {
  const spec = compileMark(mark('Dải', [-25, 25], [0, 1]), { panorama });
  assert.ok(spec.rect.width / spec.rect.height <= 3.001, JSON.stringify(spec.rect));
  assert.ok(spec.rect.width >= 1000);
  assert.ok(spec.rect.x >= 0 && spec.rect.y >= 0);
  assert.ok(spec.rect.x + spec.rect.width <= VIEWPORT.width && spec.rect.y + spec.rect.height <= VIEWPORT.height);
});

test('a box too large for any FOV falls back to the largest preset rectangle (3:2) with a warning', () => {
  const spec = compileMark(mark('Quá lớn', [-60, 60], [0, 6]), { panorama });
  assert.equal(spec.pose.fov, 120);
  assert.deepEqual(spec.rect, { x: 0, y: 7, width: 1119, height: 746 }); // 373 x (3:2), centred
  assert.ok(spec.warnings.length >= 1);
});

test('a box near the ceiling warns about distortion but still compiles inside the viewport', () => {
  const spec = compileMark(mark('Trần', [0, 20], [60, 80]), { panorama });
  assert.ok(spec.warnings.some((warning) => warning.includes('60')), spec.warnings.join(' | '));
  assert.ok(spec.rect.x >= 0 && spec.rect.y >= 0);
  assert.ok(spec.rect.x + spec.rect.width <= VIEWPORT.width && spec.rect.y + spec.rect.height <= VIEWPORT.height);
});

test('every box PM marked on Greens 2 lands inside its own crop', () => {
  const lines = [
    'Gương trái: yaw -139.9..-117.4, pitch -7.0..13.9',
    'Gương lớn: yaw -118.0..-67.6, pitch -11.9..16.5',
    'Gương giữa: yaw -52.2..-19.4, pitch -10.3..13.2',
    'Cửa nhỏ: yaw 5.6..20.7, pitch -9.6..6.7',
    'Cửa cạnh cột: yaw 20.7..65.7, pitch -19.4..18.1',
    'Cửa lớn: yaw 69.9..112.2, pitch -23.7..24.7',
    'Hành lang: yaw 156.2..174.9, pitch -12.3..14.2',
  ].join('\n');
  const { marks, errors } = parseMarkLines(lines);
  assert.deepEqual(errors, []);
  assert.equal(marks.length, 7);
  for (const parsed of marks) {
    const spec = compileMark({ ...parsed, id: parsed.name }, { panorama });
    assert.ok(spec.pose.fov >= 20 && spec.pose.fov <= 120, `${parsed.name}: fov ${spec.pose.fov}`);
    assert.ok(spec.rect.width / spec.rect.height <= 3.001 && spec.rect.height / spec.rect.width <= 3.001, parsed.name);
    for (const yaw of parsed.yaw) {
      for (const pitch of parsed.pitch) {
        const point = projectToViewer(yaw, pitch, spec.pose)!;
        assert.ok(point && insideRect(point, spec.rect), `${parsed.name}: (${yaw}, ${pitch}) outside ${JSON.stringify(spec.rect)}`);
      }
    }
  }
});

test('the nadir crop is the fixed frame verified by hand on 08/10/2026', () => {
  const spec = compileMark(nadirMark(), { panorama });
  assert.deepEqual(spec.pose, { yaw: 0, pitch: -90, roll: 0, fov: 90 });
  assert.deepEqual(spec.rect, { x: 400, y: 212, width: 330, height: 330 });
  assert.equal(spec.kind, 'nadir');
  assert.equal(spec.prompt, NADIR_PROMPT);
  assert.deepEqual(spec.warnings, []);
});

test('parseMarkLines names the reason: a yaw wider than 180° and a box with no height', () => {
  const { marks, errors } = parseMarkLines('Rộng: yaw -100..100, pitch 0..5\nPhẳng: yaw 0..10, pitch 5..5');
  assert.deepEqual(marks, []);
  assert.deepEqual(errors.map((error) => error.line), [1, 2]);
  assert.match(errors[0].message, /rộng quá 180/);
  assert.match(errors[1].message, /bề cao/);
});

test('nextMarkNumber carries the numbering on past the highest "Cửa N" already used', () => {
  assert.equal(nextMarkNumber([]), 1);
  assert.equal(nextMarkNumber(['Cửa lớn', 'Chân máy']), 1);
  assert.equal(nextMarkNumber(['Cửa 1', 'Cửa 3', 'Cửa A']), 4);
  assert.equal(nextMarkNumber(['Cửa 10', 'Cửa 2']), 11);
});

test('a tall narrow box never produces a crop taller than 3:1 either', () => {
  const spec = compileMark(mark('Cột', [0, 1], [-30, 30]), { panorama });
  assert.ok(spec.rect.height / spec.rect.width <= 3.001, JSON.stringify(spec.rect));
  assert.ok(spec.rect.x >= 0 && spec.rect.y >= 0);
  assert.ok(spec.rect.x + spec.rect.width <= VIEWPORT.width && spec.rect.y + spec.rect.height <= VIEWPORT.height);
  for (const yaw of [0, 1]) {
    for (const pitch of [-30, 30]) {
      const point = projectToViewer(yaw, pitch, spec.pose)!;
      assert.ok(point && insideRect(point, spec.rect), `corner (${yaw}, ${pitch}) outside ${JSON.stringify(spec.rect)}`);
    }
  }
});

test('a box that cannot fit says why: too big, FOV too wide, tile over the model limit', () => {
  const spec = compileMark(mark('Quá rộng', [-50, 50], [-10, 10]), { panorama });
  const text = spec.warnings.join(' | ');
  assert.match(text, /Khung quá lớn/);
  assert.match(text, /FOV 120°/);
  assert.match(text, /vượt 3840/);
});

// The selection tool only offers these ratios and, for them, sizes the tile as whole multiples of the ratio
// (roundSelectionSize); a free ratio makes the model hand back a different aspect ("Model trả ảnh sai tỉ lệ").
const PRESETS: Array<[number, number]> = [[1, 1], [2, 3], [3, 2], [4, 3], [3, 4], [16, 9], [9, 16], [1, 2], [2, 1], [1, 3], [3, 1]];
const presetOf = (rect: { width: number; height: number }) =>
  PRESETS.find(([w, h]) => rect.width % w === 0 && rect.height % h === 0 && rect.width / w === rect.height / h);

test('every crop keeps one of the selection tool ratios exactly, as whole multiples, on a sweep of boxes', () => {
  let cases = 0;
  for (const yawCentre of [-170, -100, -30, 40, 110, 175]) {
    for (const pitchCentre of [-45, -10, 15, 50]) {
      for (const yawSpan of [6, 30, 70]) {
        for (const pitchSpan of [6, 25, 50]) {
          const box = mark(`b${cases}`, [yawCentre - yawSpan / 2, yawCentre + yawSpan / 2], [pitchCentre - pitchSpan / 2, pitchCentre + pitchSpan / 2]);
          const spec = compileMark(box, { panorama });
          const label = `${JSON.stringify(box.yaw)} ${JSON.stringify(box.pitch)} -> ${JSON.stringify(spec.rect)}`;
          assert.ok(presetOf(spec.rect), `not a preset ratio: ${label}`);
          assert.ok(spec.rect.x >= 0 && spec.rect.y >= 0, label);
          assert.ok(spec.rect.x + spec.rect.width <= VIEWPORT.width && spec.rect.y + spec.rect.height <= VIEWPORT.height, label);
          if (!spec.warnings.some((warning) => warning.includes('Khung quá lớn'))) {
            for (const yaw of box.yaw) {
              for (const pitch of box.pitch) {
                const point = projectToViewer(yaw, pitch, spec.pose)!;
                assert.ok(point && insideRect(point, spec.rect), `corner (${yaw}, ${pitch}) outside: ${label}`);
              }
            }
          }
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 216);
});

test('the nadir frame is a 1:1 preset too', () => {
  assert.deepEqual(presetOf(compileMark(nadirMark(), { panorama }).rect), [1, 1]);
});

test('presetRectAround takes the smallest preset rectangle that holds the bounds', () => {
  // a 500x500 square: 1:1 is exact; every other preset would add area
  assert.deepEqual(
    presetRectAround({ minX: 100, minY: 100, maxX: 600, maxY: 600 }, VIEWPORT),
    { x: 100, y: 100, width: 500, height: 500 },
  );
});

test('presetRectAround slides the rectangle inside the viewport instead of cutting the bounds', () => {
  // 100x700 against the left edge: 1:3 (234x702) is the smallest holder; centring would start at -59, so it sits at x 0
  assert.deepEqual(
    presetRectAround({ minX: 8, minY: 50, maxX: 108, maxY: 750 }, VIEWPORT),
    { x: 0, y: 49, width: 234, height: 702 },
  );
  // 240x100 against the top edge: 2:1 (240x120) beats 3:1 (300x100); centring would start at y -2, so it sits at y 0
  assert.deepEqual(
    presetRectAround({ minX: 500, minY: 8, maxX: 740, maxY: 108 }, VIEWPORT),
    { x: 500, y: 0, width: 240, height: 120 },
  );
  // the same against the bottom edge (viewport height 761): the rectangle ends at 761
  assert.deepEqual(
    presetRectAround({ minX: 500, minY: 653, maxX: 740, maxY: 753 }, VIEWPORT),
    { x: 500, y: 641, width: 240, height: 120 },
  );
});

test('presetRectAround says so when no preset rectangle fits the viewport', () => {
  assert.equal(presetRectAround({ minX: 5, minY: 5, maxX: 1115, maxY: 755 }, VIEWPORT), null);
});
