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
  format: 'jpeg' | 'jpg' | 'png' | 'webp' | 'avif';
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

// ===== Image Mode =====

/** 360 = equirectangular panorama; flat = regular photo. */
export type ImageMode = '360' | 'flat';

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
  maskEnabled?: boolean;  // DEPRECATED — use variant.visibilityMask instead
  maskForAi?: boolean;   // true = send mask to AI to limit generation scope; default true

  prompt: string;
  resultImageId: string;  // filename in cache dir (SHA256 hash of result image)
  equirectImageId?: string;  // filename in cache dir (reprojected equirectangular buffer)
  status?: 'draft' | 'committed';
  name?: string;
  selection?: SelectionDraft;

  // --- New fields (v4) ---
  variants?: LayerVariant[];     // Danh sách kết quả AI/import
}

// ===== Layer Variant =====

export interface LayerVariant {
  id: string;                    // UUID
  resultImageId: string;         // filename in cache dir (without .png extension)
  source: 'ai-generated' | 'imported';
  modelId?: string;              // model AI đã dùng (nếu ai-generated)
  applied: boolean;              // true = variant này đang được apply (chỉ 1 variant/layer)
  equirectImageId?: string;      // filename in cache dir — pre-rendered equirect for THIS variant (perspective layers)
  visibilityMask?: {
    base64Mask: string;          // base64 PNG mask (white=visible, black=hidden)
    brushSize: number;           // px
    brushSoftness: number;       // legacy field; mirrors 100 - hardness
    brushOpacity?: number;       // 0-100%
    brushHardness?: number;      // 0-100%
  };
  /** Kích thước thực tế của ảnh kết quả (pixel) */
  width: number;
  height: number;
  /** True khi ảnh nguồn lệch tỉ lệ tile và user chưa căn chỉnh thủ công
   *  (transform) — editor sẽ tự mở chế độ căn chỉnh thay vì báo lỗi. */
  needsFit?: boolean;
  createdAt: number;             // Date.now()
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
  /** Committed visible edits that must be baked into the source for a new layer. */
  layers?: Layer[];
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
  visibilityMask?: LayerVariant['visibilityMask'];
}

export interface ReprojectResponse {
  equirectImageId: string;
}

export interface VariantMaskCacheRequest {
  variantId: string;
  base64Mask: string;
  softness: number;    // 0-100
  width: number;
  height: number;
}

export interface VariantMaskCacheResponse {
  featheredMaskId: string;
}

export interface GeneratedVariant {
  id: string;
  base64Result: string;
  modelId: string;
}

export interface AiModelOption {
  id: string;
  displayName: string;
  provider: 'fal';
  capabilities: Array<'inpainting' | 'image-edit'>;
  enabled: boolean;
  disabledReason?: string;
  /** Human-readable role description for the UI (e.g. "Mặc định", "Xóa vật thể") */
  description?: string;
  /** Input property names the model accepts (e.g. image_url, mask_url, prompt) */
  inputProperties?: string[];
  /** Whether the model supports mask input for inpainting */
  hasMask?: boolean;
  /** Whether the model's schema requires a mask input (vs. accepting it optionally) */
  maskRequired?: boolean;
  /** Whether this endpoint accepts multiple input images, allowing the first
   *  image to be edited using additional uploaded reference images. */
  supportsReferenceImages?: boolean;
  /** Real fal.ai endpoint to call, when it differs from `id` (e.g. multiple quality-tier options sharing one endpoint) */
  endpointId?: string;
  /** Extra body params merged into the fal.ai request (e.g. { quality: 'low' }) */
  extraParams?: Record<string, string | number | boolean>;
  /** Whether the endpoint accepts an explicit `image_size` of { width, height }.
   *  When set, the server requests the crop's own size (capped to the model's
   *  max) instead of fal's `auto`, which shrinks large crops dramatically. */
  supportsCustomImageSize?: boolean;
}

export interface ModelCatalogResponse {
  groups: Array<{
    provider: 'fal';
    label: string;
    models: AiModelOption[];
  }>;
  errors?: Partial<Record<'fal', string>>;
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
  provider: 'fal';
  modelId: string;
  base64Image: string;
  base64Mask?: string;
  /** True when base64Mask is a real, user-drawn region mask (not the
   *  meaningless full-white placeholder) — tells the server to forward it
   *  whenever the model supports mask input, not only when it's required. */
  hasRegionMask?: boolean;
  /** Optional visual references. The source image remains input image 1 and
   *  these are appended as input images 2..N in the same fal.ai request. */
  referenceImages?: Array<{
    base64Data: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }>;
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
  version: 5;
  mode: ImageMode;
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
