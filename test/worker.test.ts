import { test } from "node:test";
import assert from "node:assert/strict";
import { CABECERAS_RESERVADAS, CABECERA_FIRMA, CABECERA_FIRMA_CRAWL, MARCA, MARCA_ORIGEN, sinCabecerasReservadas, withModoLiga } from "../src/worker/index.ts";
import { EMISOR_NETLIFY, datosFirmaCrawl, emitirJws } from "../src/core/firma.ts";

const AHORA = Date.parse("2026-11-08T20:00:00Z");
const opciones = { origenHost: "origen.ejemplo.es", canonicalHost: "ejemplo.es", siteUrlEspejo: "https://espejo.netlify.app", ahora: () => AHORA };
const env = { MODO_LIGA_FIRMA: "secreto" };
const ctx = { waitUntil() {}, passThroughOnException() {} };

function manejadorEco() {
  const vistas: Request[] = [];
  return {
    vistas,
    manejador: { async fetch(request: Request) { vistas.push(request); return new Response(await request.text(), { status: 201, headers: { "x-eco": "1" } }); } },
  };
}

test("origen sin firma (o con secreto ausente): 404 y el manejador no se ejecuta", async () => {
  const { vistas, manejador } = manejadorEco();
  const w = withModoLiga(manejador, opciones);
  const r = await w.fetch(new Request("https://origen.ejemplo.es/_astro/x.css"), env, ctx);
  assert.equal(r.status, 404);
  const firma = await emitirJws({ iss: EMISOR_NETLIFY, exp: AHORA / 1000 + 60, site_url: "https://espejo.netlify.app" }, "secreto");
  const sinSecreto = await w.fetch(new Request("https://origen.ejemplo.es/", { headers: { [CABECERA_FIRMA]: firma } }), {}, ctx);
  assert.equal(sinSecreto.status, 404);
  assert.equal(vistas.length, 0);
});

test("origen con firma de Netlify: host canónico, marca espejo, IP real, firma borrada, respuesta marcada", async () => {
  const { vistas, manejador } = manejadorEco();
  const firma = await emitirJws({ iss: EMISOR_NETLIFY, exp: AHORA / 1000 + 60, site_url: "https://espejo.netlify.app" }, "secreto");
  const r = await withModoLiga(manejador, opciones).fetch(
    new Request("https://origen.ejemplo.es/_emdash/api/search?q=x", {
      method: "POST",
      headers: { [CABECERA_FIRMA]: firma, "x-nf-client-connection-ip": "203.0.113.7", Cookie: "s=1", "Content-Type": "application/json", [MARCA_ORIGEN]: "falsa" },
      body: '{"a":1}',
    }),
    env,
    ctx,
  );
  assert.equal(r.status, 201);
  assert.equal(r.headers.get(MARCA_ORIGEN), "1");
  assert.equal(r.headers.get("x-eco"), "1");
  assert.equal(await r.text(), '{"a":1}');
  const p = vistas[0]!;
  assert.equal(p.url, "https://ejemplo.es/_emdash/api/search?q=x");
  assert.equal(p.method, "POST");
  assert.equal(p.headers.get(MARCA), "espejo");
  assert.equal(p.headers.get(CABECERA_FIRMA), null);
  assert.equal(p.headers.get("x-nf-client-connection-ip"), null);
  assert.equal(p.headers.get("CF-Connecting-IP"), "203.0.113.7");
  assert.equal(p.headers.get("Cookie"), "s=1");
});

test("origen con firma del crawler (x-modo-liga-firma): marca crawl; firma con site_url ajeno: 404", async () => {
  const { vistas, manejador } = manejadorEco();
  const w = withModoLiga(manejador, opciones);
  const crawl = await emitirJws(datosFirmaCrawl(AHORA), "secreto");
  const r = await w.fetch(new Request("https://origen.ejemplo.es/articulos/", { headers: { [CABECERA_FIRMA_CRAWL]: crawl } }), env, ctx);
  assert.equal(r.status, 201);
  assert.equal(vistas[0]!.headers.get(MARCA), "crawl");
  const ajena = await emitirJws({ iss: EMISOR_NETLIFY, exp: AHORA / 1000 + 60, site_url: "https://otro.netlify.app" }, "secreto");
  assert.equal((await w.fetch(new Request("https://origen.ejemplo.es/", { headers: { [CABECERA_FIRMA]: ajena } }), env, ctx)).status, 404);
});

test("host canónico: las cabeceras reservadas se borran y lo demás pasa intacto", async () => {
  const { vistas, manejador } = manejadorEco();
  const peticion = new Request("https://ejemplo.es/articulos/", { headers: { [MARCA]: "espejo", "x-nf-client-connection-ip": "1.2.3.4", "x-propia": "sí" } });
  const r = await withModoLiga(manejador, opciones).fetch(peticion, env, ctx);
  assert.equal(r.status, 201);
  assert.equal(r.headers.get(MARCA_ORIGEN), null);
  for (const c of CABECERAS_RESERVADAS) assert.equal(vistas[0]!.headers.get(c), null);
  assert.equal(vistas[0]!.headers.get("x-propia"), "sí");
  const limpia = new Request("https://ejemplo.es/");
  assert.equal(sinCabecerasReservadas(limpia), limpia);
});
