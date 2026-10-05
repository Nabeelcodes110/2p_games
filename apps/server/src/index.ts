// OWNER: Agent 1
import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { loadConfig } from './config.js';
import { registerSocketHandlers } from './socket/registerSocketHandlers.js';
import type { AppServer } from './socket/types.js';

const config = loadConfig();
const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io: AppServer = new Server(httpServer, {
  cors: { origin: config.clientOrigins },
  // Bounds event payload size; strokes are small point batches.
  maxHttpBufferSize: 64 * 1024,
});

const rooms = registerSocketHandlers(io);

httpServer.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

function shutdown(): void {
  rooms.disposeAll();
  void io.close(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
