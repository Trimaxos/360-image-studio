import { Router } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { ZipArchive } from 'archiver';
import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'crypto';
import { CACHE_DIR } from '../services/image-processor';
import type { ProjectFile } from '../../shared/types';

export const projectRouter = Router();

const zipUpload = multer({
  storage: multer.diskStorage({
    destination: CACHE_DIR,
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `project-zip-${timestamp}-${safeName}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// Download project as ZIP bundle (.360project)
projectRouter.post('/download', async (req, res) => {
  try {
    const { project } = req.body as { project: ProjectFile };
    if (!project?.imagePath) return res.status(400).json({ error: 'project with imagePath is required' });

    await fs.access(project.imagePath);

    const tmpDir = path.join(CACHE_DIR, `project-zip-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    // Copy original image
    const origExt = path.extname(project.imagePath);
    const origCopy = path.join(tmpDir, `original${origExt}`);
    await fs.copyFile(project.imagePath, origCopy);

    // Collect referenced cache files
    const cacheDir = path.join(tmpDir, 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const seen = new Set<string>();
    for (const layer of project.layers) {
      for (const id of [layer.resultImageId, layer.equirectImageId]) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const src = path.join(CACHE_DIR, `${id}.png`);
        try {
          await fs.access(src);
          await fs.copyFile(src, path.join(cacheDir, `${id}.png`));
        } catch { /* skip missing cache files */ }
      }
    }

    // Write project.json with relative paths
    const projectJson: ProjectFile = {
      ...project,
      version: 3,
      imagePath: `original${origExt}`,
    };
    await fs.writeFile(
      path.join(tmpDir, 'project.json'),
      JSON.stringify(projectJson, null, 2),
      'utf-8',
    );

    // Stream ZIP to client
    const baseName = path.basename(project.imagePath, origExt);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.360project"`);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
    archive.pipe(res);
    archive.directory(tmpDir, false);
    await archive.finalize();

    // Cleanup temp dir
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// Upload .360project (ZIP v3 or JSON v2) — extract, map paths, return project
projectRouter.post('/upload-zip', zipUpload.single('project'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No project file provided' });

    // Detect format: ZIP files start with "PK" magic bytes
    const fh = await fs.open(req.file.path, 'r');
    const header = Buffer.alloc(2);
    await fh.read(header, 0, 2, 0);
    await fh.close();
    const isZip = header[0] === 0x50 && header[1] === 0x4b;

    if (!isZip) {
      // v2 JSON fallback — read as plain JSON
      const data = await fs.readFile(req.file.path, 'utf-8');
      const project = JSON.parse(data) as Omit<ProjectFile, 'version'> & { version: number };
      if (project.version !== 2) {
        await fs.unlink(req.file.path).catch(() => undefined);
        return res.status(400).json({ error: `Unsupported project version: ${project.version}` });
      }
      try {
        await fs.access(project.imagePath);
      } catch {
        await fs.unlink(req.file.path).catch(() => undefined);
        return res.status(400).json({
          error: `Project references image that doesn't exist: ${project.imagePath}`,
        });
      }
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.json({ project });
    }

    // v3 ZIP extraction
    const extractDir = path.join(CACHE_DIR, `project-extract-${randomUUID()}`);
    await fs.mkdir(extractDir, { recursive: true });

    // Extract ZIP using adm-zip (no shell, cross-platform)
    const zip = new AdmZip(req.file.path);

    // Zip-slip protection: validate all entry paths
    const entries = zip.getEntries();
    for (const entry of entries) {
      const resolved = path.resolve(extractDir, entry.entryName);
      if (!resolved.startsWith(extractDir + path.sep) && resolved !== extractDir) {
        await fs.rm(extractDir, { recursive: true, force: true });
        await fs.unlink(req.file.path).catch(() => undefined);
        return res.status(400).json({ error: `Invalid zip entry path: ${entry.entryName}` });
      }
    }

    zip.extractAllTo(extractDir, true);

    // Read project.json
    const projectData = await fs.readFile(path.join(extractDir, 'project.json'), 'utf-8');
    const project = JSON.parse(projectData) as Omit<ProjectFile, 'version'> & { version: number };

    if (project.version < 2 || project.version > 3) {
      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.status(400).json({ error: `Unsupported project version: ${project.version}` });
    }

    // Copy original image to CACHE_DIR
    const origPath = path.resolve(extractDir, project.imagePath);
    // Validate no traversal
    if (!origPath.startsWith(extractDir + path.sep) && origPath !== extractDir) {
      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.status(400).json({ error: 'Invalid imagePath in project.json' });
    }
    const origExt = path.extname(project.imagePath);
    const newOrigPath = path.join(CACHE_DIR, `original-${randomUUID()}${origExt}`);
    await fs.copyFile(origPath, newOrigPath);

    // Copy cache files to CACHE_DIR and build path map
    const cacheMap = new Map<string, string>();
    const extractCache = path.join(extractDir, 'cache');
    try {
      const cacheFiles = await fs.readdir(extractCache);
      for (const file of cacheFiles) {
        if (!file.endsWith('.png')) continue;
        const oldId = path.basename(file, '.png');
        const buffer = await fs.readFile(path.join(extractCache, file));
        const newId = createHash('sha256').update(buffer).digest('hex');
        await fs.writeFile(path.join(CACHE_DIR, `${newId}.png`), buffer);
        cacheMap.set(oldId, newId);
      }
    } catch { /* no cache dir — fine */ }

    // Remap layer cache IDs
    const layers = project.layers.map((layer) => ({
      ...layer,
      resultImageId: cacheMap.get(layer.resultImageId) || layer.resultImageId,
      equirectImageId: layer.equirectImageId
        ? (cacheMap.get(layer.equirectImageId) || layer.equirectImageId)
        : undefined,
    }));

    // Cleanup
    await fs.rm(extractDir, { recursive: true, force: true });
    await fs.unlink(req.file.path).catch(() => undefined);

    res.json({
      project: { ...project, imagePath: newOrigPath, layers },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
