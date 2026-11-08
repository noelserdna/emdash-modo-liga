import { test } from "node:test";
import assert from "node:assert/strict";
import { driverNetlifyBuildHook, driverWebhook } from "../src/core/espejo.ts";

test("build hook de Netlify: POST con título y cuerpo de texto", async () => {
  let pedido: { url: string; init: RequestInit | undefined } | null = null;
  const fetchFalso = (async (url: string, init?: RequestInit) => { pedido = { url, init }; return new Response("", { status: 200 }); }) as unknown as typeof fetch;
  const r = await driverNetlifyBuildHook("https://api.netlify.com/build_hooks/abc").reconstruir("cert", fetchFalso, Date.parse("2026-11-08T04:00:00Z"));
  assert.deepEqual(r, { ok: true, driver: "netlify-build-hook", tarea: "cert", detalle: "HTTP 200" });
  const u = new URL(pedido!.url);
  assert.equal(u.pathname, "/build_hooks/abc");
  assert.equal(u.searchParams.get("trigger_title"), "modo-liga: cert 2026-11-08T04:00:00.000Z");
  assert.equal(JSON.parse(String(pedido!.init?.body)).tarea, "cert");
});

test("webhook genérico: JSON con cabeceras extra y fallo HTTP reportado", async () => {
  const fetchFalso = (async (_u: string, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "token x");
    assert.equal(JSON.parse(String(init?.body)).evento, "modo-liga");
    return new Response("", { status: 500 });
  }) as unknown as typeof fetch;
  const r = await driverWebhook("https://api.github.com/repos/a/b/dispatches", { Authorization: "token x" }).reconstruir("crawl", fetchFalso, 0);
  assert.deepEqual([r.ok, r.detalle], [false, "HTTP 500"]);
});
