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
  abort(reason?: unknown): Promise<void>;
}

interface FileSystemFileHandle {
  readonly name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<File>;
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
}

interface FileSystemDirectoryHandle {
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
