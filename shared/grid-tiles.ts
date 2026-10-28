export interface GridSize { cols: number; rows: number }
export interface GridCell { x: number; y: number; w: number; h: number }

const MAX_AXIS = 6;
const MIN_CELLS = 2;
const MAX_CELLS = 12;

/** Grids whose cells stay close to square for this image shape; defaultIndex is the first with 3+ cells. */
export function suggestGrids(width: number, height: number): { grids: GridSize[]; defaultIndex: number } {
  const ratio = width / height;
  const grids: GridSize[] = [];
  for (const k of [1, 2, 3]) {
    const cols = ratio >= 1 ? Math.max(1, Math.round(ratio * k)) : k;
    const rows = ratio >= 1 ? k : Math.max(1, Math.round(k / ratio));
    const cells = cols * rows;
    const valid = cols <= MAX_AXIS && rows <= MAX_AXIS && cells >= MIN_CELLS && cells <= MAX_CELLS;
    if (valid && !grids.some((grid) => grid.cols === cols && grid.rows === rows)) grids.push({ cols, rows });
  }
  if (!grids.length) return { grids, defaultIndex: -1 };
  const defaultIndex = grids.findIndex((grid) => grid.cols * grid.rows >= 3);
  return { grids, defaultIndex: Math.max(0, defaultIndex) };
}

/** Cells left to right, top to bottom; rounded edges are shared so cells tile the image exactly. */
export function gridCells(width: number, height: number, cols: number, rows: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y = Math.round(row * height / rows);
    const h = Math.round((row + 1) * height / rows) - y;
    for (let col = 0; col < cols; col += 1) {
      const x = Math.round(col * width / cols);
      cells.push({ x, y, w: Math.round((col + 1) * width / cols) - x, h });
    }
  }
  return cells;
}

export function buildGridPrompt(cols: number, rows: number): string {
  return `Chia ảnh này theo lưới ${cols} cột × ${rows} hàng, các phần nằm liền kề và không chồng lên nhau, rồi tạo lại từng phần thành một ảnh độ phân giải cao, sắc nét. Xuất ${cols * rows} ảnh riêng, đánh số từ trái sang phải, từ trên xuống dưới.`;
}
