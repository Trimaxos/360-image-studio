import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config';
import { translatePrompt } from './services/translate';
import { imageRouter } from './routes/image';
import type { TranslateRequest, TranslateResponse } from '../shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Image routes
app.use('/api/image', imageRouter);

// Translate VN → EN
app.post('/api/ai/translate', async (req, res) => {
  try {
    const { text } = req.body as TranslateRequest;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const result = await translatePrompt(text);
    res.json(result as TranslateResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Static + SPA fallback (keep at bottom)
const clientDist = path.join(__dirname, '..', 'dist', 'client');
app.use(express.static(clientDist));
app.get('{*splat}', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`360 Image Studio running on http://localhost:${config.port}`);
});
