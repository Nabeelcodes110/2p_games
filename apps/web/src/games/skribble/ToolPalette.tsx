// OWNER: Agent 3
// Inventory-slot tool palette: pencil, eraser, colours, brush sizes, clear.
import { SKRIBBLE_BRUSH_SIZES, SKRIBBLE_PALETTE } from '@2p/shared';
import type { SkribbleBrushSize, SkribbleColor, SkribbleTool } from '@2p/shared';
import { PixelButton } from '../../components/PixelButton';
import styles from './SkribbleGame.module.scss';

const COLOR_NAMES: Record<SkribbleColor, string> = {
  '#000000': 'Black',
  '#757575': 'Grey',
  '#FFFFFF': 'White',
  '#D32F2F': 'Red',
  '#F57C00': 'Orange',
  '#F2C94C': 'Gold',
  '#5D8C3E': 'Grass green',
  '#2E7D32': 'Dark green',
  '#8DC9EE': 'Sky blue',
  '#1565C0': 'Blue',
  '#6A1B9A': 'Purple',
  '#79553A': 'Brown',
};

const SIZE_NAMES = ['Small', 'Medium', 'Large', 'Huge'];

interface ToolPaletteProps {
  tool: SkribbleTool;
  color: SkribbleColor;
  width: SkribbleBrushSize;
  onTool: (tool: SkribbleTool) => void;
  onColor: (color: SkribbleColor) => void;
  onWidth: (width: SkribbleBrushSize) => void;
  onClear: () => void;
}

export function ToolPalette({ tool, color, width, onTool, onColor, onWidth, onClear }: ToolPaletteProps) {
  return (
    <div className={styles.palette} role="toolbar" aria-label="Drawing tools">
      <div className={styles.slotGroup} role="group" aria-label="Tool">
        <button
          type="button"
          className={styles.slot}
          aria-pressed={tool === 'pencil'}
          aria-label="Pencil"
          title="Pencil"
          onClick={() => onTool('pencil')}
        >
          <PencilIcon color={color} />
        </button>
        <button
          type="button"
          className={styles.slot}
          aria-pressed={tool === 'eraser'}
          aria-label="Eraser"
          title="Eraser"
          onClick={() => onTool('eraser')}
        >
          <EraserIcon />
        </button>
      </div>

      <div className={`${styles.slotGroup} ${styles.colors}`} role="group" aria-label="Colour">
        {SKRIBBLE_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.slot} ${styles.swatchSlot}`}
            aria-pressed={tool === 'pencil' && color === c}
            aria-label={COLOR_NAMES[c]}
            title={COLOR_NAMES[c]}
            onClick={() => onColor(c)}
          >
            <span className={styles.swatch} style={{ backgroundColor: c }} />
          </button>
        ))}
      </div>

      <div className={styles.slotGroup} role="group" aria-label="Brush size">
        {SKRIBBLE_BRUSH_SIZES.map((size, i) => (
          <button
            key={size}
            type="button"
            className={styles.slot}
            aria-pressed={width === size}
            aria-label={`${SIZE_NAMES[i] ?? size} brush`}
            title={`${SIZE_NAMES[i] ?? size} brush`}
            onClick={() => onWidth(size)}
          >
            <span className={styles.sizeDot} style={{ width: 4 + i * 6, height: 4 + i * 6 }} />
          </button>
        ))}
      </div>

      <PixelButton variant="danger" className={styles.clearButton} onClick={onClear}>
        Clear
      </PixelButton>
    </div>
  );
}

function PencilIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 16 16" width="24" height="24" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="10" y="2" width="4" height="4" fill="#F5E8C8" />
      <rect x="8" y="4" width="4" height="4" fill="#F2C94C" />
      <rect x="6" y="6" width="4" height="4" fill="#F2C94C" />
      <rect x="4" y="8" width="4" height="4" fill="#79553A" />
      <rect x="2" y="12" width="2" height="2" fill={color} stroke="#252525" strokeWidth="0.5" />
      <rect x="2" y="10" width="2" height="2" fill="#79553A" />
      <rect x="4" y="12" width="2" height="2" fill="#79553A" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg viewBox="0 0 16 16" width="24" height="24" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="6" y="2" width="8" height="6" fill="#F28B9B" />
      <rect x="2" y="8" width="8" height="6" fill="#F5E8C8" />
      <rect x="10" y="8" width="2" height="2" fill="#F28B9B" />
      <rect x="2" y="13" width="8" height="1" fill="#252525" />
    </svg>
  );
}
