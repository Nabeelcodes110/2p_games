// OWNER: Agent 3
// Drawing surface: PixiJS rendering + Pointer Events input. React only mounts it and passes
// settings; points never go through React state.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { SKRIBBLE_LIMITS, SKRIBBLE_LOGICAL_HEIGHT, SKRIBBLE_LOGICAL_WIDTH } from '@2p/shared';
import type {
  ClearEvent,
  NormalizedPoint,
  SkribbleBrushSize,
  SkribbleColor,
  SkribbleTool,
  StrokeBatch,
} from '@2p/shared';
import type { AppSocket } from '../../socket/types';
import { DrawingBoard } from './drawingBoard';
import { StrokeRenderer } from './strokeRenderer';
import type { DrawOp } from './strokeRenderer';
import styles from './SkribbleGame.module.scss';

export interface SkribbleCanvasProps {
  socket: AppSocket;
  matchId: string;
  turnId: string;
  canDraw: boolean;
  tool: SkribbleTool;
  color: SkribbleColor;
  width: SkribbleBrushSize;
  strokes: StrokeBatch[];
  lastSeq: number;
  onError: (message: string) => void;
}

export interface SkribbleCanvasHandle {
  clear(): void;
}

const FLUSH_INTERVAL_MS = 50;
/** Ignore pointer moves shorter than this (normalized units) to bound point counts. */
const MIN_POINT_DISTANCE = 0.0015;

interface LocalStroke {
  pointerId: number;
  strokeId: string;
  tool: SkribbleTool;
  color: SkribbleColor;
  width: SkribbleBrushSize;
  last: NormalizedPoint;
  points: number;
  buffer: NormalizedPoint[];
  failed: boolean;
}

let strokeCounter = 0;
function newStrokeId(): string {
  strokeCounter += 1;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${strokeCounter}`;
}

export const SkribbleCanvas = forwardRef<SkribbleCanvasHandle, SkribbleCanvasProps>(function SkribbleCanvas(
  props,
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef(new DrawingBoard());
  const propsRef = useRef(props);
  propsRef.current = props;
  /** Set by the setup effect; ends the in-progress stroke (sending it as final unless cancelled). */
  const endStrokeRef = useRef<(send: boolean) => void>(() => {});

  const { socket, matchId, turnId, strokes, lastSeq, canDraw } = props;

  // Keep the board aligned with authoritative snapshots (turn switches and catch-up).
  useEffect(() => {
    const board = boardRef.current;
    if (board.currentTurnKey !== `${matchId}:${turnId}`) endStrokeRef.current(false);
    board.sync(matchId, turnId, strokes, lastSeq, false);
  }, [matchId, turnId, strokes, lastSeq]);

  // Losing the drawer role (turn end) cancels any open stroke; the server would reject it anyway.
  useEffect(() => {
    if (!canDraw) endStrokeRef.current(false);
  }, [canDraw]);

  // Live relayed drawing from the server. Only our specific listeners are removed.
  useEffect(() => {
    const board = boardRef.current;
    const onStroke = (batch: StrokeBatch) => board.remoteStroke(batch);
    const onClear = (event: ClearEvent) => board.remoteClear(event);
    socket.on('skribble:stroke', onStroke);
    socket.on('skribble:clear', onClear);
    return () => {
      socket.off('skribble:stroke', onStroke);
      socket.off('skribble:clear', onClear);
    };
  }, [socket]);

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        const { canDraw: allowed, matchId: m, turnId: t, socket: s, onError } = propsRef.current;
        if (!allowed) return;
        endStrokeRef.current(true);
        boardRef.current.localClear();
        s.emit('skribble:clear', { matchId: m, turnId: t }, (result) => {
          if (result.ok) boardRef.current.acknowledge(result.data.seq);
          else onError(result.error.message);
        });
      },
    }),
    [],
  );

  // PixiJS lifecycle, pointer input and resizing.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const board = boardRef.current;
    const renderer = new StrokeRenderer();
    let canvas: HTMLCanvasElement | null = null;
    let disposed = false;
    let active: LocalStroke | null = null;
    let flushTimer: number | null = null;

    const emitBatch = (stroke: LocalStroke, points: NormalizedPoint[], final: boolean) => {
      const { socket: s, matchId: m, turnId: t, onError } = propsRef.current;
      s.emit(
        'skribble:stroke',
        { matchId: m, turnId: t, strokeId: stroke.strokeId, tool: stroke.tool, color: stroke.color, width: stroke.width, points, final },
        (result) => {
          if (result.ok) {
            board.acknowledge(result.data.seq);
          } else if (!stroke.failed) {
            stroke.failed = true;
            onError(result.error.message);
          }
        },
      );
    };

    const flush = (final: boolean) => {
      const stroke = active;
      if (!stroke || stroke.failed) return;
      while (stroke.buffer.length > SKRIBBLE_LIMITS.maxPointsPerBatch) {
        emitBatch(stroke, stroke.buffer.splice(0, SKRIBBLE_LIMITS.maxPointsPerBatch), false);
      }
      if (stroke.buffer.length > 0 || final) emitBatch(stroke, stroke.buffer.splice(0), final);
    };

    const endStroke = (send: boolean) => {
      if (!active) return;
      if (send) flush(true);
      board.local({ ...opOf(active), points: [], final: true });
      if (canvas?.hasPointerCapture(active.pointerId)) canvas.releasePointerCapture(active.pointerId);
      active = null;
      if (flushTimer !== null) {
        window.clearInterval(flushTimer);
        flushTimer = null;
      }
    };
    endStrokeRef.current = endStroke;

    const toPoint = (event: PointerEvent): NormalizedPoint => {
      const rect = (canvas as HTMLCanvasElement).getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
      return [clampUnit(x), clampUnit(y)];
    };

    const beginStroke = (pointerId: number, point: NormalizedPoint) => {
      const { tool, color, width } = propsRef.current;
      active = {
        pointerId,
        strokeId: newStrokeId(),
        tool,
        color,
        width,
        last: point,
        points: 1,
        buffer: [point],
        failed: false,
      };
      board.local({ ...opOf(active), points: [point], final: false });
      flushTimer ??= window.setInterval(() => flush(false), FLUSH_INTERVAL_MS);
    };

    const addPoint = (point: NormalizedPoint) => {
      const stroke = active;
      if (!stroke) return;
      if (Math.hypot(point[0] - stroke.last[0], point[1] - stroke.last[1]) < MIN_POINT_DISTANCE) return;
      if (board.pointCount >= SKRIBBLE_LIMITS.maxHistoryPoints - 1) {
        endStroke(true);
        propsRef.current.onError('The canvas is full. Clear it to keep drawing.');
        return;
      }
      if (stroke.points >= SKRIBBLE_LIMITS.maxPointsPerStroke) {
        // Continue seamlessly as a new stroke from the last point, keeping pointer capture.
        flush(true);
        board.local({ ...opOf(stroke), points: [], final: true });
        stroke.strokeId = newStrokeId();
        stroke.points = 1;
        stroke.buffer = [stroke.last];
        board.local({ ...opOf(stroke), points: [stroke.last], final: false });
      }
      stroke.points += 1;
      stroke.last = point;
      stroke.buffer.push(point);
      board.local({ ...opOf(stroke), points: [point], final: false });
    };

    const onPointerDown = (event: PointerEvent) => {
      // Ignore extra touches during a stroke and non-primary mouse buttons.
      if (!propsRef.current.canDraw || active || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (board.pointCount >= SKRIBBLE_LIMITS.maxHistoryPoints - 1) {
        propsRef.current.onError('The canvas is full. Clear it to keep drawing.');
        return;
      }
      event.preventDefault();
      canvas?.setPointerCapture(event.pointerId);
      beginStroke(event.pointerId, toPoint(event));
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.pointerId) return;
      event.preventDefault();
      const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      for (const sample of samples.length > 0 ? samples : [event]) addPoint(toPoint(sample));
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (active && event.pointerId === active.pointerId) endStroke(true);
    };

    const fit = () => {
      const width = host.clientWidth;
      const height = (width * SKRIBBLE_LOGICAL_HEIGHT) / SKRIBBLE_LOGICAL_WIDTH;
      // Finish the stroke so a mid-stroke resize/rotation cannot skew its coordinates.
      endStroke(true);
      renderer.resize(width, height);
    };
    // Fall back to window resizes where ResizeObserver is unavailable (old browsers, jsdom).
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;

    void renderer
      .init()
      .then((view) => {
        if (disposed) {
          renderer.destroy();
          return;
        }
        canvas = view;
        canvas.className = styles.canvas ?? '';
        canvas.setAttribute('aria-label', 'Drawing canvas');
        canvas.setAttribute('role', 'img');
        host.appendChild(canvas);
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerEnd);
        canvas.addEventListener('pointercancel', onPointerEnd);
        canvas.addEventListener('lostpointercapture', onPointerEnd);
        if (observer) observer.observe(host);
        else window.addEventListener('resize', fit);
        fit();
        board.attach(renderer);
      })
      .catch((error: unknown) => {
        console.error('Failed to start the drawing canvas', error);
        if (!disposed) propsRef.current.onError('Could not start the drawing canvas.');
      });

    return () => {
      disposed = true;
      endStroke(false);
      endStrokeRef.current = () => {};
      observer?.disconnect();
      window.removeEventListener('resize', fit);
      board.detach();
      if (canvas) {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerEnd);
        canvas.removeEventListener('pointercancel', onPointerEnd);
        canvas.removeEventListener('lostpointercapture', onPointerEnd);
        renderer.destroy();
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`${styles.canvasHost} ${props.canDraw ? styles.canvasDrawable : ''}`}
      data-testid="skribble-canvas"
    />
  );
});

function opOf(stroke: LocalStroke): Omit<DrawOp, 'points' | 'final'> {
  return { strokeId: stroke.strokeId, tool: stroke.tool, color: stroke.color, width: stroke.width };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
