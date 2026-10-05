// OWNER: Agent 3
// Server-side Skribble: word assignment, stroke/clear/guess validation, secret-word isolation.
import type { ServerGameModule } from '../types.js';

export const skribbleModule: ServerGameModule<'skribble'> = {
  id: 'skribble',
  actionEvents: ['skribble:stroke', 'skribble:clear', 'skribble:guess'],
  createSession(ctx) {
    void ctx;
    throw new Error('TODO(Agent 3): skribble session not implemented');
  },
};
