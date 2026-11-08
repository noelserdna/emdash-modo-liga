// Fuente manual: una lista de inicios (ISO 8601 o ms) escrita por el dueño.
import { diaUTC, type FuenteHorarios, type Partido } from "./tipos.ts";

export function fuenteManual(inicios: (string | number)[]): FuenteHorarios {
  const ms = inicios.map((i) => (typeof i === "number" ? i : Date.parse(i))).filter(Number.isFinite);
  return {
    id: "manual",
    async leerDia(dia) {
      return ms
        .filter((i) => diaUTC(i) === dia)
        .map((inicio): Partido => ({ inicio, competicion: "manual", fuente: "manual", estado: "pendiente" }));
    },
  };
}
