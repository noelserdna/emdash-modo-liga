import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXTOS_POR_DEFECTO, TEXTO_X_POR_DEFECTO, cabeEnX, longitudEnX, rellenar, urlPublicarEnX } from "../src/core/aviso.ts";

test("rellenar sustituye {sitio} y {url} y deja lo desconocido", () => {
  assert.equal(rellenar("Hoy {sitio} ({url}) {otro}", { sitio: "ejemplo.es", url: "https://ejemplo.es" }), "Hoy ejemplo.es (https://ejemplo.es) {otro}");
});

test("el texto para X cabe en 280 caracteres incluso con un dominio largo y menciona a LaLiga y Cloudflare", () => {
  const texto = rellenar(TEXTO_X_POR_DEFECTO, { sitio: "un-dominio-bastante-largo-de-ejemplo.es" });
  assert.ok(cabeEnX(texto));
  assert.ok(texto.includes("@LaLiga") && texto.includes("@Cloudflare"));
  assert.equal(longitudEnX("https://ejemplo.es/ruta-larguisima"), 23);
  assert.equal(new URL(urlPublicarEnX(texto)).searchParams.get("text"), texto);
  for (const v of Object.values(TEXTOS_POR_DEFECTO)) assert.ok(v.length > 0);
});
