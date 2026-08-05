import { config } from '../config';
import sharp from 'sharp';

const PRESERVATION_RULES = [
  'Make one minimal, localized edit to the provided image.',
  'Preserve the exact camera position, framing, crop, aspect ratio, perspective, geometry, scale, and composition.',
  'Keep every existing building, road, curb, vehicle, tree, object, sign, texture, shadow, lighting condition, color, and detail unchanged.',
  'Do not zoom, crop, rotate, reframe, recolor, relight, beautify, restyle, move, remove, replace, duplicate, or add anything unless the edit request explicitly requires it.',
  'Change only the minimum pixels necessary to satisfy the edit request and leave all other pixels visually identical to the input image.',
].join(' ');

const PRESERVATION_NEGATIVE_PROMPT = [
  'zoom, crop, reframing, camera movement, perspective change, geometry change,',
  'color shift, relighting, style change, extra objects, extra vehicles, changed road,',
  'changed buildings, changed vegetation, duplicated objects, removed objects',
].join(' ');

export function buildPreservationPrompt(editRequest: string): string {
  return `${PRESERVATION_RULES} EDIT REQUEST: ${editRequest.trim()}`;
}

export async function normalizeResultToSourceDimensions(
  sourceImage: Buffer,
  resultImage: Buffer,
): Promise<Buffer> {
  const sourceMetadata = await sharp(sourceImage).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new Error('Không đọc được kích thước ảnh nguồn.');
  }
  return sharp(resultImage)
    .resize(sourceMetadata.width, sourceMetadata.height, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
}

export interface AiProvider {
  name: 'fal';
  modelId: string;
  edit(image: string, mask: string, prompt: string): Promise<{ base64Result: string; model: string }>;
}

class FalProvider implements AiProvider {
  name = 'fal' as const;
  constructor(
    public modelId: string,
    private inputProperties: string[] = [],
  ) {}
  async edit(base64Image: string, base64Mask: string, prompt: string) {
    if (!config.falAiKey) throw new Error('FAL_AI_KEY chưa được cấu hình');

    const imageDataUri = `data:image/png;base64,${base64Image}`;
    const maskDataUri = `data:image/png;base64,${base64Mask}`;
    const props = this.inputProperties;

    // Build request body dynamically based on model's input schema
    const body: Record<string, any> = { prompt: buildPreservationPrompt(prompt) };

    // Image input: support both image_url (single) and image_urls (array)
    if (props.includes('image_urls')) {
      body.image_urls = [imageDataUri];
    } else if (props.includes('image_url')) {
      body.image_url = imageDataUri;
    } else {
      // Fallback: try image_url
      body.image_url = imageDataUri;
    }

    // Mask input: support mask_url, mask_image_url, or skip if not supported
    if (props.includes('mask_url')) {
      body.mask_url = maskDataUri;
    } else if (props.includes('mask_image_url')) {
      body.mask_image_url = maskDataUri;
    }
    // If model doesn't support mask, we don't send it — the model does prompt-only editing

    if (props.includes('negative_prompt')) {
      body.negative_prompt = PRESERVATION_NEGATIVE_PROMPT;
    }
    if (props.includes('strength')) {
      body.strength = 0.25;
    }

    // Sync mode for faster response
    if (props.includes('sync_mode')) {
      body.sync_mode = true;
    }

    const response = await fetch(`https://fal.run/${this.modelId}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${config.falAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`fal.ai error: ${response.status} ${await response.text()}`);
    const data = await response.json() as any;
    const resultUrl = data.images?.[0]?.url ?? data.image?.url ?? data.url;
    if (!resultUrl) throw new Error('fal.ai không trả về ảnh');
    const imageResponse = await fetch(resultUrl);
    if (!imageResponse.ok) throw new Error(`Không tải được kết quả fal.ai: HTTP ${imageResponse.status}`);
    const normalizedResult = await normalizeResultToSourceDimensions(
      Buffer.from(base64Image, 'base64'),
      Buffer.from(await imageResponse.arrayBuffer()),
    );
    return {
      base64Result: normalizedResult.toString('base64'),
      model: this.modelId,
    };
  }
}

export function getProviderFor(
  provider: string,
  modelId: string,
  inputProperties?: string[],
): AiProvider {
  if (provider !== 'fal') throw new Error(`Unsupported AI provider: ${provider}`);
  return new FalProvider(modelId, inputProperties);
}

export async function aiEdit(
  providerName: 'fal',
  modelId: string,
  base64Image: string,
  base64Mask: string,
  prompt: string,
  inputProperties?: string[],
) {
  const provider = getProviderFor(providerName, modelId, inputProperties);
  const result = await provider.edit(base64Image, base64Mask, prompt);
  return { ...result, provider: provider.name };
}
