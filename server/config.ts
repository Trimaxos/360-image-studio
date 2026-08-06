import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // Cloud AI (fal.ai)
  falAiKey: process.env.FAL_AI_KEY || '',
  falAiModel: process.env.AI_MODEL || 'fal-ai/flux-2/klein/9b/edit',
  // Translate
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
};
