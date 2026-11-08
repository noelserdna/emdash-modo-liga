// Lectura repartida: cada tick lee UN día del horizonte (hoy + 0..N-1) y
// sustituye en el estado los partidos de ese día que vinieron de las fuentes
// que respondieron. Así un tick cuesta pocas subrequests y los cambios de
// horario de LaLiga se recogen a diario.
import { diaUTC, type FuenteHorarios, type Partido } from "./tipos.ts";

export * from "./tipos.ts";
export * from "./espn.ts";
export * from "./football-data.ts";
export * from "./manual.ts";

export const DIAS_HORIZONTE = 8;
const DIA_MS = 86_400_000;

export interface LecturaPendiente {
  dia: string;
  indice: number;
}

/** Siguiente día del horizonte que toca leer, rotando desde el índice anterior. */
export function siguienteLectura(ahora: number, indiceAnterior: number | null, dias = DIAS_HORIZONTE): LecturaPendiente {
  const indice = indiceAnterior === null ? 0 : (indiceAnterior + 1) % dias;
  return { dia: diaUTC(ahora + indice * DIA_MS), indice };
}

export interface ResultadoLectura {
  partidos: Partido[];
  fuentesOk: string[];
  errores: string[];
}

export async function leerDia(fuentes: FuenteHorarios[], dia: string, fetchFn: typeof fetch): Promise<ResultadoLectura> {
  const partidos: Partido[] = [];
  const fuentesOk: string[] = [];
  const errores: string[] = [];
  for (const f of fuentes) {
    try {
      partidos.push(...(await f.leerDia(dia, fetchFn)));
      fuentesOk.push(f.id);
    } catch (e) {
      errores.push(`${f.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { partidos, fuentesOk, errores };
}

/** Sustituye los partidos de `dia` leídos por `fuentesOk`; conserva el resto. Sin duplicados. */
export function fusionarPartidos(existentes: Partido[], nuevos: Partido[], dia: string, fuentesOk: string[]): Partido[] {
  const conservados = existentes.filter((p) => !(diaUTC(p.inicio) === dia && fuentesOk.includes(p.fuente)));
  const clave = (p: Partido) => `${p.fuente}|${p.competicion}|${p.inicio}|${p.nombre ?? ""}`;
  const vistos = new Set(conservados.map(clave));
  const resultado = [...conservados];
  for (const p of nuevos) {
    const k = clave(p);
    if (vistos.has(k)) continue;
    vistos.add(k);
    resultado.push(p);
  }
  return resultado.sort((a, b) => a.inicio - b.inicio);
}

/** Inicios únicos (varias fuentes pueden dar el mismo partido). */
export function iniciosDe(partidos: Partido[]): number[] {
  return [...new Set(partidos.map((p) => p.inicio))].sort((a, b) => a - b);
}

export function descartarAntiguos(partidos: Partido[], ahora: number, margenMs = 12 * 3_600_000): Partido[] {
  return partidos.filter((p) => p.inicio > ahora - margenMs);
}
