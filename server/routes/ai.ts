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
    const {
      provider, modelId, base64Image, base64Mask, hasRegionMask, referenceImages = [], prompt,
    } = req.body as AiEditRequest;
    if (!provider || !modelId || !base64Image || !prompt) {
      return res.status(400).json({ error: 'provider, modelId, base64Image, and prompt are required' });
    }
    const modelInfo = await getModelInfo(modelId);
    if (referenceImages.length > 3) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ tối đa 3 ảnh tham chiếu.' });
    }
    if (referenceImages.length && !modelInfo?.supportsReferenceImages) {
      return res.status(400).json({ error: 'Model đã chọn không hỗ trợ ảnh tham chiếu.' });
    }
    if (referenceImages.some((image) => !image?.base64Data
      || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType))) {
      return res.status(400).json({ error: 'Ảnh tham chiếu không hợp lệ.' });
    }
    // Forward the mask whenever the model requires one structurally, OR when
    // this is a real drawn region mask (worth sending to any model that can
    // accept it, not just ones where it's mandatory).
    const forwardMask = !!modelInfo?.maskRequired || !!hasRegionMask;
    const result = await aiEdit(
      provider, modelId, base64Image, base64Mask ?? '', prompt, referenceImages,
      modelInfo?.inputProperties, modelInfo?.endpointId, modelInfo?.extraParams, forwardMask,
      !!hasRegionMask, modelInfo?.supportsCustomImageSize,
    );
    res.json(result as AiEditResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
