// OWNER: Agent 3
// Authoritative match controller: runs the shared matchReducer, owns turn/result timers,
// validates timer callbacks against captured match/turn IDs, and builds sanitized snapshots.
import type { CreateMatchController } from '../games/types.js';

export const createMatchController: CreateMatchController = (options) => {
  void options;
  throw new Error('TODO(Agent 3): createMatchController not implemented');
};
