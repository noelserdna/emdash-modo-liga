// Rutas del plugin (/_emdash/api/plugins/modo-liga/<ruta>) y herramientas MCP.
import { z } from "zod";
import type { PluginContext, PluginRoute, RouteContext } from "emdash";
import { configPublica, leerConfig, type OpcionesModoLiga } from "./config.ts";
import { leerEstado } from "./estado.ts";
import { ejecutarTick, driverEspejoDe } from "./tick.ts";
import { estadoPublicoDe, olvidarCache } from "./fragmentos.ts";
import { CRON_TICK_POR_DEFECTO } from "./config.ts";

export const NOMBRE_TICK = "tick";

/** Programa el tick si falta o cambió. Nunca lanza: una activación fallida deshabilita el plugin. */
export async function asegurarCron(ctx: Pick<PluginContext, "cron" | "log">, schedule = CRON_TICK_POR_DEFECTO): Promise<boolean> {
  try {
    if (!ctx.cron) return false;
    const tareas = await ctx.cron.list();
    if (tareas.some((t) => t.name === NOMBRE_TICK && t.schedule === schedule)) return true;
    await ctx.cron.schedule(NOMBRE_TICK, { schedule });
    return true;
  } catch (e) {
    ctx.log.error("modo-liga: no se pudo programar el cron", String(e));
    return false;
  }
}

export const entradaForzar = z.object({ modo: z.enum(["auto", "on", "off"]) });
export const entradaSincronizar = z.object({ tarea: z.enum(["crawl", "cert"]).default("crawl") });
export const entradaVacia = z.object({}).passthrough();

export function construirRutas(opciones: OpcionesModoLiga): Record<string, PluginRoute> {
  const rutas: Record<string, PluginRoute> = {
    /** Pública y cacheable: estado resumido para depurar y para clientes externos. */
    estado: {
      public: true,
      cacheControl: "public, max-age=60, stale-while-revalidate=300",
      request: { body: "none" },
      handler: async (ctx: RouteContext) => {
        const c = await leerConfig(ctx, opciones);
        const estado = await leerEstado(ctx.kv);
        const espejo = ctx.request.headers.get("x-modo-liga") === "espejo";
        return estadoPublicoDe(estado, c, Date.now(), espejo);
      },
    },
    "estado-admin": {
      permission: "plugins:manage",
      request: { body: "json" },
      handler: async (ctx: RouteContext) => {
        const c = await leerConfig(ctx, opciones);
        const estado = await leerEstado(ctx.kv);
        const cron = await asegurarCron(ctx, c.cronTick);
        return { config: configPublica(c), estado, cronProgramado: cron, espejoConfigurado: driverEspejoDe(c) !== null };
      },
    },
    forzar: {
      permission: "plugins:manage",
      input: entradaForzar,
      request: { body: "json" },
      handler: async (ctx: RouteContext<z.infer<typeof entradaForzar>>) => {
        await ctx.settings.set("forzado", ctx.input.modo);
        olvidarCache();
        const informe = await ejecutarTick(ctx, opciones);
        return { forzado: ctx.input.modo, informe };
      },
    },
    sincronizar: {
      permission: "plugins:manage",
      input: entradaSincronizar,
      request: { body: "json" },
      handler: async (ctx: RouteContext<z.infer<typeof entradaSincronizar>>) => {
        const c = await leerConfig(ctx, opciones);
        const driver = driverEspejoDe(c);
        if (!driver) return { ok: false, detalle: "No hay driver de espejo configurado (settings.espejoDriver y su secreto)." };
        return driver.reconstruir(ctx.input.tarea, fetch, Date.now());
      },
    },
    tick: {
      permission: "plugins:manage",
      request: { body: "json" },
      handler: async (ctx: RouteContext) => {
        const c = await leerConfig(ctx, opciones);
        await asegurarCron(ctx, c.cronTick);
        olvidarCache();
        return ejecutarTick(ctx, opciones);
      },
    },
  };
  return rutas;
}

export const herramientasMcp = {
  tools: {
    estado: {
      description: "Estado del modo liga: si el sitio está en el espejo, por qué, próximas ventanas de partidos, DNS, detección y última copia.",
      route: "estado-admin",
      input: entradaVacia,
      destructive: false,
    },
    forzar: {
      description: "Fuerza el modo liga (on), lo impide (off) o vuelve al automático (auto). Cambia el DNS del sitio en el siguiente tick.",
      route: "forzar",
      input: entradaForzar,
      destructive: true,
    },
    sincronizar: {
      description: "Pide reconstruir la copia estática del espejo (crawl) o renovar su certificado (cert).",
      route: "sincronizar",
      input: entradaSincronizar,
      destructive: false,
    },
    tick: {
      description: "Ejecuta ahora una pasada del cron del modo liga y devuelve el informe.",
      route: "tick",
      input: entradaVacia,
      destructive: false,
    },
  },
};
