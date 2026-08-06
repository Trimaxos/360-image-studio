import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config';
import { imageRouter } from './routes/image';
import { aiRouter } from './routes/ai';
import { projectRouter } from './routes/project';
import { filesystemRouter } from './routes/filesystem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// API routes
app.use('/api/image', imageRouter);
app.use('/api/ai', aiRouter);
app.use('/api/project', projectRouter);
app.use('/api/filesystem', filesystemRouter);

// Static + SPA fallback (keep at bottom)
const clientDist = path.join(__dirname, '..', 'dist', 'client');
app.use(express.static(clientDist));
app.get('{*splat}', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const server = app.listen(config.port, () => {
  console.log(`360 Image Studio running on http://localhost:${config.port}`);
});
server.on('error', (err: any) => console.error('[server error]', err.message));
server.on('close', () => console.log('[server closed]'));

process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
