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

// Used when the request carries a drawn region (see RegionEdit): the client
// always blends the result back so nothing outside the region survives, so
// the model doesn't need to be told to hold back — telling it to anyway (via
// the preservation prompt above) actively fights instructions like "add
// people", since that wording discourages adding anything at all.
const REGION_EDIT_RULES = [
  'Make the requested edit clearly and fully within the specified region of the image — do not hold back or make only a token, barely visible change.',
  'You may freely add, remove, recolor, resize, or otherwise change content within that region as needed to fully satisfy the request.',
  'Preserve the exact camera position, framing, perspective, and everything outside the specified region exactly unchanged.',
].join(' ');

const REGION_EDIT_NEGATIVE_PROMPT = [
  'zoom, crop, reframing, camera movement, perspective change, geometry change,',
  'changes outside the specified region, changed unrelated areas, subtle or barely visible edit',
].join(' ');

export function buildRegionEditPrompt(editRequest: string): string {
  return `${REGION_EDIT_RULES} EDIT REQUEST: ${editRequest.trim()}`;
}

export function addFalImageInputs(
  body: Record<string, any>,
  inputProperties: string[],
  sourceImageDataUri: string,
  referenceImageDataUris: string[],
): void {
  if (inputProperties.includes('image_urls')) {
    body.image_urls = [sourceImageDataUri, ...referenceImageDataUris];
  } else {
    body.image_url = sourceImageDataUri;
  }
}

// fal.ai rejects request images over ~25MB. A lossless PNG of a full-resolution
// panorama crop (e.g. 5600×3000) can exceed that easily; re-encoding as JPEG
// shrinks photographic content dramatically with negligible quality loss for
// what the AI needs to read. Only used for the outgoing request — the
// original base64Image/base64Mask (full quality, unchanged dimensions) is
// still used for local blending and for sizing the returned result.
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;

async function toRequestDataUri(base64: string, mimeType = 'image/png'): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length <= MAX_REQUEST_IMAGE_BYTES) {
    return `data:${mimeType};base64,${base64}`;
  }
  let quality = 90;
  let jpeg = await sharp(buffer).jpeg({ quality }).toBuffer();
  while (jpeg.length > MAX_REQUEST_IMAGE_BYTES && quality > 35) {
    quality -= 15;
    jpeg = await sharp(buffer).jpeg({ quality }).toBuffer();
  }
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
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
  edit(
    image: string,
    mask: string,
    prompt: string,
    referenceImages?: Array<{ base64Data: string; mimeType: string }>,
  ): Promise<{ base64Result: string; model: string }>;
}

class FalProvider implements AiProvider {
  name = 'fal' as const;
  constructor(
    public modelId: string,
    private inputProperties: string[] = [],
    private endpointId?: string,
    private extraParams?: Record<string, string | number | boolean>,
    private maskRequired?: boolean,
    private isRegionEdit?: boolean,
  ) {}
  async edit(
    base64Image: string,
    base64Mask: string,
    prompt: string,
    referenceImages: Array<{ base64Data: string; mimeType: string }> = [],
  ) {
    if (!config.falAiKey) throw new Error('FAL_AI_KEY chưa được cấu hình');

    const imageDataUri = await toRequestDataUri(base64Image);
    const maskDataUri = await toRequestDataUri(base64Mask);
    const referenceDataUris = await Promise.all(referenceImages.map(
      (image) => toRequestDataUri(image.base64Data, image.mimeType),
    ));
    const props = this.inputProperties;

    // Build request body dynamically based on model's input schema
    const body: Record<string, any> = {
      prompt: this.isRegionEdit ? buildRegionEditPrompt(prompt) : buildPreservationPrompt(prompt),
    };

    // Image input: support both image_url (single) and image_urls (array)
    addFalImageInputs(body, props, imageDataUri, referenceDataUris);

    // Mask input: only send when the model's schema requires it. There is no mask-drawing
    // UI in this app — the mask we'd send is always solid white ("edit everything"), and
    // some models (e.g. gpt-image-2) treat a fully-white mask as "discard the reference
    // image and regenerate from scratch" instead of "the whole crop is eligible for a
    // prompt-guided edit". Omitting it when optional lets those models edit in place.
    if (this.maskRequired) {
      if (props.includes('mask_url')) {
        body.mask_url = maskDataUri;
      } else if (props.includes('mask_image_url')) {
        body.mask_image_url = maskDataUri;
      }
    }

    if (props.includes('negative_prompt')) {
      body.negative_prompt = this.isRegionEdit ? REGION_EDIT_NEGATIVE_PROMPT : PRESERVATION_NEGATIVE_PROMPT;
    }
    if (props.includes('strength')) {
      // Region edits are blended back locally regardless, so the model can be
      // given more room to actually change the region (low strength biases
      // heavily toward "barely touch it", which fights additive requests).
      body.strength = this.isRegionEdit ? 0.6 : 0.25;
    }

    // Sync mode for faster response
    if (props.includes('sync_mode')) {
      body.sync_mode = true;
    }

    if (this.extraParams) Object.assign(body, this.extraParams);

    const response = await fetch(`https://fal.run/${this.endpointId ?? this.modelId}`, {
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
  endpointId?: string,
  extraParams?: Record<string, string | number | boolean>,
  maskRequired?: boolean,
  isRegionEdit?: boolean,
): AiProvider {
  if (provider !== 'fal') throw new Error(`Unsupported AI provider: ${provider}`);
  return new FalProvider(modelId, inputProperties, endpointId, extraParams, maskRequired, isRegionEdit);
}

export async function aiEdit(
  providerName: 'fal',
  modelId: string,
  base64Image: string,
  base64Mask: string,
  prompt: string,
  referenceImages?: Array<{ base64Data: string; mimeType: string }>,
  inputProperties?: string[],
  endpointId?: string,
  extraParams?: Record<string, string | number | boolean>,
  maskRequired?: boolean,
  isRegionEdit?: boolean,
) {
  const provider = getProviderFor(providerName, modelId, inputProperties, endpointId, extraParams, maskRequired, isRegionEdit);
  const result = await provider.edit(base64Image, base64Mask, prompt, referenceImages);
  return { ...result, provider: provider.name };
}
