import { test } from "node:test";
import assert from "node:assert/strict";
import { MARGENES_POR_DEFECTO, dentroDeVentana, proximaVentana, ultimoInicioAntes, unirVentanas, ventanaActual, ventanasDe, ventanasVigentes } from "../src/core/ventanas.ts";

const t = (iso: string) => Date.parse(iso);
const MIN = 60_000;

test("ventanasDe: márgenes por defecto −30 min / +210 min desde el inicio", () => {
  const inicio = t("2026-11-08T20:00:00Z");
  assert.deepEqual(ventanasDe([inicio]), [{ inicio: inicio - 30 * MIN, fin: inicio + 210 * MIN }]);
  assert.deepEqual(MARGENES_POR_DEFECTO, { antesMs: 30 * MIN, despuesMs: 210 * MIN });
  assert.deepEqual(ventanasDe([inicio], { antesMs: MIN, despuesMs: 2 * MIN }), [{ inicio: inicio - MIN, fin: inicio + 2 * MIN }]);
  assert.deepEqual(ventanasDe([NaN]), []);
});

test("unirVentanas: une las que se solapan o se tocan, ordena y deja separadas las demás", () => {
  const v = ventanasDe([t("2026-11-08T20:00:00Z"), t("2026-11-08T13:00:00Z"), t("2026-11-08T15:15:00Z"), t("2026-11-08T17:30:00Z"), t("2026-11-10T19:30:00Z")]);
  assert.deepEqual(v, [
    { inicio: t("2026-11-08T12:30:00Z"), fin: t("2026-11-08T23:30:00Z") },
    { inicio: t("2026-11-10T19:00:00Z"), fin: t("2026-11-10T23:00:00Z") },
  ]);
  assert.equal(unirVentanas([{ inicio: 0, fin: 10 }, { inicio: 10, fin: 20 }]).length, 1);
  assert.equal(unirVentanas([{ inicio: 0, fin: 10 }, { inicio: 11, fin: 20 }]).length, 2);
});

test("dentroDeVentana / ventanaActual / proximaVentana: inicio incluido, fin excluido", () => {
  const v = ventanasDe([t("2026-11-08T20:00:00Z")]);
  assert.ok(dentroDeVentana(v, t("2026-11-08T19:30:00Z")));
  assert.ok(dentroDeVentana(v, t("2026-11-08T23:29:59Z")));
  assert.ok(!dentroDeVentana(v, t("2026-11-08T23:30:00Z")));
  assert.ok(!dentroDeVentana(v, t("2026-11-08T19:29:59Z")));
  assert.equal(ventanaActual(v, t("2026-11-08T21:00:00Z")), v[0]);
  assert.equal(ventanaActual(v, t("2026-11-09T00:00:00Z")), null);
  assert.equal(proximaVentana(v, t("2026-11-08T10:00:00Z")), v[0]);
  assert.equal(proximaVentana(v, t("2026-11-08T19:30:00Z")), null);
});

test("ultimoInicioAntes y ventanasVigentes", () => {
  const inicios = [t("2026-11-08T13:00:00Z"), t("2026-11-08T20:00:00Z")];
  assert.equal(ultimoInicioAntes(inicios, t("2026-11-08T21:00:00Z")), inicios[1]);
  assert.equal(ultimoInicioAntes(inicios, t("2026-11-08T14:00:00Z")), inicios[0]);
  assert.equal(ultimoInicioAntes(inicios, t("2026-11-08T12:00:00Z")), null);
  assert.equal(ventanasVigentes(ventanasDe(inicios), t("2026-11-08T23:30:00Z")).length, 0);
  assert.equal(ventanasVigentes(ventanasDe(inicios), t("2026-11-08T12:00:00Z")).length, 2);
  assert.equal(ventanasVigentes(ventanasDe(inicios), t("2026-11-08T17:00:00Z")).length, 1);
});
