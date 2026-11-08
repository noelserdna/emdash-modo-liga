// Configuración efectiva = opciones del descriptor (astro.config) + settings del
// admin (prevalecen) + secretos del entorno. Nada específico de un sitio.
import type { PluginContext, SettingField } from "emdash";
import type { Politica, Forzado } from "../core/decision.ts";
import { TEXTOS_POR_DEFECTO, type Textos } from "../core/aviso.ts";
import { MARGENES_POR_DEFECTO } from "../core/ventanas.ts";
import { PARAMETROS_POR_DEFECTO } from "../core/decision.ts";
import { URL_HAYAHORA_ANY } from "../core/deteccion.ts";
import { NOMBRES_ENV_POR_DEFECTO, leerEnv, secretosDe, type NombresEnv, type Secretos } from "../env.ts";

export type Estrategia = "espejo" | "proxy-off";
export type DriverEspejoId = "netlify-build-hook" | "webhook" | "ninguno";
export type FuenteId = "espn" | "football-data" | "manual";

export interface OpcionesModoLiga {
  /** Host público del sitio, p. ej. "ejemplo.es". Si falta se toma de ctx.site.url. */
  dominio?: string;
  /** Registros DNS a cambiar. Por defecto el dominio y "www.<dominio>". */
  registros?: string[];
  /** Id de la zona de Cloudflare. También puede ponerse en el admin. */
  zonaId?: string;
  estrategia?: Estrategia;
  politica?: Politica;
  antesMin?: number;
  despuesMin?: number;
  permanenciaMin?: number;
  fuentes?: FuenteId[];
  competicionesEspn?: string[];
  competicionesFootballData?: string[];
  iniciosManuales?: string[];
  deteccion?: boolean;
  deteccionUrl?: string;
  espejo?: { driver?: DriverEspejoId; debounceMin?: number; horaNocturnaUTC?: number | null; diaCert?: number | null };
  banner?: boolean;
  /** Ruta de la página de aviso en el sitio vivo (p. ej. "/sin-acceso"); null si no existe. */
  rutaAviso?: string | null;
  textos?: Partial<Textos>;
  /** Nombres de las variables de entorno con los secretos. */
  env?: Partial<NombresEnv>;
  /** Expresión cron del tick. */
  cronTick?: string;
}

export interface Config {
  dominio: string;
  registros: string[];
  zonaId: string | null;
  estrategia: Estrategia;
  politica: Politica;
  antesMs: number;
  despuesMs: number;
  permanenciaMs: number;
  forzado: Forzado;
  fuentes: FuenteId[];
  competicionesEspn: string[];
  competicionesFootballData: string[];
  iniciosManuales: string[];
  deteccion: boolean;
  deteccionUrl: string;
  espejoDriver: DriverEspejoId;
  debounceMs: number;
  horaNocturnaUTC: number | null;
  diaCert: number | null;
  banner: boolean;
  rutaAviso: string | null;
  textos: Textos;
  cronTick: string;
  secretos: Secretos;
  nombresEnv: NombresEnv;
}

export const CRON_TICK_POR_DEFECTO = "*/5 * * * *";

function lista(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return null;
}

function numero(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
  }
}

/** Esquema del formulario del admin. Los secretos no van aquí. */
export function construirSettingsSchema(o: OpcionesModoLiga = {}): Record<string, SettingField> {
  return {
    forzado: {
      type: "select",
      label: "Forzar modo liga",
      description: "«on» pone el espejo ya; «off» lo impide; «auto» sigue el calendario y la detección.",
      options: [{ value: "auto", label: "Automático" }, { value: "on", label: "Forzar espejo (on)" }, { value: "off", label: "Impedir espejo (off)" }],
      default: "auto",
    },
    politica: {
      type: "select",
      label: "Política de activación",
      options: [{ value: "ambas", label: "Calendario y detección" }, { value: "calendario", label: "Solo calendario" }, { value: "deteccion", label: "Solo detección (hayahora.futbol)" }],
      default: o.politica ?? PARAMETROS_POR_DEFECTO.politica,
    },
    antesMin: { type: "number", label: "Minutos antes del partido", default: o.antesMin ?? MARGENES_POR_DEFECTO.antesMs / 60_000, min: 0, max: 240 },
    despuesMin: { type: "number", label: "Minutos desde el inicio hasta cerrar la ventana", default: o.despuesMin ?? MARGENES_POR_DEFECTO.despuesMs / 60_000, min: 60, max: 600 },
    permanenciaMin: { type: "number", label: "Permanencia mínima en cada estado (min)", default: o.permanenciaMin ?? PARAMETROS_POR_DEFECTO.permanenciaMs / 60_000, min: 0, max: 120 },
    estrategia: {
      type: "select",
      label: "Estrategia",
      description: "«espejo»: el DNS apunta a una copia en otro proveedor (Workers/Pages). «proxy-off»: se quita el proxy de Cloudflare y se expone el origen propio.",
      options: [{ value: "espejo", label: "Espejo (Netlify u otro)" }, { value: "proxy-off", label: "Quitar el proxy (origen propio)" }],
      default: o.estrategia ?? "espejo",
    },
    zonaId: { type: "string", label: "Id de la zona de Cloudflare", description: "Zone ID del dominio. El token va en el secreto del Worker.", default: o.zonaId ?? "" },
    registros: { type: "string", label: "Registros DNS a cambiar", description: "Separados por comas. Vacío = dominio y www.", default: (o.registros ?? []).join(", ") },
    fuentes: { type: "string", label: "Fuentes de horarios", description: "espn, football-data, manual (separadas por comas).", default: (o.fuentes ?? ["espn"]).join(", ") },
    competicionesEspn: { type: "string", label: "Ligas en ESPN", description: "esp.1 Primera, esp.2 Segunda, esp.copa_del_rey, uefa.champions…", default: (o.competicionesEspn ?? ["esp.1", "esp.2"]).join(", ") },
    competicionesFootballData: { type: "string", label: "Competiciones en football-data.org", description: "PD Primera, SD Segunda, CL Champions (token en el secreto del Worker).", default: (o.competicionesFootballData ?? ["PD"]).join(", ") },
    iniciosManuales: { type: "string", label: "Partidos manuales (ISO 8601, uno por línea)", multiline: true, default: (o.iniciosManuales ?? []).join("\n") },
    deteccion: { type: "boolean", label: "Consultar hayahora.futbol", default: o.deteccion ?? true },
    deteccionUrl: { type: "url", label: "Lista de IPs bloqueadas", default: o.deteccionUrl ?? URL_HAYAHORA_ANY },
    espejoDriver: {
      type: "select",
      label: "Cómo se reconstruye el espejo",
      options: [{ value: "netlify-build-hook", label: "Build hook de Netlify" }, { value: "webhook", label: "Webhook genérico" }, { value: "ninguno", label: "No reconstruir" }],
      default: o.espejo?.driver ?? "netlify-build-hook",
    },
    debounceMin: { type: "number", label: "Esperar tras publicar antes de reconstruir (min)", default: o.espejo?.debounceMin ?? 15, min: 0, max: 240 },
    horaNocturnaUTC: { type: "number", label: "Hora UTC de la reconstrucción diaria (-1 = ninguna)", default: o.espejo?.horaNocturnaUTC ?? 4, min: -1, max: 23 },
    diaCert: { type: "number", label: "Día del mes para renovar el certificado (0 = nunca)", default: o.espejo?.diaCert ?? 1, min: 0, max: 28 },
    banner: { type: "boolean", label: "Mostrar aviso en las páginas", default: o.banner ?? true },
    rutaAviso: { type: "string", label: "Ruta de la página de aviso", description: "Vacío si el sitio no la tiene.", default: o.rutaAviso ?? "" },
    textoX: { type: "string", label: "Mensaje para X", multiline: true, default: o.textos?.textoX ?? TEXTOS_POR_DEFECTO.textoX },
    titulo: { type: "string", label: "Aviso: título", default: o.textos?.titulo ?? TEXTOS_POR_DEFECTO.titulo },
    encabezado: { type: "string", label: "Aviso: encabezado", default: o.textos?.encabezado ?? TEXTOS_POR_DEFECTO.encabezado },
    explicacion: { type: "string", label: "Aviso: explicación", multiline: true, default: o.textos?.explicacion ?? TEXTOS_POR_DEFECTO.explicacion },
    consecuencia: { type: "string", label: "Aviso: qué funciona y qué no", multiline: true, default: o.textos?.consecuencia ?? TEXTOS_POR_DEFECTO.consecuencia },
    llamada: { type: "string", label: "Aviso: llamada a quejarse", multiline: true, default: o.textos?.llamada ?? TEXTOS_POR_DEFECTO.llamada },
    boton: { type: "string", label: "Aviso: texto del botón", default: o.textos?.boton ?? TEXTOS_POR_DEFECTO.boton },
    bannerAntes: { type: "string", label: "Banner antes del partido", default: o.textos?.bannerAntes ?? TEXTOS_POR_DEFECTO.bannerAntes },
    bannerDurante: { type: "string", label: "Banner durante el bloqueo", default: o.textos?.bannerDurante ?? TEXTOS_POR_DEFECTO.bannerDurante },
    bannerEspejo: { type: "string", label: "Banner en la copia de emergencia", default: o.textos?.bannerEspejo ?? TEXTOS_POR_DEFECTO.bannerEspejo },
  };
}

/** Lee settings (1 llamada) y secretos y devuelve la configuración efectiva. */
export async function leerConfig(ctx: Pick<PluginContext, "settings" | "site">, o: OpcionesModoLiga = {}, env?: Record<string, unknown>): Promise<Config> {
  const esquema = construirSettingsSchema(o);
  const guardados = new Map((await ctx.settings.list()).map((s) => [s.key, s.value] as const));
  const valor = (clave: string): unknown => {
    const v = guardados.get(clave);
    if (v !== undefined && v !== null && v !== "") return v;
    const campo = esquema[clave] as { default?: unknown } | undefined;
    return campo?.default;
  };
  const texto = (clave: string): string => String(valor(clave) ?? "");
  const nombresEnv = { ...NOMBRES_ENV_POR_DEFECTO, ...o.env };
  const secretos = secretosDe(env ?? (await leerEnv()), nombresEnv);
  const dominio = o.dominio ?? hostDe(ctx.site.url);
  const registros = lista(valor("registros"));
  const horaNocturna = numero(valor("horaNocturnaUTC"));
  const diaCert = numero(valor("diaCert"));
  const textos: Textos = {
    ...TEXTOS_POR_DEFECTO,
    ...o.textos,
    ...Object.fromEntries((["textoX", "titulo", "encabezado", "explicacion", "consecuencia", "llamada", "boton", "bannerAntes", "bannerDurante", "bannerEspejo"] as const).map((k) => [k, texto(k)])),
  };
  return {
    dominio,
    registros: registros && registros.length ? registros : [dominio, `www.${dominio}`],
    zonaId: texto("zonaId") || null,
    estrategia: texto("estrategia") === "proxy-off" ? "proxy-off" : "espejo",
    politica: (["ambas", "calendario", "deteccion"].includes(texto("politica")) ? texto("politica") : "ambas") as Politica,
    antesMs: (numero(valor("antesMin")) ?? 30) * 60_000,
    despuesMs: (numero(valor("despuesMin")) ?? 210) * 60_000,
    permanenciaMs: (numero(valor("permanenciaMin")) ?? 20) * 60_000,
    forzado: (["auto", "on", "off"].includes(texto("forzado")) ? texto("forzado") : "auto") as Forzado,
    fuentes: (lista(valor("fuentes")) ?? ["espn"]).filter((f): f is FuenteId => ["espn", "football-data", "manual"].includes(f)),
    competicionesEspn: lista(valor("competicionesEspn")) ?? ["esp.1", "esp.2"],
    competicionesFootballData: lista(valor("competicionesFootballData")) ?? ["PD"],
    iniciosManuales: lista(valor("iniciosManuales")) ?? [],
    deteccion: valor("deteccion") !== false && texto("deteccion") !== "false",
    deteccionUrl: texto("deteccionUrl") || URL_HAYAHORA_ANY,
    espejoDriver: (["netlify-build-hook", "webhook", "ninguno"].includes(texto("espejoDriver")) ? texto("espejoDriver") : "netlify-build-hook") as DriverEspejoId,
    debounceMs: (numero(valor("debounceMin")) ?? 15) * 60_000,
    horaNocturnaUTC: horaNocturna === null || horaNocturna < 0 ? null : horaNocturna,
    diaCert: diaCert === null || diaCert <= 0 ? null : diaCert,
    banner: valor("banner") !== false && texto("banner") !== "false",
    rutaAviso: texto("rutaAviso") || null,
    textos,
    cronTick: o.cronTick ?? CRON_TICK_POR_DEFECTO,
    secretos,
    nombresEnv,
  };
}

/** Configuración sin secretos, para el admin y las herramientas MCP. */
export function configPublica(c: Config): Omit<Config, "secretos" | "nombresEnv"> & { secretosPresentes: string[] } {
  const { secretos, nombresEnv, ...resto } = c;
  return { ...resto, secretosPresentes: Object.keys(secretos).map((k) => nombresEnv[k as keyof NombresEnv]) };
}
