import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('./Viewer360.tsx', import.meta.url), 'utf8');
const themeSource = await readFile(new URL('../styles/theme.css', import.meta.url), 'utf8');
const rightSidebarSource = await readFile(new URL('../components/RightSidebar.tsx', import.meta.url), 'utf8');

test('loads the application and Photo Sphere Viewer stylesheets', () => {
  assert.match(mainSource, /import ['"]\.\/styles\/theme\.css['"]/);
  assert.match(mainSource, /import ['"]@photo-sphere-viewer\/core\/index\.css['"]/);
});

test('uses the full editor frame for the 360 viewer', () => {
  assert.match(viewerSource, /className=["']viewer-viewport["']/);
  assert.match(themeSource, /\.viewer-viewport\s*\{[^}]*width:\s*100%/s);
  assert.match(themeSource, /\.viewer-viewport\s*\{[^}]*height:\s*100%/s);
  assert.match(themeSource, /\.viewer-viewport\s*\{[^}]*max-width:\s*none/s);
});

test('initializes the 360 viewer at a 90 degree vertical FOV', () => {
  const minFov = Number(viewerSource.match(/minFov:\s*([\d.]+)/)?.[1]);
  const maxFov = Number(viewerSource.match(/maxFov:\s*([\d.]+)/)?.[1]);
  const zoomLevel = Number(viewerSource.match(/defaultZoomLvl:\s*([\d.]+)/)?.[1]);

  assert.ok(Number.isFinite(minFov), 'minFov must be numeric');
  assert.ok(Number.isFinite(maxFov), 'maxFov must be numeric');
  assert.ok(Number.isFinite(zoomLevel), 'defaultZoomLvl must be numeric');

  const defaultFov = maxFov + (zoomLevel / 100) * (minFov - maxFov);
  assert.ok(
    Math.abs(defaultFov - 90) < 0.01,
    `expected default FOV 90°, received ${defaultFov}°`,
  );
});

test('updates the view FOV in degrees instead of zoom percentage', () => {
  assert.match(
    viewerSource,
    /fov:\s*viewer\.dataHelper\.zoomLevelToFov\(zoomLevel\)/,
  );
});

test('keeps file actions from crushing the top-bar tabs', () => {
  assert.match(appSource, /<details className=["']file-menu["']/);
  assert.match(themeSource, /\.top-bar-tab\s*\{[^}]*white-space:\s*nowrap/s);
});

test('places the prompt bar below the three-column workspace like the mock', () => {
  const rightSidebarIndex = appSource.indexOf('<RightSidebar');
  const promptBarIndex = appSource.indexOf('<PromptBar');

  assert.ok(rightSidebarIndex >= 0, 'RightSidebar must be rendered');
  assert.ok(promptBarIndex > rightSidebarIndex, 'PromptBar must follow the main workspace');
});

test('keeps layers and batch in one right-hand tabbed panel', () => {
  assert.match(
    rightSidebarSource,
    /role="tablist"[\s\S]*tab === 'layers' \? <LayerPanel \/> : <BatchPanel/,
  );
});
