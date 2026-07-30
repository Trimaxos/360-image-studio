import fs from 'node:fs/promises';
import type { AiModelOption, ModelCatalogResponse } from '../shared/types';
import { config } from './config';

type FalRecord = Record<string, any>;
const supportedInputs = new Set([
  'image_url', 'image', 'mask_url', 'mask', 'prompt',
  'strength', 'num_inference_steps', 'guidance_scale', 'seed',
  'output_format', 'safety_tolerance', 'sync_mode', 'num_images',
]);
const minimumLocalArtifactBytes = 6_000_000_000;

export function localArtifactComplete(sizeBytes: number): boolean {
  return sizeBytes >= minimumLocalArtifactBytes;
}

export function isLocalRuntimeReady(payload: unknown): boolean {
  const health = payload as { status?: unknown; modelLoaded?: unknown } | null;
  return health?.status === 'ready' && health.modelLoaded === true;
}

function strings(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'string') return [value.toLowerCase()];
  return [];
}

function requiredInputs(model: FalRecord): string[] {
  const schemas = model.openapi?.components?.schemas
    ?? model.open_api?.components?.schemas
    ?? model.openapi_schema?.components?.schemas
    ?? {};
  const input = schemas.Input ?? schemas.input ?? Object.values(schemas).find((schema: any) =>
    Array.isArray(schema?.required) && schema.required.some((key: string) => /image|prompt|mask/.test(key)));
  return Array.isArray((input as any)?.required) ? (input as any).required : [];
}

export function classifyFalModel(model: FalRecord): AiModelOption | null {
  const id = model.endpoint_id ?? model.id ?? model.model_id;
  if (!id) return null;
  const categories = strings([
    model.category,
    model.categories,
    model.metadata?.category,
    model.metadata?.categories,
    model.tags,
  ]);
  const searchable = `${id} ${categories.join(' ')}`.toLowerCase();
  const capabilities: AiModelOption['capabilities'] = [];
  if (/inpaint|fill/.test(searchable)) capabilities.push('inpainting');
  if (/image-to-image|image.edit|edit|inpaint/.test(searchable)) capabilities.push('image-edit');
  if (!capabilities.length) return null;

  const required = requiredInputs(model);
  const unsupported = required.filter((input) => !supportedInputs.has(input));
  return {
    id,
    displayName: model.metadata?.display_name ?? model.name ?? id,
    provider: 'fal',
    capabilities: [...new Set(capabilities)],
    enabled: unsupported.length === 0,
    disabledReason: unsupported.length
      ? `Cần input chưa hỗ trợ: ${unsupported.join(', ')}`
      : undefined,
  };
}

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

async function falOptions(): Promise<AiModelOption[]> {
  const found = new Map<string, AiModelOption>();
  let cursor = '';
  do {
    const url = new URL('https://api.fal.ai/v1/models');
    url.searchParams.set('status', 'active');
    url.searchParams.set('expand', 'openapi-3.0');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, {
      headers: config.falAiKey ? { Authorization: `Key ${config.falAiKey}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`fal.ai catalog: HTTP ${response.status}`);
    const data = await response.json() as any;
    const models = data.models ?? data.items ?? [];
    for (const raw of models) {
      const item = classifyFalModel(raw);
      if (item) found.set(item.id, item);
    }
    cursor = data.next_cursor ?? data.nextCursor ?? '';
  } while (cursor);
  return [...found.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
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
