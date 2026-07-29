import { Router } from 'express';
import fs from 'fs/promises';
import type { ProjectFile, ProjectLoadRequest, ProjectSaveRequest } from '../../shared/types';

export const projectRouter = Router();

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
