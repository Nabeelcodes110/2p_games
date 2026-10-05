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
});

registerSocketHandlers(io);

httpServer.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
