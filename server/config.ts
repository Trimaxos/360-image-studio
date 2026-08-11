import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  authUsername: process.env.AUTH_USERNAME || 'admin',
  authPasswordHash: process.env.AUTH_PASSWORD_HASH
    || 'scrypt$3ed216f2c20a4a460216a7b4d26c72e8$fb37179cb06c35b9e09158132d1d78b0cdedb629c359ab6e18ff072477b4d98e5b3ee3887e557d202aeeba38d13506cd5385507844fa4b03312ecd44a04a9a06',
  // Cloud AI (fal.ai)
  falAiKey: process.env.FAL_AI_KEY || '',
  falAiModel: process.env.AI_MODEL || 'fal-ai/flux-2/klein/9b/edit',
  // Translate
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
};
