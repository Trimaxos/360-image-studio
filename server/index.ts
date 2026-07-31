import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
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

// ===== Local AI Startup =====

let localAiProcess: ChildProcess | null = null;

async function startLocalAi() {
  if (!config.localAiEnabled) {
    console.log('[AI] localAiEnabled=false, using cloud only');
    return;
  }
  if (!config.localAiAutoStart) {
    console.log('[AI] Local model configured; auto-start disabled');
    return;
  }
  try {
    const fs = await import('fs/promises');
    await fs.access(config.localAiGgufPath);
  } catch {
    console.log(`[AI] Model not found at ${config.localAiGgufPath}, using cloud only`);
    return;
  }

  console.log('[AI] Starting local AI server...');
  localAiProcess = spawn(config.localAiPython, [
    new URL('./services/local_ai_server.py', import.meta.url).pathname,
    String(config.localAiPort),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  localAiProcess.stderr?.on('data', (d) => process.stderr.write(`[local-ai] ${d}`));

  // Wait for health check
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    try {
      const res = await fetch(`${config.localAiBaseUrl}/health`);
      const health = res.ok ? await res.json() as { status?: string } : null;
      if (health?.status === 'ready') {
        console.log(`[AI] Local AI ready on port ${config.localAiPort}`);
        return;
      }
    } catch { /* still loading */ }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Timeout: kill and skip
  console.log('[AI] Local AI failed to start within 60s, using cloud only');
  localAiProcess.kill();
  localAiProcess = null;
}

function stopLocalAi() {
  if (localAiProcess) {
    localAiProcess.kill('SIGTERM');
    setTimeout(() => {
      if (localAiProcess && !localAiProcess.killed) {
        localAiProcess.kill('SIGKILL');
      }
    }, 5000);
  }
}

// Start local AI, then listen
startLocalAi().then(() => {
  app.listen(config.port, () => {
    console.log(`360 Image Studio running on http://localhost:${config.port}`);
  });
});

process.on('SIGINT', () => { stopLocalAi(); process.exit(); });
process.on('SIGTERM', () => { stopLocalAi(); process.exit(); });
