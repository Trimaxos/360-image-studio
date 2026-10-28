import type { AiModelOption, ModelCatalogResponse } from '../shared/types';
import { config } from './config';

const supportedInputs = new Set([
  'image_url', 'image_urls', 'image', 'mask_url', 'mask', 'prompt',
  'strength', 'num_inference_steps', 'guidance_scale', 'seed', 'negative_prompt',
  'output_format', 'safety_tolerance', 'sync_mode', 'num_images',
  'image_size', 'enable_safety_checker', 'dilate_pixels',
]);
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCatalog: { fal: AiModelOption[]; ts: number } | null = null;

// ===== Curated model list =====

interface CuratedModel {
  id: string;
  price: string; // shown at end of display name
  name?: string; // overrides fal.ai's display_name when it's ambiguous (e.g. missing version)
}

const CURATED_FAL_MODELS: CuratedModel[] = [
  { id: 'openai/gpt-image-2.5/flare/edit', price: '', name: 'GPT Image 2.5 Flare Edit' },
];

// Some endpoints expose a "quality" tier that changes both price and result
// quality. Fal.ai only returns one catalog entry per endpoint, so these are
// fanned out into multiple selectable AiModelOption entries after fetching —
// each carries its own extraParams merged into the request body at call time.
interface ModelVariant {
  suffix: string; // appended to the base id to make each option's id unique
  label: string;
  price: string;
  extraParams: Record<string, string | number | boolean>;
}

const GPT_IMAGE_25_QUALITY_VARIANTS: ModelVariant[] = [
  { suffix: 'medium', label: 'Medium', price: '~$0.013/ảnh', extraParams: { quality: 'medium' } },
];

const MODEL_VARIANTS: Record<string, ModelVariant[]> = {
  'openai/gpt-image-2.5/flare/edit': GPT_IMAGE_25_QUALITY_VARIANTS,
};

// Endpoints validated to honor an explicit { width, height } `image_size`.
// Without it fal's `auto` matches the crop for small crops, but shrinks large
// ones drastically (e.g. 5334×4000 → 944×704), which the server then upscales
// back to the crop — visibly blurry. Other endpoints expose the same schema
// shape but are not enabled here to avoid changing their behavior and cost.
const CUSTOM_IMAGE_SIZE_ENDPOINTS = new Set([
  'openai/gpt-image-2.5/flare/edit',
]);

// ===== Schema helpers =====

function findInputSchema(schemas: Record<string, any>): {
  required: string[];
  properties: string[];
  propertySchemas: Record<string, any>;
} | null {
  for (const [key, schema] of Object.entries(schemas)) {
    if (!(schema && typeof schema === 'object')) continue;
    const req = schema.required;
    if (!Array.isArray(req) || req.length === 0) continue;
    // Skip output/status/file schemas
    if (/output|queuestatus|image$/i.test(key)) continue;
    // Must look like an input schema
    if (/input/i.test(key) || req.some((k: string) => /^(image_urls?|mask_url|mask|prompt)$/i.test(k))) {
      const propertySchemas = Array.isArray(schema.properties) ? {} : (schema.properties ?? {});
      return {
        required: req as string[],
        properties: Object.keys(propertySchemas),
        propertySchemas,
      };
    }
  }
  return null;
}

// `image_size` may accept an explicit { width, height } object — either inline
// or through a $ref branch in an anyOf union with preset enum strings.
function supportsImageSizeObject(propertySchema: any, schemas: Record<string, any>): boolean {
  if (!propertySchema || typeof propertySchema !== 'object') return false;
  const branches = [propertySchema, ...(Array.isArray(propertySchema.anyOf) ? propertySchema.anyOf : [])];
  return branches.some((branch: any) => {
    const resolved = branch?.$ref
      ? schemas[String(branch.$ref).split('/').pop() ?? '']
      : branch;
    return resolved?.type === 'object'
      && !!resolved.properties?.width
      && !!resolved.properties?.height;
  });
}

export function classifyFalModel(raw: Record<string, any>): AiModelOption | null {
  const id = raw.endpoint_id ?? raw.id ?? raw.model_id;
  if (!id) return null;
  const categories = raw.metadata?.categories;
  if (Array.isArray(categories)
    && categories.includes('text-to-image')
    && !categories.some((category: string) => /image-to-image|edit|inpaint/i.test(category))) {
    return null;
  }

  const schemas = raw.openapi?.components?.schemas
    ?? raw.open_api?.components?.schemas
    ?? raw.openapi_schema?.components?.schemas
    ?? {};
  const schema = findInputSchema(schemas);
  const required = schema?.required ?? [];
  const properties = schema?.properties ?? [];
  const unsupported = required.filter((input) => !supportedInputs.has(input));
  const hasMask = properties.some((p) => /mask/i.test(p));
  const maskRequired = required.some((p) => /mask/i.test(p));

  const capabilities: AiModelOption['capabilities'] = [];
  if (hasMask || /inpaint|fill|erase/i.test(id)) capabilities.push('inpainting');
  capabilities.push('image-edit');

  return {
    id,
    displayName: raw.metadata?.display_name ?? raw.name ?? id,
    provider: 'fal',
    capabilities: [...new Set(capabilities)],
    enabled: unsupported.length === 0,
    disabledReason: unsupported.length
      ? `Cần input chưa hỗ trợ: ${unsupported.join(', ')}`
      : undefined,
    inputProperties: properties,
    hasMask,
    maskRequired,
    supportsReferenceImages: properties.includes('image_urls'),
    supportsCustomImageSize: CUSTOM_IMAGE_SIZE_ENDPOINTS.has(id)
      && supportsImageSizeObject(schema?.propertySchemas?.image_size, schemas),
  };
}

// ===== Fal.ai curated options =====

async function falOptions(): Promise<AiModelOption[]> {
  if (cachedCatalog && Date.now() - cachedCatalog.ts < CACHE_TTL_MS) {
    return cachedCatalog.fal;
  }

  // fal.ai caps `limit` at 10 per request even when filtering by endpoint_id,
  // so fetch curated models in chunks of 10 and merge the results.
  const FAL_QUERY_CHUNK_SIZE = 10;
  const models: any[] = [];
  for (let i = 0; i < CURATED_FAL_MODELS.length; i += FAL_QUERY_CHUNK_SIZE) {
    const chunk = CURATED_FAL_MODELS.slice(i, i + FAL_QUERY_CHUNK_SIZE);
    const params = new URLSearchParams();
    params.set('expand', 'openapi-3.0');
    for (const m of chunk) params.append('endpoint_id', m.id);

    const response = await fetch(`https://api.fal.ai/v1/models?${params.toString()}`, {
      headers: config.falAiKey ? { Authorization: `Key ${config.falAiKey}` } : {},
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`fal.ai catalog: HTTP ${response.status}`);
    }

    const data = await response.json() as any;
    models.push(...(data.models ?? data.items ?? []));
  }

  const priceMap = new Map(CURATED_FAL_MODELS.map((m) => [m.id, m.price]));
  const nameMap = new Map(CURATED_FAL_MODELS.filter((m) => m.name).map((m) => [m.id, m.name!]));

  const result: AiModelOption[] = [];
  for (const raw of models) {
    const item = classifyFalModel(raw);
    if (!item) continue;
    const overrideName = nameMap.get(item.id);
    if (overrideName) item.displayName = overrideName;
    const variants = MODEL_VARIANTS[item.id];
    if (variants) {
      for (const variant of variants) {
        result.push({
          ...item,
          id: `${item.id}::${variant.suffix}`,
          endpointId: item.id,
          extraParams: variant.extraParams,
          displayName: `${item.displayName} (${variant.label}) — ${variant.price}`,
        });
      }
      continue;
    }
    const price = priceMap.get(item.id);
    if (price) item.displayName = `${item.displayName} — ${price}`;
    result.push(item);
  }

  // Ensure order matches CURATED_FAL_MODELS (variants keep their base id's slot)
  const baseId = (id: string) => id.split('::')[0];
  result.sort((a, b) => {
    const ia = CURATED_FAL_MODELS.findIndex((m) => m.id === baseId(a.id));
    const ib = CURATED_FAL_MODELS.findIndex((m) => m.id === baseId(b.id));
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  cachedCatalog = { fal: result, ts: Date.now() };
  return result;
}

// ===== 9router (Codex via ChatGPT account) =====

// cx/gpt-image-* edits through the Images API (/images/generations); cx/gpt-6-astra
// returns an image through the Responses image_generation tool, and the other
// cx/* models answer "no image-editing tool is available". Neither is listed
// by /models, so they are declared here.
// Offered even without a key: Generate then asks for it on the Settings screen.
export function ninerouterOptions(): AiModelOption[] {
  return [{
    id: 'cx/gpt-image-2.5-flare',
    displayName: 'GPT Image 2.5 Flare (High) — 9router',
    provider: 'ninerouter',
    capabilities: ['image-edit'],
    enabled: true,
    hasMask: false,
    maskRequired: false,
    supportsReferenceImages: false,
    extraParams: { quality: 'high' },
  }, {
    id: 'cx/gpt-6-astra',
    displayName: 'GPT-6 Astra (Codex qua 9router — hạn mức ChatGPT)',
    provider: 'ninerouter',
    capabilities: ['image-edit'],
    enabled: true,
    hasMask: false,
    maskRequired: false,
    supportsReferenceImages: false,
  }];
}

// ===== Public API =====

export async function getModelInfo(modelId: string): Promise<AiModelOption | undefined> {
  const catalog = await getModelCatalog();
  for (const group of catalog.groups) {
    const found = group.models.find((m) => m.id === modelId);
    if (found) return found;
  }
  return undefined;
}

export async function getModelCatalog(): Promise<ModelCatalogResponse> {
  const errors: ModelCatalogResponse['errors'] = {};
  let fal: AiModelOption[] = [];
  try {
    fal = await falOptions();
  } catch (error) {
    errors.fal = error instanceof Error ? error.message : 'Không tải được fal.ai catalog';
  }
  const ninerouter = ninerouterOptions();
  // 9router first: the model selector defaults to the first enabled model.
  const groups: ModelCatalogResponse['groups'] = [
    ...(ninerouter.length ? [{ provider: 'ninerouter' as const, label: '9router', models: ninerouter }] : []),
    { provider: 'fal', label: 'fal.ai', models: fal },
  ];
  return { groups, errors };
}
