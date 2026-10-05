// OWNER: Agent 3
// PixiJS v8 renderer for logical stroke ops. Draws in the fixed logical canvas space; the stage is
// scaled to the element size, so resizing never loses strokes.
import { Application, Container, Graphics } from 'pixi.js';
import {
  SKRIBBLE_CANVAS_BACKGROUND,
  SKRIBBLE_LOGICAL_HEIGHT,
  SKRIBBLE_LOGICAL_WIDTH,
} from '@2p/shared';
import type { NormalizedPoint, SkribbleBrushSize, SkribbleColor, SkribbleTool } from '@2p/shared';

export interface DrawOp {
  strokeId: string;
  tool: SkribbleTool;
  color: SkribbleColor;
  width: SkribbleBrushSize;
  points: NormalizedPoint[];
  final: boolean;
}

interface ActiveStroke {
  graphics: Graphics;
  last: [number, number] | null;
  /** Points in the current Graphics; long strokes roll over to keep geometry rebuilds cheap. */
  count: number;
}

const POINTS_PER_GRAPHICS = 256;
const MAX_RESOLUTION = 2;

export class StrokeRenderer {
  private readonly app = new Application();
  private readonly layer = new Container();
  private readonly active = new Map<string, ActiveStroke>();
  private initialized = false;
  private destroyed = false;

  async init(): Promise<HTMLCanvasElement> {
    await this.app.init({
      width: SKRIBBLE_LOGICAL_WIDTH,
      height: SKRIBBLE_LOGICAL_HEIGHT,
      background: SKRIBBLE_CANVAS_BACKGROUND,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION),
      // Only render when strokes change.
      autoStart: false,
    });
    this.initialized = true;
    this.app.stage.addChild(this.layer);
    return this.app.canvas;
  }

  /** Size in CSS pixels; the logical canvas is scaled to fit. */
  resize(width: number, height: number): void {
    if (!this.initialized || this.destroyed || width <= 0 || height <= 0) return;
    this.app.renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION));
    this.layer.scale.set(width / SKRIBBLE_LOGICAL_WIDTH, height / SKRIBBLE_LOGICAL_HEIGHT);
    this.render();
  }

  draw(op: DrawOp): void {
    if (!this.initialized || this.destroyed) return;
    if (op.points.length === 0) {
      if (op.final) this.active.delete(op.strokeId);
      return;
    }
    const color = op.tool === 'eraser' ? SKRIBBLE_CANVAS_BACKGROUND : op.color;
    let points = op.points.map(([x, y]): [number, number] => [x * SKRIBBLE_LOGICAL_WIDTH, y * SKRIBBLE_LOGICAL_HEIGHT]);

    let stroke = this.active.get(op.strokeId);
    if (!stroke || stroke.count >= POINTS_PER_GRAPHICS) {
      const graphics = new Graphics();
      this.layer.addChild(graphics);
      stroke = { graphics, last: stroke?.last ?? null, count: 0 };
      this.active.set(op.strokeId, stroke);
    }

    const { graphics } = stroke;
    const first = points[0];
    if (stroke.last === null && first) {
      // Stroke start: a dot so single taps are visible.
      graphics.circle(first[0], first[1], op.width / 2).fill(color);
      stroke.last = first;
      points = points.slice(1);
    }
    if (points.length > 0 && stroke.last) {
      graphics.moveTo(stroke.last[0], stroke.last[1]);
      for (const [x, y] of points) graphics.lineTo(x, y);
      graphics.stroke({ width: op.width, color, cap: 'round', join: 'round' });
      stroke.last = points[points.length - 1] ?? stroke.last;
    }
    stroke.count += op.points.length;
    if (op.final) this.active.delete(op.strokeId);
    this.render();
  }

  clear(): void {
    if (!this.initialized || this.destroyed) return;
    this.active.clear();
    for (const child of this.layer.removeChildren()) child.destroy();
    this.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active.clear();
    // Only an initialized Application can be destroyed safely.
    if (this.initialized) {
      this.app.destroy({ removeView: true }, { children: true });
    }
  }

  private render(): void {
    this.app.render();
  }
}
