import { Router } from 'express';
import { aiEdit } from '../services/ai-provider';
import { translatePrompt } from '../services/translate';
import { getModelCatalog, getModelInfo } from '../model-catalog';
import type { AiEditRequest, AiEditResponse, TranslateRequest, TranslateResponse } from '../../shared/types';

export const aiRouter = Router();

aiRouter.get('/models', async (_req, res) => {
  try {
    res.json(await getModelCatalog());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
    const { provider, modelId, base64Image, base64Mask, prompt } = req.body as AiEditRequest;
    if (!provider || !modelId || !base64Image || !base64Mask || !prompt) {
      return res.status(400).json({ error: 'provider, modelId, base64Image, base64Mask, and prompt are required' });
    }
    const modelInfo = await getModelInfo(modelId);
    const result = await aiEdit(
      provider, modelId, base64Image, base64Mask, prompt,
      modelInfo?.inputProperties, modelInfo?.endpointId, modelInfo?.extraParams, modelInfo?.maskRequired,
    );
    res.json(result as AiEditResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
