// Secretos del plugin: siempre en el entorno del Worker (`wrangler secret put`),
// nunca en los settings del admin. En Node (tests, CLI) se leen de process.env.

export interface NombresEnv {
  firma: string;
  cfToken: string;
  buildHook: string;
  webhook: string;
  footballDataToken: string;
}

export const NOMBRES_ENV_POR_DEFECTO: NombresEnv = {
  firma: "MODO_LIGA_FIRMA",
  cfToken: "MODO_LIGA_CF_TOKEN",
  buildHook: "MODO_LIGA_BUILD_HOOK",
  webhook: "MODO_LIGA_WEBHOOK",
  footballDataToken: "MODO_LIGA_FOOTBALL_DATA_TOKEN",
};

export async function leerEnv(): Promise<Record<string, unknown>> {
  try {
    const m = (await import("./env-cloudflare.ts")) as { env?: Record<string, unknown> };
    if (m.env) return m.env;
  } catch {
    // fuera de Workers
  }
  return typeof process !== "undefined" && process.env ? (process.env as Record<string, unknown>) : {};
}

export interface Secretos {
  firma?: string;
  cfToken?: string;
  buildHook?: string;
  webhook?: string;
  footballDataToken?: string;
}

export function secretosDe(env: Record<string, unknown>, nombres: NombresEnv = NOMBRES_ENV_POR_DEFECTO): Secretos {
  const s = (clave: keyof NombresEnv): string | undefined => {
    const v = env[nombres[clave]];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const out: Secretos = {};
  for (const clave of Object.keys(nombres) as (keyof NombresEnv)[]) {
    const v = s(clave);
    if (v) out[clave] = v;
  }
  return out;
}
