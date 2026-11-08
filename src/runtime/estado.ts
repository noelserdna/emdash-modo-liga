// Estado persistente del plugin en el KV de EmDash. Dos claves: `estado` (lo
// escribe solo el tick) y `sucio` (lo escriben los hooks de contenido).
import type { KVAccess } from "emdash";
import type { Partido } from "../core/horarios/index.ts";
import { ESTADO_INICIAL, type EstadoDecision, type Motivo } from "../core/decision.ts";
import type { Normales, CambioDns } from "../core/dns.ts";
import type { Deteccion } from "../core/deteccion.ts";
import type { ResultadoReconstruccion } from "../core/espejo.ts";

export const CLAVE_ESTADO = "estado";
export const CLAVE_SUCIO = "sucio";

export interface Estado {
  version: 1;
  partidos: Partido[];
  lectura: { indice: number | null; at: number | null; dia: string | null; errores: string[] };
  decision: EstadoDecision;
  motivo: Motivo;
  dns: {
    normales: Normales;
    problemas: string[];
    capturadoAt: number | null;
    comprobadoAt: number | null;
    ultimoCambioAt: number | null;
    ultimo: CambioDns[] | string | null;
  };
  ips: { propias: string[]; resueltoAt: number | null };
  deteccion: Deteccion | null;
  espejo: {
    ultima: (ResultadoReconstruccion & { at: number }) | null;
    nocturnaDia: string | null;
    certMes: string | null;
  };
  ultimoTick: { at: number; resumen: string } | null;
}

export interface Sucio {
  desde: number;
  cambios: number;
  ultimo: string | null;
}

export const ESTADO_VACIO: Estado = {
  version: 1,
  partidos: [],
  lectura: { indice: null, at: null, dia: null, errores: [] },
  decision: ESTADO_INICIAL,
  motivo: "ninguno",
  dns: { normales: {}, problemas: [], capturadoAt: null, comprobadoAt: null, ultimoCambioAt: null, ultimo: null },
  ips: { propias: [], resueltoAt: null },
  deteccion: null,
  espejo: { ultima: null, nocturnaDia: null, certMes: null },
  ultimoTick: null,
};

export async function leerEstado(kv: KVAccess): Promise<Estado> {
  const guardado = await kv.get<Partial<Estado>>(CLAVE_ESTADO);
  return guardado && guardado.version === 1 ? { ...ESTADO_VACIO, ...guardado } : structuredClone(ESTADO_VACIO);
}

export async function guardarEstado(kv: KVAccess, estado: Estado): Promise<void> {
  await kv.set(CLAVE_ESTADO, estado);
}

export async function marcarSucio(kv: KVAccess, ahora: number, descripcion: string | null): Promise<void> {
  const actual = await kv.get<Sucio>(CLAVE_SUCIO);
  await kv.set(CLAVE_SUCIO, { desde: actual?.desde ?? ahora, cambios: (actual?.cambios ?? 0) + 1, ultimo: descripcion });
}
