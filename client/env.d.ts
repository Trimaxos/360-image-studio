/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}

// File System Access API — Chrome/Edge only (Firefox/Safari fall back to download)
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface FileSystemWritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  readonly name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface Window {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
