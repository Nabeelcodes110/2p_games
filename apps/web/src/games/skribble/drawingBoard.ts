// OWNER: Agent 3
// Logical drawing model for the current turn, independent of PixiJS and React.
// Tracks server sequence numbers so relayed strokes/clears apply once and in order, and keeps
// bounded history so the renderer can be (re)attached and replayed at any time.
import { SKRIBBLE_LIMITS } from '@2p/shared';
import type { ClearEvent, StrokeBatch } from '@2p/shared';
import type { DrawOp } from './strokeRenderer';

export interface BoardRenderer {
  draw(op: DrawOp): void;
  clear(): void;
}

const MAX_PENDING_EVENTS = 500;

type RemoteEvent = { kind: 'stroke'; batch: StrokeBatch } | { kind: 'clear'; event: ClearEvent };

export class DrawingBoard {
  private ops: DrawOp[] = [];
  private points = 0;
  private renderer: BoardRenderer | null = null;
  private turnKey: string | null = null;
  private lastSeq = 0;
  private readonly localStrokes = new Set<string>();
  /** Events that arrived before React switched to their turn. */
  private pending: RemoteEvent[] = [];

  get pointCount(): number {
    return this.points;
  }

  get currentTurnKey(): string | null {
    return this.turnKey;
  }

  attach(renderer: BoardRenderer): void {
    this.renderer = renderer;
    this.replay();
  }

  detach(): void {
    this.renderer = null;
  }

  /**
   * Switches to a turn (clearing everything) or, for the same turn, catches up from a snapshot
   * when it is ahead of what was applied live.
   */
  sync(matchId: string, turnId: string, strokes: StrokeBatch[], lastSeq: number, drawing: boolean): void {
    const key = turnKeyOf(matchId, turnId);
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.localStrokes.clear();
      this.loadSnapshot(strokes, lastSeq);
      const pending = this.pending.filter((e) => eventKey(e) === key);
      this.pending = [];
      for (const event of pending) this.applyRemote(event);
      return;
    }
    if (lastSeq > this.lastSeq && !drawing) this.loadSnapshot(strokes, lastSeq);
  }

  remoteStroke(batch: StrokeBatch): void {
    this.applyRemote({ kind: 'stroke', batch });
  }

  remoteClear(event: ClearEvent): void {
    this.applyRemote({ kind: 'clear', event });
  }

  /** Drawer's own points: rendered immediately, never re-drawn from echoes or acks. */
  local(op: DrawOp): void {
    this.localStrokes.add(op.strokeId);
    this.push(op);
  }

  localClear(): void {
    this.ops = [];
    this.points = 0;
    this.renderer?.clear();
  }

  /** Server accepted one of our batches/clears. */
  acknowledge(seq: number): void {
    this.lastSeq = Math.max(this.lastSeq, seq);
  }

  private applyRemote(event: RemoteEvent): void {
    const key = eventKey(event);
    if (key !== this.turnKey) {
      if (this.pending.length < MAX_PENDING_EVENTS) this.pending.push(event);
      return;
    }
    const seq = event.kind === 'stroke' ? event.batch.seq : event.event.seq;
    if (seq <= this.lastSeq) return;
    this.lastSeq = seq;
    if (event.kind === 'clear') {
      this.localClear();
      return;
    }
    const { batch } = event;
    if (this.localStrokes.has(batch.strokeId)) return;
    this.push(toOp(batch));
  }

  private loadSnapshot(strokes: StrokeBatch[], lastSeq: number): void {
    this.ops = [];
    this.points = 0;
    this.lastSeq = lastSeq;
    for (const batch of strokes) this.record(toOp(batch));
    this.replay();
  }

  private push(op: DrawOp): void {
    if (this.record(op)) this.renderer?.draw(op);
  }

  private record(op: DrawOp): boolean {
    if (this.points + op.points.length > SKRIBBLE_LIMITS.maxHistoryPoints) return false;
    this.ops.push(op);
    this.points += op.points.length;
    return true;
  }

  private replay(): void {
    if (!this.renderer) return;
    this.renderer.clear();
    for (const op of this.ops) this.renderer.draw(op);
  }
}

function turnKeyOf(matchId: string, turnId: string): string {
  return `${matchId}:${turnId}`;
}

function eventKey(event: RemoteEvent): string {
  const ref = event.kind === 'stroke' ? event.batch : event.event;
  return turnKeyOf(ref.matchId, ref.turnId);
}

function toOp(batch: StrokeBatch): DrawOp {
  return {
    strokeId: batch.strokeId,
    tool: batch.tool,
    color: batch.color,
    width: batch.width,
    points: batch.points,
    final: batch.final,
  };
}
