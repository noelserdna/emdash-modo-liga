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
