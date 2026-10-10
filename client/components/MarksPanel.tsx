import { useEffect, useMemo, useRef, useState } from 'react';
import { NADIR_NAME, compileMark, nextMarkNumber, parseMarkLines, type ParseError } from '../../shared/crop-plan';
import { runCropLayers } from '../lib/crop-layers';
import { useProjectStore } from '../stores/project';

const degrees = (range: [number, number]) => `${range[0]}..${range[1]}`;

export default function MarksPanel({ onCreated }: { onCreated(): void }) {
  const marks = useProjectStore((state) => state.marks);
  const marksUi = useProjectStore((state) => state.marksUi);
  const marksRun = useProjectStore((state) => state.marksRun);
  const marksFailures = useProjectStore((state) => state.marksFailures);
  const layers = useProjectStore((state) => state.layers);
  const imagePath = useProjectStore((state) => state.imagePath);
  const imageWidth = useProjectStore((state) => state.imageWidth);
  const imageHeight = useProjectStore((state) => state.imageHeight);
  const imageMode = useProjectStore((state) => state.imageMode);
  const workflow = useProjectStore((state) => state.workflow);
  const { addMarks, removeMark, clearMarks, setMarksUi } = useProjectStore.getState();
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<ParseError[]>([]);
  // null = follow the default: the tripod is added only while the image has no tripod layer yet.
  const [nadirChoice, setNadirChoice] = useState<boolean | null>(null);
  const mounted = useRef(true);

  // While this tab is open the Flat View is the map: grid and boxes on, mouse drawing off again when it closes.
  useEffect(() => {
    mounted.current = true;
    setMarksUi({ open: true });
    return () => {
      mounted.current = false;
      setMarksUi({ open: false, draw: false });
    };
  }, [setMarksUi]);

  const ready = !!imagePath && imageMode === '360' && workflow === 'viewing';
  const running = marksRun !== null;
  const includeNadir = nadirChoice ?? !layers.some((layer) => layer.name === NADIR_NAME);
  const warnings = useMemo(() => new Map(marks.map((mark) => [
    mark.id, compileMark(mark, { panorama: { width: imageWidth, height: imageHeight } }).warnings,
  ])), [marks, imageWidth, imageHeight]);

  const add = () => {
    const taken = [...marks.map((mark) => mark.name), ...layers.map((layer) => layer.name ?? '')];
    const parsed = parseMarkLines(text, nextMarkNumber(taken));
    if (parsed.marks.length) addMarks(parsed.marks);
    setErrors(parsed.errors);
    setText(parsed.errors.map((error) => error.text).join('\n'));
  };

  const create = async () => {
    const outcomes = await runCropLayers(includeNadir);
    setNadirChoice(null);
    // Move on to the layers only when everything worked and this tab is still the one being looked at;
    // otherwise stay here so the reasons can be read (and a panel that was closed does not pull anyone back).
    if (mounted.current && outcomes.length > 0 && outcomes.every((outcome) => !outcome.error)) onCreated();
  };

  return (
    <div className="marks-panel">
      <div className="marks-options">
        <label><input type="checkbox" checked={marksUi.grid} onChange={(event) => setMarksUi({ grid: event.target.checked })} /> Lưới</label>
        <label><input type="checkbox" checked={marksUi.draw} disabled={!ready} onChange={(event) => setMarksUi({ draw: event.target.checked })} /> Đánh dấu bằng chuột</label>
        <label><input type="checkbox" checked={includeNadir} onChange={(event) => setNadirChoice(event.target.checked)} /> Thêm chân máy</label>
      </div>
      <p className="marks-hint">Mỗi dòng một khung: <code>Tên: yaw a..b, pitch c..d</code> (độ; yaw được vượt ±180 cho cửa vắt qua mép trái/phải). Mở tab Flat View để thấy lưới và khung.</p>
      <textarea
        className="marks-input"
        aria-label="Khung cửa (mỗi dòng một khung)"
        rows={5}
        value={text}
        placeholder="Cửa A: yaw 70..110, pitch -10..25"
        onChange={(event) => setText(event.target.value)}
      />
      <div className="marks-actions">
        <button disabled={!text.trim()} onClick={add}>Thêm</button>
        <button disabled={!marks.length || running} onClick={clearMarks}>Xoá hết</button>
      </div>
      {errors.length > 0 && (
        <ul className="marks-errors" role="alert">
          {errors.map((error) => <li key={error.line}>Dòng {error.line}: {error.message}</li>)}
        </ul>
      )}
      <ul className="marks-list">
        {marks.map((mark) => (
          <li key={mark.id}>
            <div>
              <strong>{mark.name}</strong>
              <small>yaw {degrees(mark.yaw)} · pitch {degrees(mark.pitch)}</small>
              {(warnings.get(mark.id) ?? []).map((warning) => <small key={warning} className="marks-warning">⚠ {warning}</small>)}
            </div>
            <button aria-label={`Xóa khung ${mark.name}`} disabled={running} onClick={() => removeMark(mark.id)}>✕</button>
          </li>
        ))}
        {!marks.length && <li className="marks-empty">Chưa có khung nào.</li>}
      </ul>
      <button className="marks-create" disabled={!ready || running || (!marks.length && !includeNadir)} onClick={() => void create()}>
        {marksRun ? `Đang tạo ${marksRun.done}/${marksRun.total}…` : 'Tạo layer crop'}
      </button>
      {marksFailures.length > 0 && (
        <ul className="marks-errors" role="alert">
          {marksFailures.map((failure, index) => <li key={index}>{failure}</li>)}
        </ul>
      )}
    </div>
  );
}
