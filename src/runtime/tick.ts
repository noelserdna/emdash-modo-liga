// El tick del cron: horarios (un día por tick), detección, decisión, DNS y
// reconstrucción del espejo. Presupuesto: pocas subrequests y una escritura
// de KV solo si algo cambió. Todo lo externo llega por `fetchFn` y `ahora`.
import type { PluginContext } from "emdash";
import { ventanasDe, ventanaActual, proximaVentana, ventanasVigentes } from "../core/ventanas.ts";
import { descartarAntiguos, fuenteEspn, fuenteFootballData, fuenteManual, fusionarPartidos, iniciosDe, leerDia, siguienteLectura, diaUTC, type FuenteHorarios } from "../core/horarios/index.ts";
import { detectar, resolverIps } from "../core/deteccion.ts";
import { decidir } from "../core/decision.ts";
import { aplicar, capturarNormales, driverCloudflare, type DriverDns } from "../core/dns.ts";
import { driverNetlifyBuildHook, driverWebhook, type DriverEspejo, type Tarea } from "../core/espejo.ts";
import { leerConfig, type Config, type OpcionesModoLiga } from "./config.ts";
import { CLAVE_SUCIO, guardarEstado, leerEstado, type Estado, type Sucio } from "./estado.ts";

export interface Informe {
  evento: "modo-liga";
  at: string;
  dentro: boolean;
  motivo: string;
  cambia: boolean;
  ventanas: number;
  proximaVentana: string | null;
  horarios?: { dia: string; partidos: number; errores: string[] };
  deteccion?: { bloqueado: boolean; propiasBloqueadas: string[]; total: number } | { error: string } | "no-consultada";
  dns?: string;
  espejo?: string;
}

export interface Dependencias {
  fetchFn?: typeof fetch;
  ahora?: number;
  env?: Record<string, unknown>;
  /** Para pruebas: sustituye al driver de Cloudflare. */
  driverDns?: DriverDns;
}

type Ctx = Pick<PluginContext, "kv" | "settings" | "log" | "site">;

export function fuentesDe(c: Config): FuenteHorarios[] {
  const fuentes: FuenteHorarios[] = [];
  for (const f of c.fuentes) {
    if (f === "espn") fuentes.push(fuenteEspn(c.competicionesEspn));
    else if (f === "football-data" && c.secretos.footballDataToken) fuentes.push(fuenteFootballData(c.secretos.footballDataToken, c.competicionesFootballData));
    else if (f === "manual") fuentes.push(fuenteManual(c.iniciosManuales));
  }
  return fuentes;
}

export function driverEspejoDe(c: Config): DriverEspejo | null {
  if (c.espejoDriver === "netlify-build-hook" && c.secretos.buildHook) return driverNetlifyBuildHook(c.secretos.buildHook);
  if (c.espejoDriver === "webhook" && c.secretos.webhook) return driverWebhook(c.secretos.webhook);
  return null;
}

const DOS_HORAS = 2 * 3_600_000;
const TREINTA_MIN = 30 * 60_000;
const SEMANA = 7 * 86_400_000;

export async function ejecutarTick(ctx: Ctx, opciones: OpcionesModoLiga = {}, deps: Dependencias = {}): Promise<Informe> {
  const fetchFn = deps.fetchFn ?? fetch;
  const ahora = deps.ahora ?? Date.now();
  const c = await leerConfig(ctx, opciones, deps.env);
  const antes = await leerEstado(ctx.kv);
  const estado: Estado = structuredClone(antes);
  const informe: Informe = { evento: "modo-liga", at: new Date(ahora).toISOString(), dentro: false, motivo: "ninguno", cambia: false, ventanas: 0, proximaVentana: null };

  // 1. Horarios: un día por tick
  if (c.politica !== "deteccion") {
    const fuentes = fuentesDe(c);
    if (fuentes.length) {
      const lectura = siguienteLectura(ahora, estado.lectura.indice);
      const r = await leerDia(fuentes, lectura.dia, fetchFn);
      estado.partidos = descartarAntiguos(fusionarPartidos(estado.partidos, r.partidos, lectura.dia, r.fuentesOk), ahora);
      estado.lectura = { indice: lectura.indice, at: ahora, dia: lectura.dia, errores: r.errores };
      informe.horarios = { dia: lectura.dia, partidos: r.partidos.length, errores: r.errores };
    }
  }
  const inicios = iniciosDe(estado.partidos);
  const ventanas = ventanasVigentes(ventanasDe(inicios, { antesMs: c.antesMs, despuesMs: c.despuesMs }), ahora);
  informe.ventanas = ventanas.length;
  const proxima = proximaVentana(ventanas, ahora);
  informe.proximaVentana = proxima ? new Date(proxima.inicio).toISOString() : null;

  // 2. IPs propias (solo con el DNS en estado normal) y detección
  let bloqueado: boolean | null = null;
  if (c.deteccion) {
    if (!estado.decision.dentro && c.registros[0] && (estado.ips.resueltoAt === null || ahora - estado.ips.resueltoAt > SEMANA)) {
      try {
        estado.ips = { propias: await resolverIps(c.registros[0], fetchFn), resueltoAt: ahora };
      } catch (e) {
        ctx.log.warn("modo-liga: no se pudieron resolver las IPs propias", String(e));
      }
    }
    const cerca = ventanaActual(ventanas, ahora) !== null || (proxima !== null && proxima.inicio - ahora < DOS_HORAS) || estado.decision.dentro;
    if (c.politica === "deteccion" || cerca) {
      try {
        const d = await detectar(estado.ips.propias, fetchFn, ahora, c.deteccionUrl);
        estado.deteccion = d;
        bloqueado = d.bloqueado;
        informe.deteccion = { bloqueado: d.bloqueado, propiasBloqueadas: d.propiasBloqueadas, total: d.totalBloqueadas };
      } catch (e) {
        informe.deteccion = { error: String(e) };
      }
    } else informe.deteccion = "no-consultada";
  }

  // 3. Decisión
  const decision = decidir({
    ahora,
    ventanas,
    inicios,
    forzado: c.forzado,
    bloqueado,
    actual: estado.decision,
    parametros: { politica: c.politica, permanenciaMs: c.permanenciaMs },
  });
  estado.decision = decision.estado;
  estado.motivo = decision.motivo;
  informe.dentro = decision.dentro;
  informe.motivo = decision.motivo;
  informe.cambia = decision.cambia;

  // 4. DNS
  const driver = deps.driverDns ?? (c.secretos.cfToken && c.zonaId ? driverCloudflare(c.zonaId, c.secretos.cfToken, fetchFn) : null);
  if (!driver) {
    informe.dns = "sin-configurar";
  } else {
    try {
      if (!Object.keys(estado.dns.normales).length) {
        if (decision.dentro) {
          informe.dns = "sin-estado-normal";
          estado.dns.problemas = ["Hay que capturar el estado normal fuera de una ventana: pon forzado=off un momento o espera."];
        } else {
          const cap = await capturarNormales(driver, c.registros);
          estado.dns = { ...estado.dns, normales: cap.normales, problemas: cap.problemas, capturadoAt: ahora, comprobadoAt: ahora };
          informe.dns = Object.keys(cap.normales).length ? `capturado:${Object.keys(cap.normales).join(",")}` : `sin-capturar:${cap.problemas.join(" | ")}`;
        }
      } else if (decision.cambia || estado.dns.comprobadoAt === null || ahora - estado.dns.comprobadoAt > TREINTA_MIN) {
        const cambios = await aplicar(driver, estado.dns.normales, decision.dentro);
        estado.dns.comprobadoAt = ahora;
        estado.dns.ultimo = cambios;
        if (cambios.some((x) => x.cambiado)) estado.dns.ultimoCambioAt = ahora;
        informe.dns = cambios.map((x) => `${x.nombre}:${x.cambiado ? (decision.dentro ? "→liga" : "→normal") : "ok"}`).join(",");
      } else informe.dns = "sin-comprobar";
    } catch (e) {
      informe.dns = `error:${String(e)}`;
      estado.dns.ultimo = String(e);
      ctx.log.error("modo-liga: DNS", String(e));
    }
  }

  // 5. Espejo: contenido pendiente, reconstrucción nocturna y certificado
  const espejo = driverEspejoDe(c);
  if (espejo) {
    const sucio = await ctx.kv.get<Sucio>(CLAVE_SUCIO);
    const dia = diaUTC(ahora);
    const mes = dia.slice(0, 7);
    const hora = new Date(ahora).getUTCHours();
    let tarea: Tarea | null = null;
    let porque = "";
    if (c.diaCert !== null && new Date(ahora).getUTCDate() === c.diaCert && estado.espejo.certMes !== mes) {
      tarea = "cert";
      porque = "certificado-mensual";
    } else if (sucio && ahora - sucio.desde >= c.debounceMs) {
      tarea = "crawl";
      porque = `contenido:${sucio.cambios}`;
    } else if (c.horaNocturnaUTC !== null && hora === c.horaNocturnaUTC && estado.espejo.nocturnaDia !== dia) {
      tarea = "crawl";
      porque = "nocturna";
    }
    if (tarea) {
      try {
        const r = await espejo.reconstruir(tarea, fetchFn, ahora);
        estado.espejo.ultima = { ...r, at: ahora };
        if (r.ok) {
          if (tarea === "cert") estado.espejo.certMes = mes;
          else {
            estado.espejo.nocturnaDia = dia;
            if (porque.startsWith("contenido")) await ctx.kv.delete(CLAVE_SUCIO);
          }
        }
        informe.espejo = `${tarea}:${porque}:${r.ok ? "ok" : r.detalle}`;
      } catch (e) {
        informe.espejo = `${tarea}:error:${String(e)}`;
      }
    }
  }

  estado.ultimoTick = { at: ahora, resumen: `${informe.dentro ? "liga" : "normal"} (${informe.motivo})` };
  if (JSON.stringify(estado) !== JSON.stringify(antes)) await guardarEstado(ctx.kv, estado);
  ctx.log.info("modo-liga", informe);
  return informe;
}
