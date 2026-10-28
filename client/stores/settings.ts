// The Settings screen (9router URL and key, fal.ai key): what the server has, and whether the dialog is open.
import { create } from 'zustand';
import type { AiProviderName, SettingsStatus } from '../../shared/types';
import { api } from '../lib/api';

export const PROVIDER_LABEL: Record<AiProviderName, string> = { ninerouter: '9router', fal: 'fal.ai' };
const KEY_FIELD: Record<AiProviderName, 'ninerouterKey' | 'falAiKey'> = { ninerouter: 'ninerouterKey', fal: 'falAiKey' };

/** False only when the settings are known and say this service has no key; unknown counts as yes (the server still checks). */
export function hasKeyFor(status: SettingsStatus | null, provider: AiProviderName): boolean {
  return !status || !!status[KEY_FIELD[provider]];
}

interface SettingsState {
  status: SettingsStatus | null;
  open: boolean;
  load(): Promise<void>;
  setStatus(status: SettingsStatus): void;
  setOpen(open: boolean): void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  status: null,
  open: false,
  load: async () => {
    try {
      set({ status: await api.settings.get() });
    } catch {
      /* unknown: Generate goes ahead and the server reports a missing key */
    }
  },
  setStatus: (status) => set({ status }),
  setOpen: (open) => set({ open }),
}));
