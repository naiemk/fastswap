import type { FastSwapConfigFile } from "../config/types.js";

/** API base URL for node → API calls. Prefer FASTSWAP_API_BASE in Docker (e.g. http://api:4010). */
export function resolveApiBaseUrl(config: FastSwapConfigFile, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.FASTSWAP_API_BASE?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const publicUrl = config.server.publicUrl ?? `http://${config.server.host}:${config.server.apiPort}`;
  return publicUrl.replace(/\/$/, "");
}
