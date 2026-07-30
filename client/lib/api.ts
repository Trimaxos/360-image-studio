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
    preview: async (body: { path: string; layers: import('../../shared/types').Layer[] }) => {
      const res = await fetch(`${BASE}/image/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.blob();
    },
    perspectiveRender: (body: {
      imagePath: string;
      viewPose: import('../../shared/types').ViewPose;
      viewport: { width: number; height: number };
      rect: { x: number; y: number; width: number; height: number };
      mode: 'full-frame' | 'free-select';
    }) =>
      request<{ resultImageId: string; width: number; height: number }>('POST', '/image/perspective-render', body),
    reproject: (body: import('../../shared/types').ReprojectRequest) =>
      request<import('../../shared/types').ReprojectResponse>('POST', '/image/reproject', body),
    cacheUrl: (id: string) =>
      `${BASE}/image/cache/${encodeURIComponent(id)}`,
    // Upload image file from browser — returns { path, width, height, originalName }
    upload: async (file: File): Promise<{ path: string; width: number; height: number; originalName: string }> => {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch(`${BASE}/image/upload`, { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
  },
  ai: {
    models: () =>
      request<import('../../shared/types').ModelCatalogResponse>('GET', '/ai/models'),
    translate: (text: string) =>
      request<{ translated: string; detectedLanguage: string }>('POST', '/ai/translate', { text }),
    edit: (body: import('../../shared/types').AiEditRequest) =>
      request<{ base64Result: string; provider: string; model: string }>('POST', '/ai/edit', body),
  },
  project: {
    load: (projectPath: string) =>
      request<any>('POST', '/project/load', { projectPath }),
    save: (projectPath: string, project: any) =>
      request<any>('POST', '/project/save', { projectPath, project }),
    // Upload .360project file from browser
    upload: async (file: File): Promise<{ project: any; projectPath: string }> => {
      const formData = new FormData();
      formData.append('project', file);
      const res = await fetch(`${BASE}/project/upload`, { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
  },
};
