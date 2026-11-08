import { test } from "node:test";
import assert from "node:assert/strict";
import { ESTADO_INICIAL, decidir, type EstadoDecision } from "../src/core/decision.ts";
import { ventanasDe } from "../src/core/ventanas.ts";

const t = (iso: string) => Date.parse(iso);
const MIN = 60_000;
const inicios = [t("2026-11-08T20:00:00Z")];
const ventanas = ventanasDe(inicios); // 19:30 → 23:30
const base = { ventanas, inicios, forzado: "auto" as const, bloqueado: null, actual: ESTADO_INICIAL };

test("forzado manda sobre todo y no respeta la permanencia", () => {
  const dentro = decidir({ ...base, ahora: t("2026-11-08T10:00:00Z"), forzado: "on" });
  assert.deepEqual([dentro.dentro, dentro.motivo, dentro.cambia], [true, "forzado", true]);
  const fuera = decidir({ ...base, ahora: t("2026-11-08T21:00:00Z"), forzado: "off", actual: { ...ESTADO_INICIAL, dentro: true, desde: t("2026-11-08T20:55:00Z") } });
  assert.deepEqual([fuera.dentro, fuera.motivo], [false, "forzado"]);
});

test("política calendario: solo las ventanas", () => {
  const p = { politica: "calendario" as const };
  assert.deepEqual(decidir({ ...base, ahora: t("2026-11-08T19:30:00Z"), parametros: p }).motivo, "calendario");
  assert.deepEqual(decidir({ ...base, ahora: t("2026-11-08T19:29:00Z"), parametros: p }).dentro, false);
  // la detección no influye
  assert.equal(decidir({ ...base, ahora: t("2026-11-08T10:00:00Z"), bloqueado: true, parametros: p }).dentro, false);
});

test("política ambas: el calendario entra, la detección recorta la cola", () => {
  // Dentro de la ventana, sin datos de detección: calendario
  let estado: EstadoDecision = { dentro: true, desde: t("2026-11-08T19:30:00Z"), ticksPositivos: 0, ticksLimpios: 0 };
  let d = decidir({ ...base, ahora: t("2026-11-08T21:00:00Z"), actual: estado });
  assert.deepEqual([d.dentro, d.motivo], [true, "calendario"]);
  // En la cola (desde las 22:00) con 1 tick limpio: todavía calendario
  d = decidir({ ...base, ahora: t("2026-11-08T22:30:00Z"), bloqueado: false, actual: estado });
  assert.deepEqual([d.dentro, d.motivo, d.estado.ticksLimpios], [true, "calendario", 1]);
  // Segundo tick limpio: cola recortada → fuera
  d = decidir({ ...base, ahora: t("2026-11-08T22:35:00Z"), bloqueado: false, actual: d.estado });
  assert.deepEqual([d.dentro, d.motivo, d.cambia], [false, "cola-recortada", true]);
  assert.equal(d.estado.desde, t("2026-11-08T22:35:00Z"));
  // Antes de la cola (21:30) los ticks limpios no recortan
  estado = { dentro: true, desde: t("2026-11-08T19:30:00Z"), ticksPositivos: 0, ticksLimpios: 5 };
  d = decidir({ ...base, ahora: t("2026-11-08T21:30:00Z"), bloqueado: false, actual: estado });
  assert.deepEqual([d.dentro, d.motivo], [true, "calendario"]);
});

test("política ambas: fuera de calendario la detección entra con 1 tick y sale con 3 limpios", () => {
  const martes = t("2026-11-10T21:00:00Z");
  let d = decidir({ ...base, ahora: martes, bloqueado: true, actual: { ...ESTADO_INICIAL, desde: martes - 60 * MIN } });
  assert.deepEqual([d.dentro, d.motivo, d.estado.ticksPositivos], [true, "deteccion", 1]);
  // 2 ticks limpios: sigue dentro (histéresis), pasada la permanencia
  d = decidir({ ...base, ahora: martes + 25 * MIN, bloqueado: false, actual: d.estado });
  d = decidir({ ...base, ahora: martes + 30 * MIN, bloqueado: false, actual: d.estado });
  assert.deepEqual([d.dentro, d.estado.ticksLimpios], [true, 2]);
  d = decidir({ ...base, ahora: martes + 35 * MIN, bloqueado: false, actual: d.estado });
  assert.deepEqual([d.dentro, d.motivo, d.cambia], [false, "ninguno", true]);
  // Sin datos de detección fuera de calendario: fuera
  assert.equal(decidir({ ...base, ahora: martes, bloqueado: null }).dentro, false);
});

test("permanencia: no se cambia de estado antes de 20 min desde el último cambio", () => {
  const martes = t("2026-11-10T21:00:00Z");
  const reciente: EstadoDecision = { dentro: true, desde: martes - 5 * MIN, ticksPositivos: 1, ticksLimpios: 0 };
  // 3 ticks limpios pero solo 5 min dentro: se mantiene
  let d = decidir({ ...base, ahora: martes, bloqueado: false, actual: { ...reciente, ticksLimpios: 2 } });
  assert.deepEqual([d.dentro, d.motivo, d.cambia], [true, "permanencia", false]);
  assert.equal(d.estado.desde, reciente.desde);
  // Pasados 20 min, sale
  d = decidir({ ...base, ahora: martes + 16 * MIN, bloqueado: false, actual: d.estado });
  assert.deepEqual([d.dentro, d.cambia], [false, true]);
  // El primer tick de la vida del plugin (desde 0) nunca queda retenido
  assert.equal(decidir({ ...base, ahora: t("2026-11-08T20:00:00Z") }).dentro, true);
});

test("política deteccion: sin datos conserva el estado; con datos sigue la histéresis", () => {
  const p = { politica: "deteccion" as const };
  const dentro: EstadoDecision = { dentro: true, desde: 1, ticksPositivos: 3, ticksLimpios: 0 };
  assert.deepEqual(decidir({ ...base, ahora: t("2026-11-08T21:00:00Z"), parametros: p, actual: dentro }).motivo, "sin-datos");
  assert.equal(decidir({ ...base, ahora: t("2026-11-08T21:00:00Z"), parametros: p, actual: dentro }).dentro, true);
  // dentro de la ventana de calendario pero la detección dice limpio 3 veces: fuera
  const d = decidir({ ...base, ahora: t("2026-11-08T21:00:00Z"), parametros: p, bloqueado: false, actual: { ...dentro, ticksLimpios: 2 } });
  assert.deepEqual([d.dentro, d.motivo], [false, "ninguno"]);
  // fuera de calendario, 1 positivo: dentro
  assert.equal(decidir({ ...base, ahora: t("2026-11-10T21:00:00Z"), parametros: p, bloqueado: true }).dentro, true);
});
