import { config } from '../config';

export interface AiProvider {
  name: 'local' | 'fal';
  modelId: string;
  edit(image: string, mask: string, prompt: string): Promise<{ base64Result: string; model: string }>;
}

class LocalProvider implements AiProvider {
  name = 'local' as const;
  constructor(public modelId: string) {}
  async edit(base64Image: string, base64Mask: string, prompt: string) {
    const response = await fetch(`${config.localAiBaseUrl}/inpaint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Image, base64Mask, prompt }),
      signal: AbortSignal.timeout(900_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Local AI error: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
    }
    const data = await response.json() as any;
    return { base64Result: data.base64Result, model: this.modelId };
  }
}

class FalProvider implements AiProvider {
  name = 'fal' as const;
  constructor(public modelId: string) {}
  async edit(base64Image: string, base64Mask: string, prompt: string) {
    if (!config.falAiKey) throw new Error('FAL_AI_KEY chưa được cấu hình');
    const response = await fetch(`https://fal.run/${this.modelId}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${config.falAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: `data:image/png;base64,${base64Image}`,
        mask_url: `data:image/png;base64,${base64Mask}`,
        prompt,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`fal.ai error: ${response.status} ${await response.text()}`);
    const data = await response.json() as any;
    const resultUrl = data.images?.[0]?.url ?? data.image?.url ?? data.url;
    if (!resultUrl) throw new Error('fal.ai không trả về ảnh');
    const imageResponse = await fetch(resultUrl);
    if (!imageResponse.ok) throw new Error(`Không tải được kết quả fal.ai: HTTP ${imageResponse.status}`);
    return {
      base64Result: Buffer.from(await imageResponse.arrayBuffer()).toString('base64'),
      model: this.modelId,
    };
  }
}

export function getProviderFor(provider: 'local' | 'fal', modelId: string): AiProvider {
  if (provider === 'fal') return new FalProvider(modelId);
  const model = config.localModels.find((item) => item.id === modelId);
  if (!model) throw new Error(`Local model not configured: ${modelId}`);
  if (!model.enabled) throw new Error(`Local model disabled: ${modelId}`);
  return new LocalProvider(model.id);
}

export async function aiEdit(
  providerName: 'local' | 'fal',
  modelId: string,
  base64Image: string,
  base64Mask: string,
  prompt: string,
) {
  const provider = getProviderFor(providerName, modelId);
  const result = await provider.edit(base64Image, base64Mask, prompt);
  return { ...result, provider: provider.name };
}
