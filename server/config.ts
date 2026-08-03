import dotenv from 'dotenv';
dotenv.config();

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // Cloud AI (fal.ai)
  falAiKey: process.env.FAL_AI_KEY || '',
  falAiModel: process.env.AI_MODEL || 'fal-ai/flux-2/klein/9b/edit',
  // Local AI (FLUX.1-Fill-dev GGUF)
  localAiEnabled: process.env.LOCAL_AI_ENABLED === 'true',
  localAiAutoStart: process.env.LOCAL_AI_AUTO_START === 'true',
  localAiGgufPath: process.env.LOCAL_AI_GGUF_PATH || './models/flux1-fill-dev-Q4_K_M.gguf',
  localAiPython: process.env.LOCAL_AI_PYTHON || 'python3',
  localAiPort: parseInt(process.env.LOCAL_AI_PORT || '8765', 10),
  localAiBaseUrl: normalizeBaseUrl(
    process.env.LOCAL_AI_BASE_URL || `http://127.0.0.1:${process.env.LOCAL_AI_PORT || '8765'}`,
  ),
  // Translate
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
  localModels: [
    {
      id: 'local/flux1-fill-dev-q4-k-m',
      displayName: 'FLUX.1 Fill Dev Q4_K_M',
      path: process.env.LOCAL_AI_GGUF_PATH || './models/flux1-fill-dev-Q4_K_M.gguf',
      capabilities: ['inpainting', 'image-edit'] as const,
      enabled: process.env.LOCAL_AI_ENABLED === 'true',
    },
  ],
};
