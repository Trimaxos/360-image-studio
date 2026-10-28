import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// URL and keys below start from .env; values saved on the Settings screen replace them (see settings.ts).
export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // Where /api/project/save-to-folder writes projects (the browser automation has no file dialog)
  projectsDir: path.resolve(process.env.PROJECTS_DIR || 'assets/output/projects'),
  // Settings screen values; in Docker HOME is the /data volume, so they survive updates
  settingsFile: path.resolve(process.env.SETTINGS_FILE || path.join(os.homedir(), '.config', '360-image-studio', 'settings.json')),
  // Cloud AI (fal.ai)
  falAiKey: process.env.FAL_AI_KEY || '',
  // 9router (local OpenAI-compatible gateway) — Codex image edit via ChatGPT account
  ninerouterBaseUrl: process.env.NINEROUTER_BASE_URL || 'http://localhost:20128/v1',
  ninerouterKey: process.env.NINEROUTER_API_KEY || '',
};
