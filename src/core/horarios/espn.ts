// ESPN (API no oficial, sin clave): un día por llamada, horas en UTC con "Z".
// Cubre Primera (esp.1) y Segunda (esp.2). Puede cambiar sin aviso: por eso se
// combina con otras fuentes y se usan márgenes amplios.
import type { FuenteHorarios, Partido } from "./tipos.ts";

export const LIGAS_ESPN: Record<string, string> = {
  "esp.1": "LaLiga EA Sports",
  "esp.2": "LaLiga Hypermotion",
  "esp.copa_del_rey": "Copa del Rey",
  "uefa.champions": "Champions League",
  "uefa.europa": "Europa League",
};

const API = "https://site.api.espn.com/apis/site/v2/sports/soccer";

interface RespuestaEspn {
  events?: {
    date?: string;
    name?: string;
    status?: { type?: { state?: string; name?: string } };
  }[];
}

export function urlEspn(liga: string, dia: string): string {
  return `${API}/${liga}/scoreboard?dates=${dia.replaceAll("-", "")}`;
}

const SUSPENDIDOS = new Set(["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_CANCELLED", "STATUS_SUSPENDED", "STATUS_ABANDONED"]);

export function partidosDeEspn(json: RespuestaEspn, liga: string): Partido[] {
  const partidos: Partido[] = [];
  for (const e of json.events ?? []) {
    if (!e.date) continue;
    const inicio = Date.parse(e.date);
    if (!Number.isFinite(inicio)) continue;
    const tipo = e.status?.type ?? {};
    if (tipo.name && SUSPENDIDOS.has(tipo.name)) continue;
    const estado = tipo.state === "in" ? "en-juego" : tipo.state === "post" ? "terminado" : "pendiente";
    partidos.push({ inicio, competicion: liga, fuente: "espn", estado, ...(e.name ? { nombre: e.name } : {}) });
  }
  return partidos;
}

export function fuenteEspn(ligas: string[] = ["esp.1", "esp.2"]): FuenteHorarios {
  return {
    id: "espn",
    async leerDia(dia, fetchFn) {
      const todos: Partido[] = [];
      for (const liga of ligas) {
        const r = await fetchFn(urlEspn(liga, dia), { headers: { accept: "application/json" } });
        if (!r.ok) throw new Error(`ESPN ${liga} ${dia}: ${r.status}`);
        todos.push(...partidosDeEspn((await r.json()) as RespuestaEspn, liga));
      }
      return todos;
    },
  };
}
