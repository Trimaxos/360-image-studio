import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // Cloud AI (fal.ai)
  falAiKey: process.env.FAL_AI_KEY || '',
  falAiModel: process.env.AI_MODEL || 'fal-ai/flux-fill',
  // Local AI (FLUX.1-Fill-dev GGUF)
  localAiEnabled: process.env.LOCAL_AI_ENABLED === 'true',
  localAiGgufPath: process.env.LOCAL_AI_GGUF_PATH || './models/flux1-fill-dev-Q4_K_M.gguf',
  localAiPython: process.env.LOCAL_AI_PYTHON || 'python3',
  localAiPort: parseInt(process.env.LOCAL_AI_PORT || '8765', 10),
  // Translate
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
};
