// Fuentes de horarios: cada una lee los partidos de un día (YYYY-MM-DD, UTC).
// `fetch` llega por parámetro para probarlas sin red.

export type EstadoPartido = "pendiente" | "en-juego" | "terminado";

export interface Partido {
  /** Inicio en ms desde epoch (UTC). */
  inicio: number;
  /** Identificador de la competición en la fuente (p. ej. "esp.1" o "PD"). */
  competicion: string;
  /** Identificador de la fuente que lo leyó (p. ej. "espn"). */
  fuente: string;
  nombre?: string;
  estado: EstadoPartido;
}

export interface FuenteHorarios {
  id: string;
  /** Partidos del día `dia` (YYYY-MM-DD en UTC). Lanza si la fuente falla. */
  leerDia(dia: string, fetchFn: typeof fetch): Promise<Partido[]>;
}

export function diaUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
