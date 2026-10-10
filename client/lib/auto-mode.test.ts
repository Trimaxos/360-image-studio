import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from '../test-utils/dom';
import { isAutoMode } from './auto-mode';

function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

test('auto mode is on only when the address carries an auto flag', () => {
  assert.equal(isAutoMode('?auto=1'), true);
  assert.equal(isAutoMode('?x=1&auto'), true);
  assert.equal(isAutoMode(''), false);
  assert.equal(isAutoMode('?autox=1'), false);
  assert.equal(isAutoMode('?x=auto'), false);
});

test('without an argument it reads the address of the page', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/?auto=1', pretendToBeVisual: true });
  setupDom(dom);
  try {
    assert.equal(isAutoMode(), true);
    dom.reconfigure({ url: 'http://localhost:5173/' });
    assert.equal(isAutoMode(), false);
  } finally {
    dom.window.close();
  }
});
