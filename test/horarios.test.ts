import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DIAS_HORIZONTE, descartarAntiguos, fuenteEspn, fuenteFootballData, fuenteManual, fusionarPartidos, iniciosDe, leerDia, partidosDeEspn, partidosDeFootballData, siguienteLectura, urlEspn, urlFootballData, type Partido } from "../src/core/horarios/index.ts";

const t = (iso: string) => Date.parse(iso);
const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));

test("ESPN: parsea un día real de Primera (5 partidos, UTC) y un día vacío", () => {
  const p = partidosDeEspn(fixture("espn-esp1-2026-11-08.json"), "esp.1");
  assert.equal(p.length, 5);
  assert.deepEqual(p.map((x) => new Date(x.inicio).toISOString()), ["2026-11-08T13:00:00.000Z", "2026-11-08T15:15:00.000Z", "2026-11-08T17:30:00.000Z", "2026-11-08T17:30:00.000Z", "2026-11-08T20:00:00.000Z"]);
  assert.equal(p[0]!.estado, "en-juego");
  assert.equal(p[1]!.estado, "pendiente");
  assert.ok(p[4]!.nombre?.includes("Barcelona"));
  assert.ok(p.every((x) => x.fuente === "espn" && x.competicion === "esp.1"));
  assert.deepEqual(partidosDeEspn(fixture("espn-esp1-2026-11-09-vacio.json"), "esp.1"), []);
  assert.equal(urlEspn("esp.2", "2026-11-08"), "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.2/scoreboard?dates=20261108");
});

test("ESPN: descarta aplazados y fechas inválidas; la fuente lee varias ligas", async () => {
  const json = { events: [
    { date: "2026-11-08T20:00Z", status: { type: { state: "pre", name: "STATUS_POSTPONED" } } },
    { date: "basura", status: { type: { state: "pre" } } },
    { date: "2026-11-08T18:00Z", status: { type: { state: "post", name: "STATUS_FULL_TIME" } }, name: "A at B" },
  ] };
  assert.deepEqual(partidosDeEspn(json, "esp.1").map((p) => p.estado), ["terminado"]);
  const pedidas: string[] = [];
  const fetchFalso = (async (u: string) => { pedidas.push(u); return Response.json(json); }) as unknown as typeof fetch;
  const p = await fuenteEspn(["esp.1", "esp.2"]).leerDia("2026-11-08", fetchFalso);
  assert.equal(p.length, 2);
  assert.deepEqual(pedidas.map((u) => new URL(u).pathname.split("/")[6]), ["esp.1", "esp.2"]);
  const falla = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(fuenteEspn(["esp.1"]).leerDia("2026-11-08", falla), /ESPN esp.1 2026-11-08: 503/);
});

test("football-data: estados, aplazados, URL de un día y cabecera de autenticación", async () => {
  const json = { matches: [
    { utcDate: "2026-11-08T20:00:00Z", status: "TIMED", homeTeam: { name: "Atlético" }, awayTeam: { name: "Barcelona" } },
    { utcDate: "2026-11-08T13:00:00Z", status: "IN_PLAY" },
    { utcDate: "2026-11-08T15:15:00Z", status: "FINISHED" },
    { utcDate: "2026-11-08T17:30:00Z", status: "POSTPONED" },
    { status: "TIMED" },
  ] };
  const p = partidosDeFootballData(json, "PD");
  assert.deepEqual(p.map((x) => x.estado), ["pendiente", "en-juego", "terminado"]);
  assert.equal(p[0]!.nombre, "Atlético - Barcelona");
  assert.equal(urlFootballData("PD", "2026-11-08"), "https://api.football-data.org/v4/competitions/PD/matches?dateFrom=2026-11-08&dateTo=2026-11-08");
  let cabecera = "";
  const fetchFalso = (async (_u: string, init?: RequestInit) => { cabecera = new Headers(init?.headers).get("X-Auth-Token") ?? ""; return Response.json(json); }) as unknown as typeof fetch;
  await fuenteFootballData("tok", ["PD"]).leerDia("2026-11-08", fetchFalso);
  assert.equal(cabecera, "tok");
});

test("manual: solo los inicios del día pedido", async () => {
  const f = fuenteManual(["2026-11-08T20:00:00Z", t("2026-11-09T19:30:00Z"), "basura"]);
  assert.equal((await f.leerDia("2026-11-08", fetch)).length, 1);
  assert.equal((await f.leerDia("2026-11-09", fetch)).length, 1);
  assert.equal((await f.leerDia("2026-11-10", fetch)).length, 0);
});

test("siguienteLectura rota por el horizonte; leerDia tolera fuentes caídas; fusionar sustituye solo lo leído", async () => {
  const ahora = t("2026-11-08T14:00:00Z");
  assert.deepEqual(siguienteLectura(ahora, null), { dia: "2026-11-08", indice: 0 });
  assert.deepEqual(siguienteLectura(ahora, 0), { dia: "2026-11-09", indice: 1 });
  assert.deepEqual(siguienteLectura(ahora, DIAS_HORIZONTE - 1), { dia: "2026-11-08", indice: 0 });

  const ok = fuenteManual(["2026-11-08T20:00:00Z"]);
  const rota = { id: "rota", leerDia: async () => { throw new Error("caída"); } };
  const r = await leerDia([ok, rota], "2026-11-08", fetch);
  assert.deepEqual(r.fuentesOk, ["manual"]);
  assert.deepEqual(r.errores, ["rota: caída"]);
  assert.equal(r.partidos.length, 1);

  const viejo: Partido = { inicio: t("2026-11-08T13:00:00Z"), competicion: "esp.1", fuente: "espn", estado: "pendiente" };
  const otroDia: Partido = { inicio: t("2026-11-09T19:30:00Z"), competicion: "esp.2", fuente: "espn", estado: "pendiente" };
  const otraFuente: Partido = { inicio: t("2026-11-08T13:00:00Z"), competicion: "PD", fuente: "football-data", estado: "pendiente" };
  const nuevo: Partido = { inicio: t("2026-11-08T13:30:00Z"), competicion: "esp.1", fuente: "espn", estado: "pendiente" };
  const fusion = fusionarPartidos([viejo, otroDia, otraFuente], [nuevo, nuevo], "2026-11-08", ["espn"]);
  assert.deepEqual(fusion.map((p) => `${p.fuente}:${new Date(p.inicio).toISOString().slice(11, 16)}`), ["football-data:13:00", "espn:13:30", "espn:19:30"]);
  assert.deepEqual(iniciosDe([viejo, otraFuente, nuevo]), [t("2026-11-08T13:00:00Z"), t("2026-11-08T13:30:00Z")]);
  assert.equal(descartarAntiguos([viejo, otroDia], t("2026-11-09T10:00:00Z")).length, 1);
});
