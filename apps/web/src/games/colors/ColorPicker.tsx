// Custom HSV color picker: saturation/brightness pad + hue slider. Pointer Events with capture,
// arrow-key support on the pad, and `touch-action: none` only on the pad itself.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { hsvToHex, type Hsv } from './hsv';
import styles from './ColorsGame.module.scss';

interface ColorPickerProps {
  initial: Hsv;
  disabled?: boolean;
  onChange: (hex: string) => void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function ColorPicker({ initial, disabled, onChange }: ColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(initial);
  const padRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);

  const update = (next: Hsv) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    update({
      ...hsv,
      s: clamp01((event.clientX - rect.left) / rect.width),
      v: 1 - clamp01((event.clientY - rect.top) / rect.height),
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || activePointer.current !== null) return; // ignore extra touches
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    fromPointer(event);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId === activePointer.current) fromPointer(event);
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId === activePointer.current) activePointer.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: clamp01(hsv.s - step) },
      ArrowRight: { s: clamp01(hsv.s + step) },
      ArrowUp: { v: clamp01(hsv.v + step) },
      ArrowDown: { v: clamp01(hsv.v - step) },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    update({ ...hsv, ...move });
  };

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div className={styles.picker}>
      <div
        ref={padRef}
        className={styles.pad}
        style={{ backgroundColor: hueColor }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Saturation and brightness. Use arrow keys."
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onLostPointerCapture={endPointer}
        onKeyDown={onKeyDown}
      >
        <div
          className={styles.padHandle}
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }}
        />
      </div>

      <label className={styles.hueLabel} htmlFor="colors-hue">
        Hue
      </label>
      <input
        id="colors-hue"
        className={styles.hue}
        type="range"
        min={0}
        max={359}
        step={1}
        value={Math.round(hsv.h) % 360}
        disabled={disabled}
        onChange={(event) => update({ ...hsv, h: Number(event.target.value) })}
      />
    </div>
  );
}
