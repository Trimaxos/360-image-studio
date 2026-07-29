import { Router } from 'express';
import { aiEdit } from '../services/ai-provider';
import { translatePrompt } from '../services/translate';
import type { AiEditRequest, AiEditResponse, TranslateRequest, TranslateResponse } from '../../shared/types';

export const aiRouter = Router();

aiRouter.post('/translate', async (req, res) => {
  try {
    const { text } = req.body as TranslateRequest;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    const result = await translatePrompt(text);
    res.json(result as TranslateResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

aiRouter.post('/edit', async (req, res) => {
  try {
    const { base64Image, base64Mask, prompt } = req.body as AiEditRequest;
    if (!base64Image || !base64Mask || !prompt) {
      return res.status(400).json({ error: 'base64Image, base64Mask, and prompt are required' });
    }
    const result = await aiEdit(base64Image, base64Mask, prompt);
    res.json(result as AiEditResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
