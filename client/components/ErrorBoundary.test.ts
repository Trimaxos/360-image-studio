import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import { setupDom } from '../test-utils/dom';

// Dynamic imports must live in this file so relative specifiers resolve
// against it; the helper hides them from tsc (jsdom ships no types).
function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

// Without an error boundary, an uncaught render error unmounts the whole app
// (blank page) and the in-memory project is unrecoverable. The boundary must
// render its fallback instead, keeping the top bar (File → Download Project) alive.
test('error boundary shows the fallback UI instead of unmounting the app', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);

  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const ErrorBoundary = (await importUnsafe('./ErrorBoundary')).default;

  function Boom(): never {
    throw new Error('boom');
  }

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const originalError = console.error;
  console.error = () => {};
  try {
    await React.act(async () => {
      root.render(createElement(ErrorBoundary, null, createElement(Boom)));
    });
    assert.match(container.innerHTML, /Có lỗi hiển thị xảy ra/);
    assert.match(container.innerHTML, /Download Project/);
  } finally {
    console.error = originalError;
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});
