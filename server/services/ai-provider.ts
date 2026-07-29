import { config } from '../config';

const FAL_BASE = 'https://fal.run';

// ===== Provider Interface =====

export interface AiProvider {
  name: string;
  edit(base64Image: string, base64Mask: string, prompt: string): Promise<{ base64Result: string; model: string }>;
  isAvailable(): Promise<boolean>;
}

// ===== Local Provider: FLUX.1-Fill-dev GGUF (via Flask HTTP server) =====

export class LocalAiProvider implements AiProvider {
  name = 'local-flux1-fill';

  async isAvailable(): Promise<boolean> {
    if (!config.localAiEnabled) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${config.localAiPort}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  async edit(base64Image: string, base64Mask: string, prompt: string): Promise<{ base64Result: string; model: string }> {
    const res = await fetch(`http://127.0.0.1:${config.localAiPort}/inpaint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Image, base64Mask, prompt,
        modelPath: config.localAiGgufPath }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Local AI error: ${err.error}`);
    }

    const { base64Result } = await res.json();
    return { base64Result, model: 'FLUX.1-Fill-dev-GGUF-Q4_K_M' };
  }
}

// ===== Cloud Provider: fal.ai =====

export class FalAiProvider implements AiProvider {
  name = 'fal-ai-flux-fill';

  async isAvailable(): Promise<boolean> {
    return !!config.falAiKey;
  }

  async edit(base64Image: string, base64Mask: string, prompt: string): Promise<{ base64Result: string; model: string }> {
    const response = await fetch(`${FAL_BASE}/${config.falAiModel}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${config.falAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: `data:image/png;base64,${base64Image}`,
        mask_url: `data:image/png;base64,${base64Mask}`,
        prompt: prompt,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`fal.ai error: ${response.status} ${errText}`);
    }

    const data = await response.json() as any;
    const resultUrl = data.images?.[0]?.url || data.image?.url || data.url;

    if (!resultUrl) {
      throw new Error(`Unexpected fal.ai response: ${JSON.stringify(data)}`);
    }

    const imgResponse = await fetch(resultUrl);
    if (!imgResponse.ok) {
      throw new Error(`Failed to download result: ${imgResponse.status}`);
    }
    const buffer = await imgResponse.arrayBuffer();
    const base64Result = Buffer.from(buffer).toString('base64');

    return { base64Result, model: config.falAiModel };
  }
}

// ===== Auto-select: local trước, fallback cloud =====

export async function getProvider(): Promise<AiProvider> {
  const local = new LocalAiProvider();
  if (await local.isAvailable()) {
    console.log('[AI] Using local provider: FLUX.1-Fill-dev GGUF');
    return local;
  }

  const cloud = new FalAiProvider();
  if (await cloud.isAvailable()) {
    console.log('[AI] Using cloud provider: fal.ai flux-fill');
    return cloud;
  }

  throw new Error('No AI provider available. Set FAL_AI_KEY or LOCAL_AI_ENABLED=true');
}

// Convenience wrapper
export async function aiEdit(
  base64Image: string,
  base64Mask: string,
  prompt: string
): Promise<{ base64Result: string; model: string; provider: string }> {
  const provider = await getProvider();
  const result = await provider.edit(base64Image, base64Mask, prompt);
  return { ...result, provider: provider.name };
}
