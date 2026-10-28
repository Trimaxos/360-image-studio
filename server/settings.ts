import fs from 'fs';
import path from 'path';
import { config } from './config';
import type { SettingsStatus, SettingsUpdate } from '../shared/types';

/** A value the person typed that cannot be used; the route answers 400 with its message. */
export class SettingsInputError extends Error {}

const FIELDS = ['ninerouterBaseUrl', 'ninerouterKey', 'falAiKey'] as const;

function readSaved(): SettingsUpdate {
  try {
    return JSON.parse(fs.readFileSync(config.settingsFile, 'utf8'));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') console.error(`[settings] cannot read ${config.settingsFile}: ${error.message}`);
    return {};
  }
}

/** At startup: values saved on the Settings screen win over .env; fields never saved keep the .env value. */
export function applySavedSettings(): void {
  const saved = readSaved();
  for (const field of FIELDS) {
    if (typeof saved[field] === 'string') config[field] = saved[field];
  }
}

function cleanUpdate(update: SettingsUpdate): SettingsUpdate {
  const changes: SettingsUpdate = {};
  if (typeof update.ninerouterBaseUrl === 'string') {
    const url = update.ninerouterBaseUrl.trim();
    let protocol = '';
    try { protocol = new URL(url).protocol; } catch { /* not a URL */ }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new SettingsInputError('URL 9router không hợp lệ (cần dạng http://localhost:20128/v1).');
    }
    changes.ninerouterBaseUrl = url;
  }
  // An empty key field means "keep the key already there".
  for (const field of ['ninerouterKey', 'falAiKey'] as const) {
    const key = typeof update[field] === 'string' ? update[field]!.trim() : '';
    if (key) changes[field] = key;
  }
  return changes;
}

export async function saveSettings(update: SettingsUpdate): Promise<SettingsStatus> {
  const changes = cleanUpdate(update);
  const next = { ...readSaved(), ...changes };
  await fs.promises.mkdir(path.dirname(config.settingsFile), { recursive: true });
  const partial = `${config.settingsFile}.${process.pid}.tmp`;
  await fs.promises.writeFile(partial, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fs.promises.rename(partial, config.settingsFile);
  Object.assign(config, changes);
  return settingsStatus();
}

const keyHint = (key: string) => (key ? `…${key.length >= 8 ? key.slice(-4) : ''}` : null);

export function settingsStatus(): SettingsStatus {
  return {
    ninerouterBaseUrl: config.ninerouterBaseUrl,
    ninerouterKey: keyHint(config.ninerouterKey),
    falAiKey: keyHint(config.falAiKey),
  };
}
