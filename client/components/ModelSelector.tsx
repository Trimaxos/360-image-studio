import { useEffect, useState } from 'react';
import type { ModelCatalogResponse } from '../../shared/types';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';
import { hasKeyFor, useSettingsStore } from '../stores/settings';

export default function ModelSelector({ disabled }: { disabled: boolean }) {
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [error, setError] = useState('');
  const selected = useProjectStore((state) => state.selectedModel);
  const setSelected = useProjectStore((state) => state.setSelectedModel);
  const aiProvider = useSettingsStore((state) => state.status?.aiProvider);

  const load = async () => {
    setError('');
    try {
      const [result] = await Promise.all([api.ai.models(), useSettingsStore.getState().load()]);
      setCatalog(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được model');
    }
  };
  useEffect(() => { void load(); }, []);

  // Only the AI service chosen on the Settings screen is offered (every one while the settings are unknown).
  const groups = catalog?.groups.filter((group) => !aiProvider || group.provider === aiProvider) ?? [];
  const models = groups.flatMap((group) => group.models);

  // A picked model of another service gives way to the first one offered: the first whose service already has a key,
  // else the first one (Generate then asks for the key).
  useEffect(() => {
    if (!catalog) return;
    const current = useProjectStore.getState().selectedModel;
    if (current && models.some((model) => model.provider === current.provider && model.id === current.id)) return;
    const status = useSettingsStore.getState().status;
    const enabled = models.filter((model) => model.enabled);
    setSelected(enabled.find((model) => hasKeyFor(status, model.provider)) ?? enabled[0] ?? null);
  }, [catalog, aiProvider]);

  const catalogError = groups.some((group) => group.provider === 'fal') ? catalog?.errors?.fal : undefined;
  return (
    <div className="model-selector-wrap">
      <select
        aria-label="Model"
        value={selected ? `${selected.provider}:${selected.id}` : ''}
        disabled={disabled || !catalog}
        onChange={(event) => {
          const model = models.find((item) => `${item.provider}:${item.id}` === event.target.value);
          setSelected(model ?? null);
        }}
      >
        {!selected && <option value="">Model</option>}
        {groups.map((group) => (
          <optgroup key={group.provider} label={group.label}>
            {group.models.map((model) => (
              <option key={model.id} value={`${model.provider}:${model.id}`} disabled={!model.enabled}>
                {model.description ? `${model.description}: ` : ''}{model.displayName}
                {model.hasMask === false ? ' (no mask)' : ''}
                {model.disabledReason ? ` — ${model.disabledReason}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {(error || catalogError) && (
        <button className="model-retry" onClick={() => void load()} title={error || catalogError}>Retry</button>
      )}
    </div>
  );
}
