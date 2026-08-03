import fs from 'node:fs/promises';
import type { AiModelOption, ModelCatalogResponse } from '../shared/types';
import { config } from './config';

const supportedInputs = new Set([
  'image_url', 'image_urls', 'image', 'mask_url', 'mask', 'prompt',
  'strength', 'num_inference_steps', 'guidance_scale', 'seed',
  'output_format', 'safety_tolerance', 'sync_mode', 'num_images',
  'image_size', 'enable_safety_checker', 'dilate_pixels',
]);
const minimumLocalArtifactBytes = 6_000_000_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCatalog: { fal: AiModelOption[]; ts: number } | null = null;

// ===== Curated model list =====

interface CuratedModel {
  id: string;
  price: string; // shown at end of display name
}

const CURATED_FAL_MODELS: CuratedModel[] = [
  { id: 'fal-ai/flux-2/klein/9b/edit', price: '$0.022' },
  { id: 'fal-ai/flux-kontext-lora/inpaint', price: '$0.035/MP' },
  { id: 'fal-ai/flux-2-pro/edit', price: '~$0.045' },
  { id: 'bytedance/seedream/v5/lite/edit', price: '$0.035/ảnh' },
  { id: 'fal-ai/qwen-image-edit/inpaint', price: '$0.030/MP' },
  { id: 'fal-ai/flux-pro/kontext', price: '$0.040/ảnh' },
  { id: 'fal-ai/flux-2/edit', price: '$0.024' },
  { id: 'fal-ai/bytedance/seedream/v4.5/edit', price: '$0.040/ảnh' },
  { id: 'fal-ai/flux-2/turbo/edit', price: '$0.016' },
  { id: 'fal-ai/flux-2-max/edit', price: '~$0.10' },
];

// ===== Local model helpers =====

export function localArtifactComplete(sizeBytes: number): boolean {
  return sizeBytes >= minimumLocalArtifactBytes;
}

export function isLocalRuntimeReady(payload: unknown): boolean {
  const health = payload as { status?: unknown; modelLoaded?: unknown } | null;
  return health?.status === 'ready' && health.modelLoaded === true;
}

// ===== Schema helpers =====

function findInputSchema(schemas: Record<string, any>): { required: string[]; properties: string[] } | null {
  for (const [key, schema] of Object.entries(schemas)) {
    if (!(schema && typeof schema === 'object')) continue;
    const req = schema.required;
    if (!Array.isArray(req) || req.length === 0) continue;
    // Skip output/status/file schemas
    if (/output|queuestatus|image$/i.test(key)) continue;
    // Must look like an input schema
    if (/input/i.test(key) || req.some((k: string) => /^(image_urls?|mask_url|mask|prompt)$/i.test(k))) {
      return {
        required: req as string[],
        properties: Array.isArray(schema.properties) ? [] : Object.keys(schema.properties ?? {}),
      };
    }
  }
  return null;
}

export function classifyFalModel(raw: Record<string, any>): AiModelOption | null {
  const id = raw.endpoint_id ?? raw.id ?? raw.model_id;
  if (!id) return null;

  const schemas = raw.openapi?.components?.schemas
    ?? raw.open_api?.components?.schemas
    ?? raw.openapi_schema?.components?.schemas
    ?? {};
  const schema = findInputSchema(schemas);
  const required = schema?.required ?? [];
  const properties = schema?.properties ?? [];
  const unsupported = required.filter((input) => !supportedInputs.has(input));
  const hasMask = properties.some((p) => /mask/i.test(p));

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
  };
}

// ===== Local options =====

async function localOptions(): Promise<AiModelOption[]> {
  return Promise.all(config.localModels.map(async (model) => {
    let reason = '';
    if (!model.enabled) reason = 'Chưa bật trong cấu hình';
    else {
      try {
        const stat = await fs.stat(model.path);
        if (!localArtifactComplete(stat.size)) {
          reason = 'Model đang tải hoặc file chưa hoàn chỉnh';
        } else {
          try {
            const health = await fetch(`${config.localAiBaseUrl}/health`, {
              signal: AbortSignal.timeout(1500),
            });
            if (!health.ok || !isLocalRuntimeReady(await health.json())) {
              reason = 'Local AI runtime đang nạp model';
            }
          } catch {
            reason = 'Local AI runtime chưa sẵn sàng';
          }
        }
      } catch {
        reason = `Chưa tải model: ${model.path}`;
      }
    }
    return {
      id: model.id,
      displayName: model.displayName,
      provider: 'local' as const,
      capabilities: [...model.capabilities],
      enabled: !reason,
      disabledReason: reason || undefined,
    };
  }));
}

// ===== Fal.ai curated options =====

async function falOptions(): Promise<AiModelOption[]> {
  if (cachedCatalog && Date.now() - cachedCatalog.ts < CACHE_TTL_MS) {
    return cachedCatalog.fal;
  }

  // Fetch all 5 curated models in one batch
  const params = new URLSearchParams();
  params.set('expand', 'openapi-3.0');
  for (const m of CURATED_FAL_MODELS) params.append('endpoint_id', m.id);

  const response = await fetch(`https://api.fal.ai/v1/models?${params.toString()}`, {
    headers: config.falAiKey ? { Authorization: `Key ${config.falAiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`fal.ai catalog: HTTP ${response.status}`);
  }

  const data = await response.json() as any;
  const models = data.models ?? data.items ?? [];

  const priceMap = new Map(CURATED_FAL_MODELS.map((m) => [m.id, m.price]));

  const result: AiModelOption[] = [];
  for (const raw of models) {
    const item = classifyFalModel(raw);
    if (!item) continue;
    const price = priceMap.get(item.id);
    if (price) item.displayName = `${item.displayName} — ${price}`;
    result.push(item);
  }

  // Ensure order matches CURATED_FAL_MODELS
  result.sort((a, b) => {
    const ia = CURATED_FAL_MODELS.findIndex((m) => m.id === a.id);
    const ib = CURATED_FAL_MODELS.findIndex((m) => m.id === b.id);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  cachedCatalog = { fal: result, ts: Date.now() };
  return result;
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
  const local = await localOptions();
  let fal: AiModelOption[] = [];
  try {
    fal = await falOptions();
  } catch (error) {
    errors.fal = error instanceof Error ? error.message : 'Không tải được fal.ai catalog';
  }
  return {
    groups: [
      { provider: 'local', label: 'Local', models: local },
      { provider: 'fal', label: 'fal.ai', models: fal },
    ],
    errors,
  };
}
