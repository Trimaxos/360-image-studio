const BASE = '/api';

async function request<T>(method: string, url: string, body?: any): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${url}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('image/')) {
    const blob = await res.blob();
    return blob as any;
  }
  return res.json();
}

export const api = {
  image: {
    open: (path: string) =>
      request<any>('POST', '/image/open', { path }),
    serveUrl: (path: string, maxWidth?: number) =>
      `${BASE}/image/serve?path=${encodeURIComponent(path)}${maxWidth ? `&maxWidth=${maxWidth}` : ''}`,
    tileUrl: (path: string, x: number, y: number, w: number, h: number) =>
      `${BASE}/image/tile?path=${encodeURIComponent(path)}&x=${x}&y=${y}&w=${w}&h=${h}`,
    saveResultCache: (base64Image: string) =>
      request<{ resultImageId: string; sizeBytes: number }>('POST', '/image/cache-result', { base64Image }),
    export: (body: any) =>
      request<any>('POST', '/image/export', body),
  },
  ai: {
    translate: (text: string) =>
      request<{ translated: string; detectedLanguage: string }>('POST', '/ai/translate', { text }),
    edit: (body: { base64Image: string; base64Mask: string; prompt: string }) =>
      request<{ base64Result: string; provider: string; model: string }>('POST', '/ai/edit', body),
  },
  project: {
    load: (projectPath: string) =>
      request<any>('POST', '/project/load', { projectPath }),
    save: (projectPath: string, project: any) =>
      request<any>('POST', '/project/save', { projectPath, project }),
  },
};
