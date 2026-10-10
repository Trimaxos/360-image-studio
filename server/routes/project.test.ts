import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import AdmZip from 'adm-zip';
import express from 'express';
import sharp from 'sharp';
import { config } from '../config';
import { CACHE_DIR } from '../services/image-processor';
import type { ProjectFile } from '../../shared/types';
import { migrateProjectToV4, migrateProjectToV5, projectRouter, writeProjectArchive } from './project';

test('migrating a v4 project to v5 records 360 mode', () => {
  const project: { version: number; mode?: '360' | 'flat'; layers: any[] } = {
    version: 4,
    layers: [],
  };
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, '360');
});

test('migrating preserves an explicit flat mode', () => {
  const project: { version: number; mode?: '360' | 'flat'; layers: any[] } = {
    version: 4,
    mode: 'flat',
    layers: [],
  };
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, 'flat');
});

test('a v2 project migrates to v5 through v4 with variants and 360 mode', () => {
  const project: any = {
    version: 2,
    layers: [{
      id: 'layer-1',
      resultImageId: 'legacy-result',
      status: 'committed',
      tileCoords: { x: 0, y: 0, w: 100, h: 100 },
    }],
  };
  migrateProjectToV4(project);
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, '360');
  assert.equal(project.layers[0].variants.length, 1);
  assert.equal(project.layers[0].variants[0].resultImageId, 'legacy-result');
  assert.equal(project.layers[0].variants[0].applied, true);
});

test('migrating normalizes an invalid mode to 360', () => {
  const project: any = { version: 4, mode: 'panorama', layers: [] };
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, '360');
});

// --- POST /api/project/save-to-folder: the automation saves a project into a folder without a file dialog ---

let tmp: string;
let imagePath: string;
let projectsDir: string;
let server: Server;
let base: string;
let folders = 0;
const savedProjectsDir = config.projectsDir;
// Result pictures live in the real cache folder (the route looks them up there); `missing` is never written.
const cacheIds = {
  result: `fixture-result-${randomUUID()}`,
  equirect: `fixture-equirect-${randomUUID()}`,
  variant: `fixture-variant-${randomUUID()}`,
  missing: `fixture-missing-${randomUUID()}`,
};

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'save-to-folder-'));
  imagePath = path.join(tmp, 'original-9f3a.jpg');
  await sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toFile(imagePath);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  for (const id of [cacheIds.result, cacheIds.equirect, cacheIds.variant]) {
    await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toFile(path.join(CACHE_DIR, `${id}.png`));
  }
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/project', projectRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/project`;
});

// Every test starts with its own empty, not yet created target folder.
beforeEach(() => {
  projectsDir = path.join(tmp, `projects-${++folders}`);
  config.projectsDir = projectsDir;
});

after(async () => {
  server.close();
  config.projectsDir = savedProjectsDir;
  for (const id of [cacheIds.result, cacheIds.equirect, cacheIds.variant]) await fs.rm(path.join(CACHE_DIR, `${id}.png`), { force: true });
  await fs.rm(tmp, { recursive: true, force: true });
});

const projectFile = (patch: Record<string, unknown> = {}) => ({
  version: 5,
  mode: '360',
  imagePath,
  originalName: 'Greens 2_hdr.jpg',
  horizon: { yaw: 0, pitch: 0, roll: 0 },
  layers: [{
    id: 'layer-1', order: 1, type: 'perspective', visible: true, status: 'committed',
    resultImageId: cacheIds.result, equirectImageId: cacheIds.equirect,
    variants: [
      { id: 'v1', resultImageId: cacheIds.variant, source: 'ai-generated', applied: true, width: 8, height: 8, createdAt: 1 },
      { id: 'v2', resultImageId: cacheIds.missing, source: 'ai-generated', applied: false, width: 8, height: 8, createdAt: 2 },
    ],
  }],
  ...patch,
});
const post = (route: string, body: unknown) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const saved = async (body: unknown) => {
  const response = await post('save-to-folder', body);
  assert.equal(response.status, 200, await response.clone().text());
  return await response.json() as { path: string; name: string };
};
const filesIn = async (dir: string) => (await fs.readdir(dir).catch(() => [] as string[])).sort();
const fileEntries = (zip: AdmZip) => zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName).sort();

test('save-to-folder writes the named .360project into a folder it creates, with the image and every picture the layers use', async () => {
  const result = await saved({ project: projectFile(), name: 'Ảnh đẹp 1' });

  assert.equal(result.name, 'Ảnh đẹp 1.360project');
  assert.equal(result.path, path.join(projectsDir, 'Ảnh đẹp 1.360project'));
  assert.deepEqual(await filesIn(projectsDir), ['Ảnh đẹp 1.360project']);
  const zip = new AdmZip(result.path);
  assert.deepEqual(fileEntries(zip), [
    `cache/${cacheIds.equirect}.png`, `cache/${cacheIds.result}.png`, `cache/${cacheIds.variant}.png`, 'original.jpg', 'project.json',
  ].sort(), 'a picture that is not in the cache is skipped, the others are packed');
  const json = JSON.parse(zip.readAsText('project.json'));
  assert.equal(json.version, 5);
  assert.equal(json.mode, '360');
  assert.equal(json.imagePath, 'original.jpg');
  assert.equal(json.layers[0].variants[0].applied, true);
  const original = await sharp(zip.readFile('original.jpg')!).metadata();
  assert.deepEqual([original.width, original.height], [64, 32]);
});

test('save-to-folder creates a deep target folder that does not exist yet', async () => {
  config.projectsDir = path.join(tmp, 'deep', 'er', 'projects');

  const result = await saved({ project: projectFile(), name: 'Deep' });

  assert.equal(result.path, path.join(tmp, 'deep', 'er', 'projects', 'Deep.360project'));
  assert.ok(new AdmZip(result.path).getEntry('project.json'));
});

test('saving a name that is taken never overwrites it: (2), (3), and the first file keeps its bytes', async () => {
  const first = await saved({ project: projectFile(), name: 'Twice' });
  const firstBytes = await fs.readFile(first.path);

  const second = await saved({ project: projectFile(), name: 'Twice.360project' });
  const third = await saved({ project: projectFile(), name: 'Twice' });

  assert.deepEqual([first.name, second.name, third.name], ['Twice.360project', 'Twice (2).360project', 'Twice (3).360project']);
  assert.deepEqual(await fs.readFile(first.path), firstBytes);
  assert.deepEqual(await filesIn(projectsDir), ['Twice (2).360project', 'Twice (3).360project', 'Twice.360project']);
});

test('three saves at the same moment under one name end up as three different complete files', async () => {
  const results = await Promise.all([1, 2, 3].map(() => saved({ project: projectFile(), name: 'Race' })));

  assert.deepEqual(results.map((result) => result.name).sort(), ['Race (2).360project', 'Race (3).360project', 'Race.360project']);
  for (const result of results) assert.ok(new AdmZip(result.path).getEntry('project.json'), `${result.name} is a complete zip`);
});

test('without a name the project takes the original image name, then the image file name', async () => {
  const fromOriginalName = await saved({ project: projectFile() });
  const fromBlankName = await saved({ project: projectFile(), name: '   ' });
  const fromImageFile = await saved({ project: projectFile({ originalName: undefined }) });

  assert.equal(fromOriginalName.name, 'Greens 2_hdr.360project');
  assert.equal(fromBlankName.name, 'Greens 2_hdr (2).360project');
  assert.equal(fromImageFile.name, 'original-9f3a.360project');
});

test('names that try to leave the folder or use characters Windows forbids are cleaned and stay inside it', async () => {
  const cases: Array<[string, string]> = [
    ['..\\..\\evil', 'evil.360project'],
    ['../../evil.360project', 'evil (2).360project'], // same cleaned name as the case above
    ['C:\\Windows\\System32\\x', 'x.360project'],
    ['/etc/passwd', 'passwd.360project'],
    ['a/b:c*?.360project', 'bc.360project'],
    ['say "hi" <now> | later', 'say hi now  later.360project'],
    ['tab\tand\nnewline', 'tabandnewline.360project'],
    ['  spaced name. . ', 'spaced name.360project'],
    ['CON', '_CON.360project'],
    ['nul.txt', '_nul.txt.360project'],
    ['???', 'project.360project'],
  ];

  for (const [name, expected] of cases) {
    const result = await saved({ project: projectFile(), name });
    assert.equal(result.name, expected, `name ${JSON.stringify(name)}`);
    assert.equal(path.dirname(result.path), projectsDir, `name ${JSON.stringify(name)} left the folder`);
  }

  assert.deepEqual((await filesIn(tmp)).filter((entry) => entry.endsWith('.360project')), [], 'nothing was written next to the folder');
});

test('a project without an image path is refused with 400 and one whose image is gone with 500, leaving no file', async () => {
  const noPath = await post('save-to-folder', { project: projectFile({ imagePath: '' }), name: 'NoPath' });
  const noProject = await post('save-to-folder', { name: 'NoProject' });
  const gone = await post('save-to-folder', { project: projectFile({ imagePath: path.join(tmp, 'gone.jpg') }), name: 'Gone' });

  assert.equal(noPath.status, 400);
  assert.equal(noProject.status, 400);
  assert.equal(gone.status, 500);
  assert.match(((await gone.json()) as { error: string }).error, /ENOENT/);
  assert.deepEqual(await filesIn(projectsDir), []);
});

test('a save that fails half way removes the file it had started', async () => {
  // The "image" is a folder: it exists, so the name is claimed, but copying it into the bundle fails.
  const broken = await post('save-to-folder', { project: projectFile({ imagePath: tmp }), name: 'Broken' });

  assert.equal(broken.status, 500);
  assert.ok(((await broken.json()) as { error: string }).error.length > 0);
  assert.deepEqual(await filesIn(projectsDir), []);
});

test('packaging leaves no temporary folder behind, whether the save works or fails', async () => {
  const tempFolders = async () => (await fs.readdir(CACHE_DIR)).filter((entry) => entry.startsWith('project-zip-')).sort();
  const existing = await tempFolders();

  await saved({ project: projectFile(), name: 'Tidy' });
  await post('save-to-folder', { project: projectFile({ imagePath: tmp }), name: 'Broken' }); // fails while packaging

  assert.deepEqual(await tempFolders(), existing);
});

test('packaging resolves only after a slow output has taken the whole zip', async () => {
  const received: Buffer[] = [];
  const slowDisk = new Writable({
    highWaterMark: 512,
    write(chunk: Buffer, _encoding, done) { received.push(chunk); setTimeout(done, 10); },
  });

  await writeProjectArchive(projectFile() as unknown as ProjectFile, slowDisk);

  assert.equal(slowDisk.writableFinished, true, 'the output was still being written when packaging reported done');
  const zip = new AdmZip(Buffer.concat(received));
  assert.deepEqual(fileEntries(zip).filter((entry) => !entry.startsWith('cache/')), ['original.jpg', 'project.json']);
});

test('download still streams the same readable zip as before the packaging was shared', async () => {
  const response = await post('download', { project: projectFile() });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="original-9f3a.360project"');
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(fileEntries(zip), [
    `cache/${cacheIds.equirect}.png`, `cache/${cacheIds.result}.png`, `cache/${cacheIds.variant}.png`, 'original.jpg', 'project.json',
  ].sort());
  assert.equal(JSON.parse(zip.readAsText('project.json')).imagePath, 'original.jpg');
});

test('download without an image path or with a vanished image answers with an error and no zip headers', async () => {
  const noPath = await post('download', { project: projectFile({ imagePath: '' }) });
  const gone = await post('download', { project: projectFile({ imagePath: path.join(tmp, 'gone.jpg') }) });

  assert.equal(noPath.status, 400);
  assert.equal(gone.status, 500);
  assert.equal(gone.headers.get('content-disposition'), null);
  assert.match(((await gone.json()) as { error: string }).error, /ENOENT/);
});
