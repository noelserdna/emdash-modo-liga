import { test } from "node:test";
import assert from "node:assert/strict";
import { TTL_LIGA, aplicar, capturarNormales, comprobar, deseado, driverCloudflare, esNormalValido, igual, type DriverDns, type RegistroDns } from "../src/core/dns.ts";

function driverFalso(inicial: RegistroDns[]) {
  const registros = inicial.map((r) => ({ ...r }));
  const cambios: { id: string; cambios: object }[] = [];
  const driver: DriverDns = {
    async leer(nombre) { return registros.filter((r) => r.name === nombre); },
    async actualizar(id, c) { cambios.push({ id, cambios: c }); Object.assign(registros.find((r) => r.id === id)!, c); },
  };
  return { driver, registros, cambios };
}

const cname = (name: string, extra: Partial<RegistroDns> = {}): RegistroDns => ({ id: `id-${name}`, name, type: "CNAME", content: "sitio.netlify.app", proxied: true, ttl: 1, ...extra });

test("deseado e igual: solo cambian proxied y ttl; con proxy el ttl no cuenta", () => {
  const normal = { type: "CNAME", content: "sitio.netlify.app", proxied: true, ttl: 1 };
  assert.deepEqual(deseado(normal, true), { type: "CNAME", content: "sitio.netlify.app", proxied: false, ttl: TTL_LIGA });
  assert.deepEqual(deseado(normal, false), normal);
  assert.ok(igual({ ...normal, ttl: 300 }, normal));
  assert.ok(!igual({ ...normal, proxied: false }, normal));
  assert.ok(igual({ ...normal, content: "SITIO.netlify.app" }, normal));
  assert.ok(esNormalValido(normal) && !esNormalValido({ ...normal, proxied: false }) && !esNormalValido({ ...normal, type: "TXT" }));
});

test("capturarNormales: solo registros únicos y con proxy; lo demás se reporta", async () => {
  const { driver } = driverFalso([cname("ejemplo.es"), cname("www.ejemplo.es", { proxied: false, ttl: 60 }), { ...cname("doble.ejemplo.es"), id: "x" }, cname("doble.ejemplo.es")]);
  const { normales, problemas } = await capturarNormales(driver, ["ejemplo.es", "www.ejemplo.es", "doble.ejemplo.es", "nada.ejemplo.es"]);
  assert.deepEqual(Object.keys(normales), ["ejemplo.es"]);
  assert.equal(problemas.length, 3);
  assert.match(problemas[0]!, /www.ejemplo.es: el registro no está detrás del proxy/);
});

test("aplicar: pasa a DNS only y vuelve; idempotente; nunca toca el contenido", async () => {
  const { driver, registros, cambios } = driverFalso([cname("ejemplo.es"), cname("www.ejemplo.es")]);
  const { normales } = await capturarNormales(driver, ["ejemplo.es", "www.ejemplo.es"]);
  const r1 = await aplicar(driver, normales, true);
  assert.deepEqual(r1.map((c) => c.cambiado), [true, true]);
  assert.deepEqual(cambios[0]!.cambios, { proxied: false, ttl: 60 });
  assert.ok(registros.every((r) => r.content === "sitio.netlify.app" && r.proxied === false && r.ttl === 60));
  assert.ok(await comprobar(driver, normales, true));
  const r2 = await aplicar(driver, normales, true);
  assert.deepEqual(r2.map((c) => c.cambiado), [false, false]);
  assert.equal(cambios.length, 2);
  await aplicar(driver, normales, false);
  assert.ok(registros.every((r) => r.proxied === true));
  assert.ok(await comprobar(driver, normales, false));
  assert.equal(cambios.length, 4);
});

test("aplicar: si el registro ha desaparecido o hay varios, falla sin tocar nada", async () => {
  const { driver, cambios } = driverFalso([]);
  await assert.rejects(aplicar(driver, { "ejemplo.es": { type: "CNAME", content: "x", proxied: true, ttl: 1 } }, true), /se esperaba un registro CNAME y hay 0/);
  assert.equal(cambios.length, 0);
});

test("driverCloudflare: URLs, token y PATCH; errores de la API", async () => {
  const llamadas: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFalso = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    if (url.includes("/dns_records/id-1")) return Response.json({ success: true, result: {} });
    if (url.includes("zona-mala")) return Response.json({ success: false, errors: [{ message: "Invalid zone" }] }, { status: 403 });
    return Response.json({ success: true, result: [{ id: "id-1", name: "ejemplo.es", type: "CNAME", content: "s.netlify.app", proxied: true, ttl: 1, extra: 1 }] });
  }) as unknown as typeof fetch;
  const d = driverCloudflare("zona", "tok", fetchFalso);
  const r = await d.leer("ejemplo.es");
  assert.deepEqual(r, [{ id: "id-1", name: "ejemplo.es", type: "CNAME", content: "s.netlify.app", proxied: true, ttl: 1 }]);
  assert.equal(llamadas[0]!.url, "https://api.cloudflare.com/client/v4/zones/zona/dns_records?name=ejemplo.es");
  assert.equal(new Headers(llamadas[0]!.init?.headers).get("Authorization"), "Bearer tok");
  await d.actualizar("id-1", { proxied: false, ttl: 60 });
  assert.equal(llamadas[1]!.init?.method, "PATCH");
  assert.equal(llamadas[1]!.init?.body, JSON.stringify({ proxied: false, ttl: 60 }));
  await assert.rejects(driverCloudflare("zona-mala", "tok", fetchFalso).leer("x"), /API de Cloudflare .*403 Invalid zone/);
});

// ── Alta del registro normal (CLI `dns`) ─────────────────────────────────────

import { describirAccion, establecerNormales, planificarNormal, zonaPorNombre, type DriverDnsCompleto } from "../src/core/dns.ts";

function driverFalsoCompleto(inicial: RegistroDns[]) {
  const registros = inicial.map((r) => ({ ...r }));
  const llamadas: string[] = [];
  let n = 0;
  const driver: DriverDnsCompleto = {
    async leer(nombre) { return registros.filter((r) => r.name === nombre); },
    async actualizar(id, c) { llamadas.push(`actualizar ${id} ${JSON.stringify(c)}`); Object.assign(registros.find((r) => r.id === id)!, c); },
    async crear(nombre, e) { llamadas.push(`crear ${nombre} ${e.type} ${e.content} ${e.proxied}`); registros.push({ id: `nuevo-${++n}`, name: nombre, ...e }); },
    async borrar(id) { llamadas.push(`borrar ${id}`); registros.splice(registros.findIndex((r) => r.id === id), 1); },
  };
  return { driver, registros, llamadas };
}

test("planificarNormal: nada, actualizar, crear, conflicto y reemplazar", () => {
  const espejo = "sitio.netlify.app";
  assert.equal(planificarNormal("ejemplo.es", [cname("ejemplo.es")], espejo).accion, "nada");
  assert.equal(planificarNormal("ejemplo.es", [cname("ejemplo.es", { content: "SITIO.netlify.app" })], espejo).accion, "nada");
  const sinProxy = planificarNormal("ejemplo.es", [cname("ejemplo.es", { proxied: false, ttl: 60 })], espejo);
  assert.deepEqual(sinProxy.accion === "actualizar" && sinProxy.cambios, { proxied: true, ttl: 1 });
  assert.equal(planificarNormal("ejemplo.es", [], espejo).accion, "crear");
  assert.equal(planificarNormal("ejemplo.es", [{ ...cname("ejemplo.es"), type: "TXT", content: "v=spf1" }], espejo).accion, "crear");
  const otroCname = planificarNormal("ejemplo.es", [cname("ejemplo.es", { content: "viejo.netlify.app" })], espejo);
  assert.equal(otroCname.accion, "conflicto");
  assert.match(describirAccion(otroCname, espejo), /CONFLICTO, ya hay un CNAME a viejo.netlify.app/);
  const otroCnameForzado = planificarNormal("ejemplo.es", [cname("ejemplo.es", { content: "viejo.netlify.app" })], espejo, true);
  assert.deepEqual(otroCnameForzado.accion === "actualizar" && otroCnameForzado.cambios, { content: espejo, proxied: true, ttl: 1 });
  const registrosA: RegistroDns[] = [{ id: "a1", name: "ejemplo.es", type: "A", content: "1.2.3.4", proxied: true, ttl: 1 }, { id: "a2", name: "ejemplo.es", type: "AAAA", content: "::1", proxied: true, ttl: 1 }];
  assert.equal(planificarNormal("ejemplo.es", registrosA, espejo).accion, "conflicto");
  const reemplazo = planificarNormal("ejemplo.es", registrosA, espejo, true);
  assert.equal(reemplazo.accion, "reemplazar");
  assert.match(describirAccion(reemplazo, espejo), /borrar A 1.2.3.4, AAAA ::1 y crear CNAME/);
  // Solo cuentan los registros del propio nombre
  assert.equal(planificarNormal("www.ejemplo.es", [cname("ejemplo.es")], espejo).accion, "crear");
});

test("establecerNormales: simula sin tocar nada, no aplica con conflictos y ejecuta el plan completo", async () => {
  const espejo = "sitio.netlify.app";
  const { driver, registros, llamadas } = driverFalsoCompleto([cname("www.ejemplo.es", { proxied: false, ttl: 60 }), { id: "a1", name: "viejo.ejemplo.es", type: "A", content: "1.2.3.4", proxied: true, ttl: 1 }]);
  const simulado = await establecerNormales(driver, ["ejemplo.es", "www.ejemplo.es"], espejo);
  assert.deepEqual(simulado.plan.map((p) => p.accion), ["crear", "actualizar"]);
  assert.equal(simulado.aplicado, false);
  assert.equal(llamadas.length, 0);
  const conConflicto = await establecerNormales(driver, ["ejemplo.es", "viejo.ejemplo.es"], espejo, { aplicar: true });
  assert.deepEqual(conConflicto.plan.map((p) => p.accion), ["crear", "conflicto"]);
  assert.equal(conConflicto.aplicado, false);
  assert.equal(llamadas.length, 0, "con un conflicto no se crea ni el registro limpio");
  const aplicado = await establecerNormales(driver, ["ejemplo.es", "www.ejemplo.es", "viejo.ejemplo.es"], espejo, { aplicar: true, reemplazar: true });
  assert.equal(aplicado.aplicado, true);
  assert.deepEqual(llamadas, [
    "crear ejemplo.es CNAME sitio.netlify.app true",
    'actualizar id-www.ejemplo.es {"proxied":true,"ttl":1}',
    "borrar a1",
    "crear viejo.ejemplo.es CNAME sitio.netlify.app true",
  ]);
  assert.ok(registros.every((r) => r.type === "CNAME" && r.content === espejo && r.proxied));
  const otraVez = await establecerNormales(driver, ["ejemplo.es", "www.ejemplo.es", "viejo.ejemplo.es"], espejo, { aplicar: true });
  assert.ok(otraVez.plan.every((p) => p.accion === "nada"));
  assert.equal(llamadas.length, 4);
});

test("driverCloudflare crear/borrar y zonaPorNombre: URLs, métodos y errores", async () => {
  const llamadas: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFalso = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    if (url.endsWith("/zones?name=ejemplo.es&status=active")) return Response.json({ success: true, result: [{ id: "zona-1", name: "ejemplo.es" }] });
    if (url.endsWith("/zones?name=nadie.es&status=active")) return Response.json({ success: true, result: [] });
    if (url.includes("/zones?name=sinpermiso.es")) return Response.json({ success: false, errors: [{ message: "Unauthorized" }] }, { status: 403 });
    return Response.json({ success: true, result: { id: "r-1" } });
  }) as unknown as typeof fetch;
  assert.equal(await zonaPorNombre("ejemplo.es", "tok", fetchFalso), "zona-1");
  assert.equal(new Headers(llamadas[0]!.init?.headers).get("Authorization"), "Bearer tok");
  await assert.rejects(zonaPorNombre("nadie.es", "tok", fetchFalso), /No hay ninguna zona activa llamada nadie.es/);
  await assert.rejects(zonaPorNombre("sinpermiso.es", "tok", fetchFalso), /403 Unauthorized .*Zone → Zone → Read/);
  const d = driverCloudflare("zona-1", "tok", fetchFalso);
  await d.crear("ejemplo.es", { type: "CNAME", content: "s.netlify.app", proxied: true, ttl: 1 });
  const crear = llamadas.at(-1)!;
  assert.equal(crear.url, "https://api.cloudflare.com/client/v4/zones/zona-1/dns_records");
  assert.equal(crear.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(crear.init?.body)), { type: "CNAME", name: "ejemplo.es", content: "s.netlify.app", proxied: true, ttl: 1 });
  await d.borrar("r-1");
  assert.equal(llamadas.at(-1)!.url, "https://api.cloudflare.com/client/v4/zones/zona-1/dns_records/r-1");
  assert.equal(llamadas.at(-1)!.init?.method, "DELETE");
});
