// ===== Image =====

export interface ImageMeta {
  path: string;
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'tiff' | 'webp';
  sizeBytes: number;
}

export interface ImageOpenRequest {
  path: string;
}

export interface ImageOpenResponse {
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}

export interface TileRequest {
  path: string;
  x: number;        // pixel coords in original image
  y: number;
  w: number;        // actual width to crop (not fixed 1024)
  h: number;        // actual height to crop
}

export interface ExportRequest {
  path: string;
  outputPath: string;
  format: 'jpeg' | 'png' | 'webp' | 'avif';
  quality: number;
  layers: Layer[];
  horizon: Horizon;
}

// ===== Horizon =====

export interface Horizon {
  roll: number;   // -180 to 180
  pitch: number;  // -90 to 90
  yaw: number;    // -180 to 180
}

// ===== Layer =====

export interface Layer {
  id: string;
  order: number;
  type: 'flat' | 'perspective';
  visible: boolean;       // 👁 toggle — defaults to true

  // 360 View only — góc nhìn khi edit (để PSV map overlay)
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;

  // B1: Vùng crop (Rectangle Select) — xác định tile gửi lên AI
  // TẤT CẢ tọa độ đều trong hệ pixel của ảnh gốc (không phải viewport)
  tileCoords: {
    x: number;      // pixel x trong ảnh gốc
    y: number;      // pixel y trong ảnh gốc
    w: number;      // pixel width tại native resolution
    h: number;      // pixel height tại native resolution
  };

  // B2: Mask bên trong tileCoords (Brush/Lasso strokes)
  // Tọa độ các point cũng trong hệ pixel ảnh gốc
  maskData: MaskShape[];

  prompt: string;
  resultImageId: string;  // filename in cache dir (SHA256 hash of result image)
}

export interface MaskShape {
  type: 'brush' | 'rect' | 'lasso';
  // Brush: mảng points cho mỗi stroke (pixel ảnh gốc)
  points?: { x: number; y: number }[];
  // Rect/Lasso bounding (pixel ảnh gốc)
  x?: number; y?: number; w?: number; h?: number;
}

// ===== AI =====

export interface AiEditRequest {
  base64Image: string;
  base64Mask: string;
  prompt: string;  // always in English by this point
}

export interface AiEditResponse {
  base64Result: string;
  provider: string;
  model: string;
}

export interface TranslateRequest {
  text: string;
}

export interface TranslateResponse {
  original: string;
  translated: string;
  detectedLanguage: 'vi' | 'en';
}

// ===== Project =====

export interface ProjectFile {
  version: 2;
  imagePath: string;
  layers: Layer[];
  horizon: Horizon;
}

export interface ProjectLoadRequest {
  projectPath: string;
}

export interface ProjectSaveRequest {
  projectPath: string;
  project: ProjectFile;
}
