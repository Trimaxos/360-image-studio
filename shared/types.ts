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

export interface ViewPose {
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
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
  maskEnabled?: boolean;  // true + maskData → limits display scope; default false → full layer
  maskForAi?: boolean;   // true = send mask to AI to limit generation scope; default true

  prompt: string;
  resultImageId: string;  // filename in cache dir (SHA256 hash of result image)
  equirectImageId?: string;  // filename in cache dir (reprojected equirectangular buffer)
  status?: 'draft' | 'committed';
  name?: string;
  selection?: SelectionDraft;
}

export interface SelectionDraft {
  sourceView: '360' | 'flat';
  mode: 'full-frame' | 'free-select';
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  tileCoords: { x: number; y: number; w: number; h: number };
  viewPose: ViewPose;
  prompt: string;
  maskBase64?: string;
}

export interface PerspectiveRenderRequest {
  imagePath: string;
  viewPose: ViewPose;
  viewport: { width: number; height: number };
  rect: { x: number; y: number; width: number; height: number };
  mode: 'full-frame' | 'free-select';
  scaleFactor?: number;
}

export interface PerspectiveRenderResponse {
  resultImageId: string;
  width: number;
  height: number;
}

export interface ReprojectRequest {
  resultImageId: string;
  selection: SelectionDraft;
  imagePath: string;
  maskEnabled?: boolean;
  maskData?: MaskShape[];
}

export interface ReprojectResponse {
  equirectImageId: string;
}

export interface GeneratedVariant {
  id: string;
  base64Result: string;
  modelId: string;
}

export interface AiModelOption {
  id: string;
  displayName: string;
  provider: 'local' | 'fal';
  capabilities: Array<'inpainting' | 'image-edit'>;
  enabled: boolean;
  disabledReason?: string;
}

export interface ModelCatalogResponse {
  groups: Array<{
    provider: 'local' | 'fal';
    label: string;
    models: AiModelOption[];
  }>;
  errors?: Partial<Record<'local' | 'fal', string>>;
}

export interface MaskShape {
  type: 'brush' | 'rect' | 'lasso';
  id?: string;           // stable identity for mask management UI
  enabled?: boolean;     // false = excluded from mask baking; defaults true
  action?: 'add' | 'subtract';  // 'add' = include in mask (brush/lasso), 'subtract' = remove from mask (eraser); default 'add'
  // Brush: mảng points cho mỗi stroke (pixel ảnh gốc)
  points?: { x: number; y: number }[];
  // Rect/Lasso bounding (pixel ảnh gốc)
  x?: number; y?: number; w?: number; h?: number;
}

// ===== AI =====

export interface AiEditRequest {
  provider: 'local' | 'fal';
  modelId: string;
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
  version: 3;
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
