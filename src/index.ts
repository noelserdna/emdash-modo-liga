// API pública: el descriptor para `emdash({ plugins: [modoLiga({...})] })` y el
// wrapper del Worker. Ambos se importan desde astro.config.mjs / src/worker.ts.
import type { PluginDescriptor } from "emdash";
import { construirSettingsSchema, type OpcionesModoLiga } from "./runtime/config.ts";
import { ID_PLUGIN, VERSION } from "./plugin.ts";

export type { OpcionesModoLiga } from "./runtime/config.ts";
export { withModoLiga, type OpcionesWorker, type ManejadorFetch, type ManejadorEnvuelto } from "./worker/index.ts";
export { ID_PLUGIN, VERSION };

export function modoLiga(opciones: OpcionesModoLiga = {}): PluginDescriptor<OpcionesModoLiga> {
  return {
    id: ID_PLUGIN,
    version: VERSION,
    entrypoint: "emdash-modo-liga/plugin",
    format: "native",
    options: opciones,
    capabilities: ["content:read", "hooks.page-fragments:register", "network:request:unrestricted"],
    settingsSchema: construirSettingsSchema(opciones),
  };
}
