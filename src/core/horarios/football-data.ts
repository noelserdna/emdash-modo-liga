// football-data.org v4 (clave gratuita: PD y CL; Segunda y Copa son de pago).
import type { FuenteHorarios, Partido } from "./tipos.ts";

export const COMPETICIONES_FOOTBALL_DATA: Record<string, string> = {
  PD: "LaLiga EA Sports",
  SD: "LaLiga Hypermotion",
  CDR: "Copa del Rey",
  CL: "Champions League",
};

const API = "https://api.football-data.org/v4";

interface RespuestaFootballData {
  matches?: { utcDate?: string; status?: string; homeTeam?: { name?: string }; awayTeam?: { name?: string } }[];
}

export function urlFootballData(competicion: string, dia: string): string {
  return `${API}/competitions/${competicion}/matches?dateFrom=${dia}&dateTo=${dia}`;
}

const SUSPENDIDOS = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

export function partidosDeFootballData(json: RespuestaFootballData, competicion: string): Partido[] {
  const partidos: Partido[] = [];
  for (const m of json.matches ?? []) {
    if (!m.utcDate || !m.status || SUSPENDIDOS.has(m.status)) continue;
    const inicio = Date.parse(m.utcDate);
    if (!Number.isFinite(inicio)) continue;
    const estado = m.status === "IN_PLAY" || m.status === "PAUSED" ? "en-juego" : m.status === "FINISHED" || m.status === "AWARDED" ? "terminado" : "pendiente";
    const nombre = m.homeTeam?.name && m.awayTeam?.name ? `${m.homeTeam.name} - ${m.awayTeam.name}` : undefined;
    partidos.push({ inicio, competicion, fuente: "football-data", estado, ...(nombre ? { nombre } : {}) });
  }
  return partidos;
}

export function fuenteFootballData(token: string, competiciones: string[] = ["PD"]): FuenteHorarios {
  return {
    id: "football-data",
    async leerDia(dia, fetchFn) {
      const todos: Partido[] = [];
      for (const c of competiciones) {
        const r = await fetchFn(urlFootballData(c, dia), { headers: { "X-Auth-Token": token } });
        if (!r.ok) throw new Error(`football-data.org ${c} ${dia}: ${r.status} ${(await r.text()).slice(0, 120)}`);
        todos.push(...partidosDeFootballData((await r.json()) as RespuestaFootballData, c));
      }
      return todos;
    },
  };
}
