import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // Where /api/project/save-to-folder writes projects (the browser automation has no file dialog)
  projectsDir: path.resolve(process.env.PROJECTS_DIR || 'assets/output/projects'),
  // Cloud AI (fal.ai)
  falAiKey: process.env.FAL_AI_KEY || '',
  falAiModel: process.env.AI_MODEL || 'fal-ai/flux-2/klein/9b/edit',
  // 9router (local OpenAI-compatible gateway) — Codex image edit via ChatGPT account
  ninerouterBaseUrl: process.env.NINEROUTER_BASE_URL || 'http://localhost:20128/v1',
  ninerouterKey: process.env.NINEROUTER_API_KEY || '',
  // Translate
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
  opencodeKey: process.env.OPENCODE_API_KEY || '',
};
