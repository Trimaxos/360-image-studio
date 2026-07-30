import { Router } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { CACHE_DIR } from '../services/image-processor';
import type { ProjectFile, ProjectLoadRequest, ProjectSaveRequest } from '../../shared/types';

export const projectRouter = Router();

const projectUpload = multer({
  storage: multer.diskStorage({
    destination: CACHE_DIR,
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `project-${timestamp}-${safeName}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// Upload .360project file — reads JSON and returns project data
projectRouter.post('/upload', projectUpload.single('project'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No project file provided' });
    const data = await fs.readFile(req.file.path, 'utf-8');
    const project = JSON.parse(data) as ProjectFile;
    if (project.version !== 2) {
      return res.status(400).json({ error: `Unsupported project version: ${project.version}` });
    }
    // Verify referenced image exists
    try {
      await fs.access(project.imagePath);
    } catch {
      return res.status(400).json({
        error: `Project references image that doesn't exist: ${project.imagePath}. Please ensure the original image is accessible.`,
      });
    }
    res.json({ project, projectPath: req.file.path });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

projectRouter.post('/load', async (req, res) => {
  try {
    const { projectPath } = req.body as ProjectLoadRequest;
    if (!projectPath?.trim()) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const data = await fs.readFile(projectPath, 'utf-8');
    const project = JSON.parse(data) as ProjectFile;

    if (project.version !== 2) {
      return res.status(400).json({ error: `Unsupported project version: ${project.version}` });
    }

    res.json(project);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Project file not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

projectRouter.post('/save', async (req, res) => {
  try {
    const { projectPath, project } = req.body as ProjectSaveRequest;
    if (!projectPath?.trim() || !project) {
      return res.status(400).json({ error: 'projectPath and project are required' });
    }

    project.version = 2;
    await fs.writeFile(projectPath, JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true, projectPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
