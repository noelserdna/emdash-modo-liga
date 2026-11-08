// Decide si el sitio debe estar en modo liga combinando calendario, detección y
// forzado manual, con histéresis para no oscilar (cada cambio de DNS cuesta
// hasta 5 min de propagación). Módulo puro y determinista.
import { dentroDeVentana, ultimoInicioAntes, type Ventana } from "./ventanas.ts";

export type Politica = "calendario" | "deteccion" | "ambas";
export type Forzado = "auto" | "on" | "off";
export type Motivo = "forzado" | "calendario" | "deteccion" | "cola-recortada" | "permanencia" | "sin-datos" | "ninguno";

export interface ParametrosDecision {
  politica: Politica;
  /** Desde el inicio del último partido: a partir de aquí la detección puede recortar la cola. */
  colaMs: number;
  ticksParaEntrar: number;
  ticksParaSalir: number;
  ticksColaLimpia: number;
  /** Tiempo mínimo en cada estado antes de cambiar (salvo forzado). */
  permanenciaMs: number;
}

export const PARAMETROS_POR_DEFECTO: ParametrosDecision = {
  politica: "ambas",
  colaMs: 2 * 3_600_000,
  ticksParaEntrar: 1,
  ticksParaSalir: 3,
  ticksColaLimpia: 2,
  permanenciaMs: 20 * 60_000,
};

export interface EstadoDecision {
  dentro: boolean;
  /** Instante del último cambio de estado. */
  desde: number;
  ticksPositivos: number;
  ticksLimpios: number;
}

export const ESTADO_INICIAL: EstadoDecision = { dentro: false, desde: 0, ticksPositivos: 0, ticksLimpios: 0 };

export interface EntradaDecision {
  ahora: number;
  ventanas: Ventana[];
  inicios: number[];
  forzado: Forzado;
  /** Resultado de la detección en este tick; null = sin dato (fuente caída o no consultada). */
  bloqueado: boolean | null;
  actual: EstadoDecision;
  parametros?: Partial<ParametrosDecision>;
}

export interface Decision {
  dentro: boolean;
  motivo: Motivo;
  cambia: boolean;
  estado: EstadoDecision;
}

export function decidir(e: EntradaDecision): Decision {
  const p = { ...PARAMETROS_POR_DEFECTO, ...e.parametros };
  const contadores = actualizarContadores(e.actual, e.bloqueado);
  const hayDeteccion = e.bloqueado !== null;

  let deseado: boolean;
  let motivo: Motivo;

  if (e.forzado !== "auto") {
    deseado = e.forzado === "on";
    motivo = "forzado";
    return cerrar(e, deseado, motivo, contadores);
  }

  const calendario = dentroDeVentana(e.ventanas, e.ahora);
  const ultimoInicio = ultimoInicioAntes(e.inicios, e.ahora);
  const enCola = calendario && ultimoInicio !== null && e.ahora >= ultimoInicio + p.colaMs;
  const colaLimpia = enCola && hayDeteccion && contadores.ticksLimpios >= p.ticksColaLimpia;
  const porDeteccion = hayDeteccion && (e.actual.dentro ? contadores.ticksLimpios < p.ticksParaSalir : contadores.ticksPositivos >= p.ticksParaEntrar);

  if (p.politica === "calendario") {
    deseado = calendario;
    motivo = calendario ? "calendario" : "ninguno";
  } else if (p.politica === "deteccion") {
    if (!hayDeteccion) return cerrar(e, e.actual.dentro, "sin-datos", contadores);
    deseado = porDeteccion;
    motivo = porDeteccion ? "deteccion" : "ninguno";
  } else {
    const porCalendario = calendario && !colaLimpia;
    // Si la cola ya está limpia, la histéresis de la detección no nos retiene
    const porDeteccionEfectiva = porDeteccion && !colaLimpia;
    deseado = porCalendario || porDeteccionEfectiva;
    motivo = porCalendario ? "calendario" : porDeteccionEfectiva ? "deteccion" : colaLimpia ? "cola-recortada" : "ninguno";
  }

  if (deseado !== e.actual.dentro && e.actual.desde > 0 && e.ahora - e.actual.desde < p.permanenciaMs) {
    return cerrar(e, e.actual.dentro, "permanencia", contadores);
  }
  return cerrar(e, deseado, motivo, contadores);
}

function actualizarContadores(actual: EstadoDecision, bloqueado: boolean | null): Pick<EstadoDecision, "ticksPositivos" | "ticksLimpios"> {
  if (bloqueado === true) return { ticksPositivos: actual.ticksPositivos + 1, ticksLimpios: 0 };
  if (bloqueado === false) return { ticksPositivos: 0, ticksLimpios: actual.ticksLimpios + 1 };
  return { ticksPositivos: actual.ticksPositivos, ticksLimpios: actual.ticksLimpios };
}

function cerrar(e: EntradaDecision, dentro: boolean, motivo: Motivo, contadores: Pick<EstadoDecision, "ticksPositivos" | "ticksLimpios">): Decision {
  const cambia = dentro !== e.actual.dentro;
  return {
    dentro,
    motivo,
    cambia,
    estado: { dentro, desde: cambia || e.actual.desde === 0 ? e.ahora : e.actual.desde, ...contadores },
  };
}
