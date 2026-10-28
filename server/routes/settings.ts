import { Router } from 'express';
import { SettingsInputError, saveSettings, settingsStatus } from '../settings';

export const settingsRouter = Router();

// The server allows every origin (cors()), so another web page open in the browser could otherwise point the
// 9router URL at its own server and receive the key with the next Generate. Only the app's own page may use this.
settingsRouter.use((req, res, next) => {
  const origin = req.headers.origin;
  let sameOrigin = true;
  if (origin) {
    try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; }
  }
  if (!sameOrigin) return res.status(403).json({ error: 'Chỉ chỉnh Settings được từ chính ứng dụng.' });
  next();
});

settingsRouter.get('/', (_req, res) => {
  res.json(settingsStatus());
});

settingsRouter.put('/', async (req, res) => {
  try {
    res.json(await saveSettings(req.body ?? {}));
  } catch (err: any) {
    res.status(err instanceof SettingsInputError ? 400 : 500).json({ error: err.message });
  }
});
