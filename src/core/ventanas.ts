// Ventanas del modo liga: cada partido abre una ventana desde `antesMs` antes del
// inicio hasta `despuesMs` después del inicio. Las que se solapan o se tocan se
// unen. Instantes en ms desde epoch (UTC). Módulo puro.

export interface Ventana {
  inicio: number;
  fin: number;
}

export interface Margenes {
  /** Antelación respecto al inicio del partido. */
  antesMs: number;
  /** Duración desde el inicio del partido (partido + cola del bloqueo). */
  despuesMs: number;
}

/** Medido en hayahora.futbol (nov 2026): bloqueo de −10 min a +3 h 20 desde el inicio en el peor caso. */
export const MARGENES_POR_DEFECTO: Margenes = { antesMs: 30 * 60_000, despuesMs: 210 * 60_000 };

export function ventanasDe(inicios: number[], margenes: Margenes = MARGENES_POR_DEFECTO): Ventana[] {
  return unirVentanas(
    inicios.filter(Number.isFinite).map((i) => ({ inicio: i - margenes.antesMs, fin: i + margenes.despuesMs })),
  );
}

/** Ordena y une las ventanas que se solapan o se tocan. */
export function unirVentanas(ventanas: Ventana[]): Ventana[] {
  const unidas: Ventana[] = [];
  for (const v of [...ventanas].sort((a, b) => a.inicio - b.inicio)) {
    const ultima = unidas.at(-1);
    if (ultima && v.inicio <= ultima.fin) ultima.fin = Math.max(ultima.fin, v.fin);
    else unidas.push({ ...v });
  }
  return unidas;
}

/** El inicio cuenta como dentro; el fin, ya no. */
export function dentroDeVentana(ventanas: Ventana[], ahora: number): boolean {
  return ventanaActual(ventanas, ahora) !== null;
}

export function ventanaActual(ventanas: Ventana[], ahora: number): Ventana | null {
  return ventanas.find((v) => ahora >= v.inicio && ahora < v.fin) ?? null;
}

export function proximaVentana(ventanas: Ventana[], ahora: number): Ventana | null {
  return [...ventanas].sort((a, b) => a.inicio - b.inicio).find((v) => v.inicio > ahora) ?? null;
}

/** Último partido que ya ha empezado (para saber si estamos en la cola de una ventana). */
export function ultimoInicioAntes(inicios: number[], ahora: number): number | null {
  const pasados = inicios.filter((i) => Number.isFinite(i) && i <= ahora);
  return pasados.length ? Math.max(...pasados) : null;
}

export function ventanasVigentes(ventanas: Ventana[], ahora: number): Ventana[] {
  return ventanas.filter((v) => v.fin > ahora);
}
