import { test } from "node:test";
import assert from "node:assert/strict";
import { EMISOR_CRAWL, EMISOR_NETLIFY, datosFirmaCrawl, emitirJws, verificarJws } from "../src/core/firma.ts";

const AHORA = Date.parse("2026-11-08T20:00:00Z");
const netlify = { iss: EMISOR_NETLIFY, exp: AHORA / 1000 + 60, deploy_context: "production", netlify_id: "x", site_url: "https://espejo.netlify.app" };

test("verificarJws: acepta Netlify y crawler; rechaza clave, caducidad, emisor, alg y basura", async () => {
  const ok = await emitirJws(netlify, "secreto");
  assert.equal((await verificarJws(ok, "secreto", { ahora: AHORA }))?.site_url, "https://espejo.netlify.app");
  assert.equal(await verificarJws(ok, "otro", { ahora: AHORA }), null);
  assert.equal(await verificarJws(await emitirJws({ ...netlify, exp: AHORA / 1000 - 1 }, "secreto"), "secreto", { ahora: AHORA }), null);
  assert.equal(await verificarJws(await emitirJws({ ...netlify, iss: "otro" }, "secreto"), "secreto", { ahora: AHORA }), null);
  assert.equal(await verificarJws(ok, undefined, { ahora: AHORA }), null);
  assert.equal(await verificarJws(null, "secreto"), null);
  assert.equal(await verificarJws("a.b", "secreto"), null);
  assert.equal(await verificarJws("basura.basura.basura", "secreto"), null);
  // alg none con la firma vacía
  const [cab, cuerpo] = ok.split(".");
  const none = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  assert.equal(await verificarJws(`${none}.${cuerpo}.`, "secreto", { ahora: AHORA }), null);
  assert.ok(cab);
});

test("verificarJws: site_url del espejo y lista de emisores", async () => {
  const ok = await emitirJws(netlify, "secreto");
  assert.ok(await verificarJws(ok, "secreto", { ahora: AHORA, siteUrlEspejo: "https://espejo.netlify.app" }));
  assert.equal(await verificarJws(ok, "secreto", { ahora: AHORA, siteUrlEspejo: "https://otro.netlify.app" }), null);
  assert.equal(await verificarJws(ok, "secreto", { ahora: AHORA, emisores: [EMISOR_CRAWL] }), null);
  const crawl = await emitirJws(datosFirmaCrawl(AHORA), "secreto");
  const datos = await verificarJws(crawl, "secreto", { ahora: AHORA + 599_000, siteUrlEspejo: "https://espejo.netlify.app" });
  assert.equal(datos?.iss, EMISOR_CRAWL);
  assert.equal(await verificarJws(crawl, "secreto", { ahora: AHORA + 600_000 }), null);
});
