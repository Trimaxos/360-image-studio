import { config } from '../config';
import sharp from 'sharp';
import { exactModelSize, isValidModelSize } from '../../shared/model-crop';

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

// GPT Image 2.5 (via fal) only accepts explicit `image_size` values whose
// edges are multiples of 16, with the long edge ≤ 3840px, the aspect ratio
// ≤ 3:1 and a total pixel count inside [655,360, 8,294,400] (fal docs).
// Anything else gets silently floored to the 16px grid — e.g. 1000×700 comes
// back as 992×688 — which changes the aspect ratio, and
// normalizeResultToSourceDimensions then stretches the result back with
// `fit: 'fill'`, visibly shifting content. Round the request to the aligned
// size whose aspect ratio is closest to the crop's own.
const MIN_MODEL_OUTPUT_PIXELS = 655_360;
const MAX_MODEL_OUTPUT_PIXELS = 3840 * 2160;
const MAX_MODEL_LONG_EDGE = 3840;
const MAX_MODEL_ASPECT_RATIO = 3;
const MODEL_OUTPUT_DIMENSION_STEP = 16;
const MODEL_SIZE_SEARCH_STEPS = 4;

export function fitModelOutputImageSize(width: number, height: number): { width: number; height: number } {
  const exact = exactModelSize(width, height);
  if (exact) return exact;
  const step = MODEL_OUTPUT_DIMENSION_STEP;
  const pixels = width * height;
  let scale = 1;
  if (pixels > MAX_MODEL_OUTPUT_PIXELS) {
    scale = Math.sqrt(MAX_MODEL_OUTPUT_PIXELS / pixels);
  } else if (pixels > 0 && pixels < MIN_MODEL_OUTPUT_PIXELS) {
    scale = Math.sqrt(MIN_MODEL_OUTPUT_PIXELS / pixels);
  }

  let targetWidth = width * scale;
  let targetHeight = height * scale;
  const longEdge = Math.max(targetWidth, targetHeight);
  if (longEdge > MAX_MODEL_LONG_EDGE) {
    const shrink = MAX_MODEL_LONG_EDGE / longEdge;
    targetWidth *= shrink;
    targetHeight *= shrink;
  }
  if (targetWidth / targetHeight > MAX_MODEL_ASPECT_RATIO) targetWidth = targetHeight * MAX_MODEL_ASPECT_RATIO;
  if (targetHeight / targetWidth > MAX_MODEL_ASPECT_RATIO) targetHeight = targetWidth * MAX_MODEL_ASPECT_RATIO;

  const sourceAspect = width / height;
  const align = (value: number) => Math.max(step, Math.min(MAX_MODEL_LONG_EDGE, Math.round(value / step) * step));
  const baseWidth = align(targetWidth);
  const baseHeight = align(targetHeight);

  let best = { width: baseWidth, height: baseHeight, score: Infinity };
  for (let dw = -MODEL_SIZE_SEARCH_STEPS; dw <= MODEL_SIZE_SEARCH_STEPS; dw += 1) {
    for (let dh = -MODEL_SIZE_SEARCH_STEPS; dh <= MODEL_SIZE_SEARCH_STEPS; dh += 1) {
      const candidateWidth = baseWidth + dw * step;
      const candidateHeight = baseHeight + dh * step;
      if (candidateWidth < step || candidateHeight < step) continue;
      if (candidateWidth > MAX_MODEL_LONG_EDGE || candidateHeight > MAX_MODEL_LONG_EDGE) continue;
      const candidatePixels = candidateWidth * candidateHeight;
      if (candidatePixels < MIN_MODEL_OUTPUT_PIXELS || candidatePixels > MAX_MODEL_OUTPUT_PIXELS) continue;
      if (Math.max(candidateWidth / candidateHeight, candidateHeight / candidateWidth) > MAX_MODEL_ASPECT_RATIO) continue;
      const aspectError = Math.abs(candidateWidth / candidateHeight - sourceAspect) / sourceAspect;
      const sizeError = Math.abs(candidateWidth - targetWidth) / targetWidth
        + Math.abs(candidateHeight - targetHeight) / targetHeight;
      const score = aspectError * 100 + sizeError;
      if (score < best.score) best = { width: candidateWidth, height: candidateHeight, score };
    }
  }

  if (best.score === Infinity) {
    const fallbackScale = Math.sqrt(MIN_MODEL_OUTPUT_PIXELS / (baseWidth * baseHeight));
    return {
      width: Math.min(MAX_MODEL_LONG_EDGE, Math.ceil((baseWidth * fallbackScale) / step) * step),
      height: Math.min(MAX_MODEL_LONG_EDGE, Math.ceil((baseHeight * fallbackScale) / step) * step),
    };
  }
  return { width: best.width, height: best.height };
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

/**
 * Resizes the outgoing image (and mask) to the exact canvas the model will
 * return. Sending a differently sized input makes the model re-lay the content
 * out on its own canvas — a 400×300 crop asked for 960×720 came back shifted
 * by ~4% once normalized to the source. Callers keep the original buffer for
 * `normalizeResultToSourceDimensions`.
 */
export async function resizeRequestInputs(
  base64Image: string,
  base64Mask: string,
  width: number,
  height: number,
): Promise<{ base64Image: string; base64Mask: string }> {
  const imageBuffer = Buffer.from(base64Image, 'base64');
  const metadata = await sharp(imageBuffer).metadata();
  const resizedImage = metadata.width === width && metadata.height === height
    ? imageBuffer : await sharp(imageBuffer)
      .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
  let resizedMask = base64Mask;
  if (base64Mask) {
    const maskBuffer = Buffer.from(base64Mask, 'base64');
    const maskMetadata = await sharp(maskBuffer).metadata();
    if (maskMetadata.width !== width || maskMetadata.height !== height) {
      resizedMask = (await sharp(maskBuffer)
        .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer()).toString('base64');
    }
  }
  return { base64Image: resizedImage.toString('base64'), base64Mask: resizedMask };
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
    private supportsCustomImageSize?: boolean,
  ) {}
  async edit(
    base64Image: string,
    base64Mask: string,
    prompt: string,
    referenceImages: Array<{ base64Data: string; mimeType: string }> = [],
  ) {
    if (!config.falAiKey) throw new Error('FAL_AI_KEY chưa được cấu hình');

    const sourceImage = Buffer.from(base64Image, 'base64');
    const sourceMetadata = await sharp(sourceImage).metadata();
    let requestImageBase64 = base64Image;
    let requestMaskBase64 = base64Mask;
    let requestedSize: { width: number; height: number } | null = null;
    if (this.supportsCustomImageSize
      && this.inputProperties.includes('image_size')
      && sourceMetadata.width && sourceMetadata.height) {
      requestedSize = fitModelOutputImageSize(sourceMetadata.width, sourceMetadata.height);
      if (!isValidModelSize(requestedSize)) {
        throw new Error('Kích thước vùng ảnh không phù hợp với model. Hãy chọn lại vùng crop.');
      }
      const prepared = await resizeRequestInputs(
        base64Image, base64Mask, requestedSize.width, requestedSize.height,
      );
      requestImageBase64 = prepared.base64Image;
      requestMaskBase64 = prepared.base64Mask;
    }

    const imageDataUri = await toRequestDataUri(requestImageBase64);
    // Masks must remain lossless; JPEG would discard alpha and alter edges.
    const maskDataUri = `data:image/png;base64,${requestMaskBase64}`;
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

    // The route enables this flag for a required mask OR a user-drawn region.
    // Omit optional full-white placeholders for prompt-only edits.
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

    // Ask the model for the crop's own resolution (aligned and capped to the
    // sizes fal accepts) instead of fal's `auto`, which can shrink large crops
    // dramatically. The input image was resized to this exact size above.
    if (requestedSize) {
      body.image_size = requestedSize;
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
    const resultBuffer = Buffer.from(await imageResponse.arrayBuffer());
    if (requestedSize) {
      const actual = await sharp(resultBuffer).metadata();
      if (actual.width !== requestedSize.width || actual.height !== requestedSize.height) {
        throw new Error(`Model trả ảnh sai kích thước: ${actual.width}×${actual.height}; yêu cầu ${requestedSize.width}×${requestedSize.height}. Hãy thử lại.`);
      }
    }
    const normalizedResult = await normalizeResultToSourceDimensions(sourceImage, resultBuffer);
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
  supportsCustomImageSize?: boolean,
): AiProvider {
  if (provider !== 'fal') throw new Error(`Unsupported AI provider: ${provider}`);
  return new FalProvider(
    modelId, inputProperties, endpointId, extraParams, maskRequired, isRegionEdit, supportsCustomImageSize,
  );
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
  supportsCustomImageSize?: boolean,
) {
  const provider = getProviderFor(
    providerName, modelId, inputProperties, endpointId, extraParams, maskRequired, isRegionEdit, supportsCustomImageSize,
  );
  const result = await provider.edit(base64Image, base64Mask, prompt, referenceImages);
  return { ...result, provider: provider.name };
}
