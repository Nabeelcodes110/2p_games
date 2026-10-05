// OWNER: Agent 1
export interface ServerConfig {
  port: number;
  clientOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 3001);
  const clientOrigins = (env.CLIENT_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return { port, clientOrigins };
}
