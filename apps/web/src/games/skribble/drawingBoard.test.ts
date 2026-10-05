import { describe, expect, it } from 'vitest';
import type { StrokeBatch } from '@2p/shared';
import { DrawingBoard } from './drawingBoard';
import type { BoardRenderer } from './drawingBoard';
import type { DrawOp } from './strokeRenderer';

function recorder() {
  const log: string[] = [];
  const renderer: BoardRenderer = {
    draw: (op: DrawOp) => void log.push(`draw:${op.strokeId}:${op.points.length}`),
    clear: () => void log.push('clear'),
  };
  return { log, renderer };
}

function batch(seq: number, strokeId: string, turnId = 't1'): StrokeBatch {
  return {
    matchId: 'm1',
    turnId,
    strokeId,
    tool: 'pencil',
    color: '#000000',
    width: 6,
    points: [[0.5, 0.5]],
    final: false,
    seq,
  };
}

describe('DrawingBoard', () => {
  it('applies relayed strokes once and in order, ignoring duplicates and old seqs', () => {
    const board = new DrawingBoard();
    const { log, renderer } = recorder();
    board.attach(renderer);
    board.sync('m1', 't1', [], 0, false);
    log.length = 0;

    board.remoteStroke(batch(1, 'a'));
    board.remoteStroke(batch(1, 'a'));
    board.remoteStroke(batch(2, 'a'));
    expect(log).toEqual(['draw:a:1', 'draw:a:1']);
  });

  it('never re-draws strokes the drawer rendered locally', () => {
    const board = new DrawingBoard();
    const { log, renderer } = recorder();
    board.attach(renderer);
    board.sync('m1', 't1', [], 0, false);
    board.local({ strokeId: 'mine', tool: 'pencil', color: '#000000', width: 6, points: [[0, 0]], final: false });
    board.remoteStroke(batch(1, 'mine'));
    expect(log.filter((l) => l.startsWith('draw'))).toEqual(['draw:mine:1']);
  });

  it('clears in sequence order with strokes', () => {
    const board = new DrawingBoard();
    const { log, renderer } = recorder();
    board.attach(renderer);
    board.sync('m1', 't1', [], 0, false);
    log.length = 0;
    board.remoteStroke(batch(1, 'a'));
    board.remoteClear({ matchId: 'm1', turnId: 't1', seq: 2 });
    board.remoteStroke(batch(3, 'b'));
    expect(log).toEqual(['draw:a:1', 'clear', 'draw:b:1']);
    expect(board.pointCount).toBe(1);
  });

  it('buffers events that arrive before the turn switch and applies them after the snapshot', () => {
    const board = new DrawingBoard();
    const { log, renderer } = recorder();
    board.attach(renderer);
    board.sync('m1', 't1', [batch(1, 'old')], 1, false);
    board.remoteStroke(batch(1, 'early', 't2'));
    board.remoteStroke(batch(2, 'stale', 't0'));
    log.length = 0;

    board.sync('m1', 't2', [], 0, false);
    expect(log).toEqual(['clear', 'draw:early:1']);
  });

  it('replays the full history when a renderer attaches late', () => {
    const board = new DrawingBoard();
    board.sync('m1', 't1', [batch(1, 'a'), batch(2, 'b')], 2, false);
    const { log, renderer } = recorder();
    board.attach(renderer);
    expect(log).toEqual(['clear', 'draw:a:1', 'draw:b:1']);
  });

  it('catches up from a snapshot that is ahead of live events', () => {
    const board = new DrawingBoard();
    const { log, renderer } = recorder();
    board.attach(renderer);
    board.sync('m1', 't1', [], 0, false);
    log.length = 0;
    board.sync('m1', 't1', [batch(1, 'a'), batch(2, 'b')], 2, false);
    expect(log).toEqual(['clear', 'draw:a:1', 'draw:b:1']);
    log.length = 0;
    board.sync('m1', 't1', [batch(1, 'a'), batch(2, 'b')], 2, false);
    expect(log).toEqual([]);
  });
});
