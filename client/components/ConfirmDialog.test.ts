import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import { setupDom } from '../test-utils/dom';

function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

test('the in-page question resolves with the button pressed, and a newer question cancels the older one', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const ConfirmDialog = (await importUnsafe('./ConfirmDialog')).default;
  const { useConfirmStore } = await importUnsafe('../lib/confirm-dialog');
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const press = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) => b.textContent === label);
    assert.ok(button, `button ${label}`);
    await React.act(async () => { button!.click(); });
  };
  try {
    await React.act(async () => { root.render(createElement(ConfirmDialog)); });
    assert.equal(container.querySelector('[role=dialog]'), null, 'nothing asked yet');

    let first!: Promise<boolean>;
    await React.act(async () => { first = useConfirmStore.getState().ask('Ghi đè file này?'); });
    assert.ok(container.textContent?.includes('Ghi đè file này?'));
    await press('Đồng ý');
    assert.equal(await first, true);
    assert.equal(container.querySelector('[role=dialog]'), null, 'closed after the answer');

    let second!: Promise<boolean>;
    await React.act(async () => { second = useConfirmStore.getState().ask('Lưu file mới?'); });
    await press('Không');
    assert.equal(await second, false);

    let older!: Promise<boolean>, newer!: Promise<boolean>;
    await React.act(async () => {
      older = useConfirmStore.getState().ask('câu cũ');
      newer = useConfirmStore.getState().ask('câu mới');
    });
    assert.equal(await older, false, 'the older question counts as no');
    assert.ok(container.textContent?.includes('câu mới') && !container.textContent?.includes('câu cũ'));
    await press('Đồng ý');
    assert.equal(await newer, true);
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});
