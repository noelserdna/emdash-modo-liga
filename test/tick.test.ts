import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ejecutarTick } from "../src/runtime/tick.ts";
import { CLAVE_ESTADO, CLAVE_SUCIO, marcarSucio, type Estado } from "../src/runtime/estado.ts";
import { estadoPublicoDe, etiquetaJson } from "../src/runtime/fragmentos.ts";
import { leerConfig } from "../src/runtime/config.ts";
import type { DriverDns, RegistroDns } from "../src/core/dns.ts";

const t = (iso: string) => Date.parse(iso);
const espn = readFileSync(new URL("./fixtures/espn-esp1-2026-11-08.json", import.meta.url), "utf8");

/** Contexto de plugin falso: kv y settings en memoria, log silencioso. */
function ctxFalso(settings: Record<string, unknown> = {}) {
  const kv = new Map<string, unknown>();
  const ajustes = new Map(Object.entries(settings));
  const logs: unknown[] = [];
  const almacen = (m: Map<string, unknown>) => ({
    async get<T>(k: string) { return (m.has(k) ? m.get(k) : null) as T | null; },
    async getVersioned() { throw new Error("no usado"); },
    async compareAndSet() { throw new Error("no usado"); },
    async compareAndDelete() { throw new Error("no usado"); },
    async set(k: string, v: unknown) { m.set(k, structuredClone(v)); },
    async delete(k: string) { return m.delete(k); },
    async list() { return [...m.entries()].map(([key, value]) => ({ key, value })); },
  });
  return {
    kv: almacen(kv) as never,
    settings: almacen(ajustes) as never,
    log: { debug() {}, info(m: string, d?: unknown) { logs.push([m, d]); }, warn(m: string, d?: unknown) { logs.push([m, d]); }, error(m: string, d?: unknown) { logs.push([m, d]); } },
    site: { name: "Ejemplo", url: "https://ejemplo.es", locale: "es" },
    _kv: kv,
    _logs: logs,
  };
}

function dnsFalso(registros: RegistroDns[]) {
  const cambios: { id: string; cambios: object }[] = [];
  const driver: DriverDns = {
    async leer(nombre) { return registros.filter((r) => r.name === nombre); },
    async actualizar(id, c) { cambios.push({ id, cambios: c }); Object.assign(registros.find((r) => r.id === id)!, c); },
  };
  return { driver, registros, cambios };
}

/** fetch falso: ESPN (día real), hayahora y build hook. */
function fetchFalso(bloqueadas: string[] = [], hooks: string[] = []) {
  const llamadas: string[] = [];
  const fn = (async (u: string, init?: RequestInit) => {
    llamadas.push(u);
    if (u.includes("site.api.espn.com")) return new Response(u.includes("dates=20261108") && u.includes("esp.1") ? espn : JSON.stringify({ events: [] }), { headers: { "content-type": "application/json" } });
    if (u.includes("hayahora.futbol")) return new Response(bloqueadas.join("\n"));
    if (u.includes("dns-query")) return Response.json({ Answer: new URL(u).searchParams.get("type") === "A" ? [{ type: 1, data: "188.114.96.5" }] : [] });
    if (u.includes("build_hooks")) { hooks.push(String(init?.body)); return new Response("", { status: 200 }); }
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, llamadas };
}

const registros = (): RegistroDns[] => [
  { id: "r1", name: "ejemplo.es", type: "CNAME", content: "sitio.netlify.app", proxied: true, ttl: 1 },
  { id: "r2", name: "www.ejemplo.es", type: "CNAME", content: "sitio.netlify.app", proxied: true, ttl: 1 },
];
const env = { MODO_LIGA_CF_TOKEN: "tok", MODO_LIGA_BUILD_HOOK: "https://api.netlify.com/build_hooks/abc" };

test("primer tick fuera de ventana: lee un día de ESPN, captura el DNS normal, resuelve IPs y no toca nada", async () => {
  const ctx = ctxFalso({ zonaId: "zona", competicionesEspn: "esp.1" });
  const dns = dnsFalso(registros());
  const f = fetchFalso();
  const ahora = t("2026-11-08T10:00:00Z");
  const informe = await ejecutarTick(ctx, {}, { fetchFn: f.fn, ahora, env, driverDns: dns.driver });
  assert.deepEqual([informe.dentro, informe.motivo, informe.ventanas], [false, "ninguno", 1]); // 13:00…20:00 encadenados → 1 ventana 12:30–23:30
  assert.equal(informe.proximaVentana, "2026-11-08T12:30:00.000Z");
  assert.deepEqual(informe.horarios, { dia: "2026-11-08", partidos: 5, errores: [] });
  assert.equal(informe.dns, "capturado:ejemplo.es,www.ejemplo.es;ejemplo.es:ok,www.ejemplo.es:ok"); // captura y comprueba en el mismo tick
  assert.equal(informe.deteccion, "no-consultada"); // a más de 2 h
  assert.equal(dns.cambios.length, 0);
  const estado = ctx._kv.get(CLAVE_ESTADO) as Estado;
  assert.deepEqual(estado.ips.propias, ["188.114.96.5"]);
  assert.equal(estado.partidos.length, 5);
  assert.equal(Object.keys(estado.dns.normales).length, 2);
  // Subrequests: 1 ESPN + 2 DoH (+ DNS por el driver falso, fuera de fetch)
  assert.equal(f.llamadas.length, 3);
});

test("primer tick dentro de la ventana con registros con proxy: captura el estado normal y pasa a DNS only en el mismo tick", async () => {
  const ctx = ctxFalso({ zonaId: "zona", competicionesEspn: "esp.1" });
  const dns = dnsFalso(registros());
  const informe = await ejecutarTick(ctx, {}, { fetchFn: fetchFalso(["188.114.96.5"]).fn, ahora: t("2026-11-08T14:00:00Z"), env, driverDns: dns.driver });
  assert.deepEqual([informe.dentro, informe.motivo], [true, "calendario"]);
  assert.equal(informe.dns, "capturado:ejemplo.es,www.ejemplo.es;ejemplo.es:→liga,www.ejemplo.es:→liga");
  assert.ok(dns.registros.every((r) => r.proxied === false && r.ttl === 60));
  const estado = ctx._kv.get(CLAVE_ESTADO) as Estado;
  assert.equal(Object.keys(estado.dns.normales).length, 2);
  assert.equal(estado.dns.normales["ejemplo.es"]!.proxied, true, "lo capturado es el estado normal (con proxy), no el de liga");
  // Un registro que ya está en DNS only dentro de la ventana no se captura, se avisa y no se toca
  const ctx2 = ctxFalso({ zonaId: "zona", competicionesEspn: "esp.1" });
  const dns2 = dnsFalso([{ ...registros()[0]!, proxied: false, ttl: 60 }, registros()[1]!]);
  const informe2 = await ejecutarTick(ctx2, {}, { fetchFn: fetchFalso().fn, ahora: t("2026-11-08T14:00:00Z"), env, driverDns: dns2.driver });
  assert.equal(informe2.dns, "capturado:www.ejemplo.es;www.ejemplo.es:→liga");
  const estado2 = ctx2._kv.get(CLAVE_ESTADO) as Estado;
  assert.ok(estado2.dns.problemas.some((p) => /forzado=off/.test(p)));
  assert.deepEqual(dns2.cambios.map((c) => c.id), ["r2"]);
});

test("tick dentro de la ventana: pasa el DNS a DNS only; después, con la cola limpia, vuelve", async () => {
  const ctx = ctxFalso({ zonaId: "zona", competicionesEspn: "esp.1" });
  const dns = dnsFalso(registros());
  await ejecutarTick(ctx, {}, { fetchFn: fetchFalso().fn, ahora: t("2026-11-08T10:00:00Z"), env, driverDns: dns.driver });
  // 12:40, bloqueo detectado en nuestra IP
  let informe = await ejecutarTick(ctx, {}, { fetchFn: fetchFalso(["188.114.96.5"]).fn, ahora: t("2026-11-08T12:40:00Z"), env, driverDns: dns.driver });
  assert.deepEqual([informe.dentro, informe.motivo, informe.cambia], [true, "calendario", true]);
  assert.equal(informe.dns, "ejemplo.es:→liga,www.ejemplo.es:→liga");
  assert.ok(dns.registros.every((r) => r.proxied === false && r.ttl === 60 && r.content === "sitio.netlify.app"));
  // 13:00, sin cambios: no hay PATCH ni comprobación antes de 30 min
  informe = await ejecutarTick(ctx, {}, { fetchFn: fetchFalso(["188.114.96.5"]).fn, ahora: t("2026-11-08T13:00:00Z"), env, driverDns: dns.driver });
  assert.deepEqual([informe.dentro, informe.dns, dns.cambios.length], [true, "sin-comprobar", 2]);
  // 22:30 (cola del último partido de las 20:00) y hayahora limpio dos veces → vuelve a normal
  await ejecutarTick(ctx, {}, { fetchFn: fetchFalso([]).fn, ahora: t("2026-11-08T22:30:00Z"), env, driverDns: dns.driver });
  informe = await ejecutarTick(ctx, {}, { fetchFn: fetchFalso([]).fn, ahora: t("2026-11-08T22:35:00Z"), env, driverDns: dns.driver });
  assert.deepEqual([informe.dentro, informe.motivo], [false, "cola-recortada"]);
  assert.ok(dns.registros.every((r) => r.proxied === true));
});

test("forzado off impide el espejo aunque haya partido; sin token el DNS queda sin configurar", async () => {
  const ctx = ctxFalso({ zonaId: "zona", forzado: "off", competicionesEspn: "esp.1" });
  const dns = dnsFalso(registros());
  const informe = await ejecutarTick(ctx, {}, { fetchFn: fetchFalso(["188.114.96.5"]).fn, ahora: t("2026-11-08T14:00:00Z"), env, driverDns: dns.driver });
  assert.deepEqual([informe.dentro, informe.motivo], [false, "forzado"]);
  const sinToken = await ejecutarTick(ctxFalso(), {}, { fetchFn: fetchFalso().fn, ahora: t("2026-11-08T14:00:00Z"), env: {} });
  assert.equal(sinToken.dns, "sin-configurar");
  assert.equal(sinToken.dentro, true); // la decisión se toma igual, aunque no haya DNS que cambiar
});

test("contenido pendiente: tras el debounce dispara el build hook una sola vez y limpia la marca", async () => {
  const ctx = ctxFalso({ zonaId: "zona", competicionesEspn: "esp.1", horaNocturnaUTC: -1, diaCert: 0 });
  const hooks: string[] = [];
  await marcarSucio(ctx.kv, t("2026-11-08T10:00:00Z"), "publicado posts hola");
  await marcarSucio(ctx.kv, t("2026-11-08T10:05:00Z"), "publicado posts adios");
  let informe = await ejecutarTick(ctx, {}, { fetchFn: fetchFalso([], hooks).fn, ahora: t("2026-11-08T10:10:00Z"), env, driverDns: dnsFalso(registros()).driver });
  assert.equal(informe.espejo, undefined); // aún dentro del debounce de 15 min
  informe = await ejecutarTick(ctx, {}, { fetchFn: fetchFalso([], hooks).fn, ahora: t("2026-11-08T10:16:00Z"), env, driverDns: dnsFalso(registros()).driver });
  assert.equal(informe.espejo, "crawl:contenido:2:ok");
  assert.equal(hooks.length, 1);
  assert.equal(JSON.parse(hooks[0]!).tarea, "crawl");
  assert.equal(ctx._kv.has(CLAVE_SUCIO), false);
  informe = await ejecutarTick(ctx, {}, { fetchFn: fetchFalso([], hooks).fn, ahora: t("2026-11-08T10:21:00Z"), env, driverDns: dnsFalso(registros()).driver });
  assert.equal(informe.espejo, undefined);
});

test("reconstrucción nocturna y certificado mensual, una vez cada uno", async () => {
  const ctx = ctxFalso({ zonaId: "zona", competicionesEspn: "esp.1", horaNocturnaUTC: 4, diaCert: 1 });
  const hooks: string[] = [];
  const dep = (iso: string) => ({ fetchFn: fetchFalso([], hooks).fn, ahora: t(iso), env, driverDns: dnsFalso(registros()).driver });
  assert.equal((await ejecutarTick(ctx, {}, dep("2026-11-01T04:02:00Z"))).espejo, "cert:certificado-mensual:ok");
  assert.equal((await ejecutarTick(ctx, {}, dep("2026-11-01T04:07:00Z"))).espejo, "crawl:nocturna:ok");
  assert.equal((await ejecutarTick(ctx, {}, dep("2026-11-01T04:12:00Z"))).espejo, undefined);
  assert.equal((await ejecutarTick(ctx, {}, dep("2026-11-02T04:02:00Z"))).espejo, "crawl:nocturna:ok");
  assert.deepEqual(hooks.map((h) => JSON.parse(h).tarea), ["cert", "crawl", "crawl"]);
});

test("estado público y etiqueta JSON para el banner", async () => {
  const ctx = ctxFalso({ zonaId: "zona", competicionesEspn: "esp.1", rutaAviso: "/sin-acceso" });
  await ejecutarTick(ctx, {}, { fetchFn: fetchFalso().fn, ahora: t("2026-11-08T10:00:00Z"), env, driverDns: dnsFalso(registros()).driver });
  const c = await leerConfig(ctx, {}, env);
  const pub = estadoPublicoDe(ctx._kv.get(CLAVE_ESTADO) as Estado, c, t("2026-11-08T11:00:00Z"));
  assert.deepEqual([pub.activo, pub.espejo, pub.proxima, pub.sitio, pub.avisoUrl], [false, false, "2026-11-08T12:30:00.000Z", "ejemplo.es", "/sin-acceso"]);
  assert.ok(pub.x.startsWith("https://x.com/intent/post?text=") && decodeURIComponent(pub.x).includes("ejemplo.es"));
  assert.ok(pub.textos.espejo.includes("ejemplo.es"));
  const html = etiquetaJson({ ...pub, textos: { ...pub.textos, antes: "</script><b>" } });
  assert.ok(!html.includes("</script><b>"));
  assert.ok(html.startsWith('<script type="application/json" id="modo-liga-estado">'));
  assert.deepEqual(c.registros, ["ejemplo.es", "www.ejemplo.es"]);
});
