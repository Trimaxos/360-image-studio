import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

async function mount() {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  return { dom, container, root: createRoot(container) };
}

test('draws the grid and one rectangle per box, two for a box across the seam', async () => {
  const { dom, container, root } = await mount();
  const { MarksSvgLayer } = await importUnsafe('./MarksOverlay');
  const marks = [
    { id: 'a', name: 'A', kind: 'window', yaw: [0, 10], pitch: [-5, 15] },
    { id: 'b', name: 'B', kind: 'window', yaw: [176, 186], pitch: [0, 10] },
  ];
  try {
    await act(async () => root.render(
      createElement('svg', null, createElement(MarksSvgLayer, { width: 3600, height: 1800, marks, grid: true })),
    ));
    assert.equal(container.querySelectorAll('rect.marks-box').length, 3);
    assert.equal(container.querySelectorAll('line.marks-grid').length, 37 + 17);
    assert.equal(container.querySelectorAll('line.marks-grid.strong').length, 13 + 5);

    await act(async () => root.render(
      createElement('svg', null, createElement(MarksSvgLayer, { width: 3600, height: 1800, marks, grid: false })),
    ));
    assert.equal(container.querySelectorAll('line.marks-grid').length, 0);
    assert.equal(container.querySelectorAll('rect.marks-box').length, 3);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

const layerSelection = {
  sourceView: '360',
  mode: 'free-select',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  viewport: { width: 1120, height: 761 },
  tileCoords: { x: 0, y: 0, w: 10, h: 10 },
  viewPose: { yaw: 0, pitch: 0, roll: 0, fov: 60 },
  prompt: '',
};

/** box: the size of the overlay on screen; layerNames: layers the image already has. */
async function drag(
  points: Array<[string, number, number]>,
  { box = { width: 1000, height: 500 }, layerNames = [] as string[] } = {},
) {
  const { dom, container, root } = await mount();
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, width: box.width, height: box.height, right: box.width, bottom: box.height,
  });
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  const { useProjectStore } = await importUnsafe('../stores/project');
  const { MarkDrawOverlay } = await importUnsafe('./MarksOverlay');
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('a.jpg', 10000, 5000);
  for (const name of layerNames) useProjectStore.getState().addDraftLayer(layerSelection, 'tile', 10, 10, name);
  try {
    await act(async () => root.render(createElement(MarkDrawOverlay, { imageWidth: 10000, imageHeight: 5000 })));
    const overlay = container.querySelector('.marks-draw-overlay') as HTMLElement;
    assert.ok(overlay, 'the overlay renders');
    for (const [type, clientX, clientY] of points) {
      await act(async () => {
        overlay.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX, clientY }));
      });
    }
    return useProjectStore.getState().marks.map(({ id, ...mark }: any) => mark);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
}

test('dragging on the overlay adds a box in degrees', async () => {
  // 1000x500 px over a 10000x5000 image: x 100..300 -> 1000..3000 -> yaw -144..-72; y 100..200 -> pitch 54..18
  const marks = await drag([['pointerdown', 100, 100], ['pointermove', 300, 200], ['pointerup', 300, 200]]);
  assert.deepEqual(marks, [{ name: 'Cửa 1', kind: 'window', yaw: [-144, -72], pitch: [18, 54] }]);
});

test('a drag shorter than 6 px adds nothing', async () => {
  const marks = await drag([['pointerdown', 100, 100], ['pointermove', 103, 104], ['pointerup', 103, 104]]);
  assert.deepEqual(marks, []);
});

test('on a letterboxed view the drag is measured on the picture, not on the whole overlay', async () => {
  // 1120x760 overlay over a 2:1 image: the picture is 1120x560 with 100 px of black above and below
  // (client coordinates are whole numbers in the DOM, so the numbers are chosen to land on whole pixels).
  const box = { width: 1120, height: 760 };
  const marks = await drag([['pointerdown', 112, 156], ['pointermove', 560, 380], ['pointerup', 560, 380]], { box });
  assert.deepEqual(marks, [{ name: 'Cửa 1', kind: 'window', yaw: [-144, 0], pitch: [0, 72] }]);
});

test('a drag that starts or ends on the black bars is clamped to the picture edge', async () => {
  const box = { width: 1120, height: 760 };
  const marks = await drag([['pointerdown', 112, 10], ['pointermove', 560, 750], ['pointerup', 560, 750]], { box });
  assert.deepEqual(marks, [{ name: 'Cửa 1', kind: 'window', yaw: [-144, 0], pitch: [-90, 90] }]);
});

test('an unnamed box drawn with the mouse carries on the numbering after the layers already made', async () => {
  const marks = await drag(
    [['pointerdown', 100, 100], ['pointermove', 300, 200], ['pointerup', 300, 200]],
    { layerNames: ['Chân máy', 'Cửa 1', 'Cửa 4'] },
  );
  assert.deepEqual(marks.map((mark: any) => mark.name), ['Cửa 5']);
});
