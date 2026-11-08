// Punto de entrada que carga EmDash (formato native): `createPlugin(opciones)`.
import { definePlugin, type ResolvedPlugin } from "emdash";
import { construirSettingsSchema, type OpcionesModoLiga } from "./runtime/config.ts";
import { ejecutarTick } from "./runtime/tick.ts";
import { marcarSucio } from "./runtime/estado.ts";
import { fragmentosDePagina, olvidarCache } from "./runtime/fragmentos.ts";
import { asegurarCron, construirRutas, herramientasMcp, NOMBRE_TICK } from "./runtime/rutas.ts";
import { CRON_TICK_POR_DEFECTO } from "./runtime/config.ts";

export const ID_PLUGIN = "modo-liga";
export const VERSION = "0.1.0";

export function createPlugin(opciones: OpcionesModoLiga = {}): ResolvedPlugin {
  const cronTick = opciones.cronTick ?? CRON_TICK_POR_DEFECTO;
  const sucio = (que: string) => async (event: unknown, ctx: { kv: Parameters<typeof marcarSucio>[0]; log: { warn(m: string, d?: unknown): void } }) => {
    try {
      const e = event as { collection?: string; content?: { id?: string; slug?: string | null } };
      await marcarSucio(ctx.kv, Date.now(), `${que} ${e.collection ?? ""} ${e.content?.slug ?? e.content?.id ?? ""}`.trim());
      olvidarCache();
    } catch (err) {
      ctx.log.warn("modo-liga: no se pudo marcar el contenido como pendiente", String(err));
    }
  };

  return definePlugin({
    id: ID_PLUGIN,
    version: VERSION,
    capabilities: ["content:read", "hooks.page-fragments:register", "network:request:unrestricted"],
    hooks: {
      "plugin:activate": async (_event, ctx) => {
        await asegurarCron(ctx, cronTick);
      },
      cron: async (event, ctx) => {
        if (event.name !== NOMBRE_TICK) return;
        await ejecutarTick(ctx, opciones);
      },
      "content:afterPublish": sucio("publicado"),
      "content:afterUnpublish": sucio("despublicado"),
      "content:afterRestore": sucio("restaurado"),
      "content:afterDelete": sucio("borrado"),
      "page:fragments": async (_event, ctx) => fragmentosDePagina(ctx, opciones),
    },
    routes: construirRutas(opciones),
    mcp: herramientasMcp,
    admin: { settingsSchema: construirSettingsSchema(opciones) },
  });
}
