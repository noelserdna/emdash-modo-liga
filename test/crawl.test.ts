import { test } from "node:test";
import assert from "node:assert/strict";
import { archivoDe, archivoDeQuery, enlaces, esRecurso, marcarComoEspejo, redirectsDe, reescribirImagenes, seCopia, paginaAviso } from "../src/cli/crawl.ts";
import { generarNetlifyToml } from "../src/cli/netlify.ts";

test("archivoDe: páginas como <ruta>.html, raíz como index.html, recursos tal cual", () => {
  assert.equal(archivoDe("/", true), "index.html");
  assert.equal(archivoDe("/articulos/hola", true), "articulos/hola.html");
  assert.equal(archivoDe("/articulos/hola/", true), "articulos/hola.html");
  assert.equal(archivoDe("/rss.xml", true), "rss.xml");
  assert.equal(archivoDe("/_astro/x.css", false), "_astro/x.css");
  assert.equal(archivoDeQuery("/articulos", "cursor", "ab+c/d"), "__q/articulos/cursor/ab_2b" + "c_2fd.html");
});

test("enlaces: relativos y absolutos al host canónico, srcset y url() de CSS; descarta externos", () => {
  const html = `<a href="https://ejemplo.es/articulos/uno#x">a</a> <img src="/_astro/a.png" srcset="/_image?href=%2Fa.png&w=400 400w, /_image?href=%2Fa.png&w=800 800w">
    <link href="https://otro.es/x.css"> <a href="/articulos?cursor=abc">2</a> <style>body{background:url('/fondo.webp')}</style> <a href="//cdn.x/y">cdn</a>`;
  assert.deepEqual(enlaces(html, "https://ejemplo.es"), ["/articulos/uno", "/_astro/a.png", "/articulos?cursor=abc", "/_image?href=%2Fa.png&w=400", "/_image?href=%2Fa.png&w=800", "/fondo.webp"]);
});

test("esRecurso y seCopia según el modo", () => {
  assert.ok(esRecurso("/_astro/a.css") && esRecurso("/fondo.webp") && esRecurso("/_emdash/api/media/file/x.jpg") && esRecurso("/_image?href=x"));
  assert.ok(!esRecurso("/articulos/uno"));
  assert.ok(seCopia("/_astro/a.css", "copia-y-proxy") && !seCopia("/_astro/a.css", "proxy-total"));
  assert.ok(!seCopia("/_emdash/api/media/file/x.jpg", "copia-y-proxy") && seCopia("/_emdash/api/media/file/x.jpg", "solo-copia"));
  assert.ok(!seCopia("/_emdash/api/search", "solo-copia"));
});

test("marcarComoEspejo cambia solo el JSON del plugin; reescribirImagenes mapea /_image a /__img", () => {
  const html = `<p>hola</p><script type="application/json" id="modo-liga-estado">{"activo":false,"espejo":false,"x":"https://x.com"}</script><script>var a=1</script>`;
  const out = marcarComoEspejo(html);
  assert.ok(out.includes('"espejo":true') && out.includes('"activo":false') && out.includes("var a=1"));
  assert.equal(marcarComoEspejo("<p>sin json</p>"), "<p>sin json</p>");
  const mapa = new Map<string, string>();
  const re = reescribirImagenes(`<img src="/_image?href=%2Fa.png&w=400" srcset="/_image?href=%2Fa.png&w=400 400w, /_image?href=%2Fa.png&w=800 800w">`, mapa);
  assert.equal(mapa.size, 2);
  assert.ok(/src="\/__img\/[0-9a-f]{16}"/.test(re));
});

test("redirectsDe solo en solo-copia; página de aviso con textos del plugin", () => {
  const q = [{ ruta: "/articulos", parametro: "cursor" }, { ruta: "/articulos", parametro: "cursor" }, { ruta: "/", parametro: "page" }];
  assert.equal(redirectsDe(q, "copia-y-proxy"), "");
  assert.equal(redirectsDe(q, "solo-copia"), "/articulos cursor=:v /__q/articulos/cursor/:v 200\n/ page=:v /__q/index/page/:v 200\n");
  const html = paginaAviso({ activo: true, espejo: true, motivo: "calendario", proxima: null, ventana: null, sitio: "ejemplo.es", textos: { antes: "", durante: "", espejo: "" }, aviso: { titulo: "T<", encabezado: "E", explicacion: "X", consecuencia: "C", llamada: "L", boton: "B" }, x: "https://x.com/intent/post?text=hola", avisoUrl: null, generado: "" }, "https://ejemplo.es");
  assert.ok(html.includes("T&lt;") && html.includes('href="https://x.com/intent/post?text=hola"') && html.includes('<html lang="es">'));
  assert.ok(paginaAviso(null, "https://ejemplo.es").includes("ejemplo.es"));
});

test("netlify.toml: proxy firmado de /_emdash y /.well-known, query al origen, catch-all sin force; proxy-total y solo-copia", () => {
  const toml = generarNetlifyToml({ dominio: "ejemplo.es", origenHost: "origen.ejemplo.es", modo: "copia-y-proxy", excluir: ["/checkout"], parametrosQuery: ["cursor"] });
  assert.ok(toml.includes('from = "/_emdash/*"') && toml.includes('to = "https://origen.ejemplo.es/_emdash/:splat"') && toml.includes('signed = "ESPEJO_FIRMA"'));
  assert.ok(toml.includes('from = "https://www.ejemplo.es/*"'));
  assert.ok(toml.includes('query = { cursor = ":cursor" }'));
  assert.ok(toml.includes('from = "/checkout"') && toml.includes('to = "/sin-acceso"'));
  const catchAll = toml.slice(toml.lastIndexOf('from = "/*"'));
  assert.ok(catchAll.includes("status = 200") && !catchAll.includes("force = true"), "el catch-all no debe llevar force");
  const total = generarNetlifyToml({ dominio: "ejemplo.es", origenHost: "origen.ejemplo.es", modo: "proxy-total" });
  assert.ok(total.includes('from = "/sin-acceso"') && /from = "\/\*"\n  to = "https:\/\/origen\.ejemplo\.es\/:splat"\n  status = 200\n  force = true/.test(total));
  const solo = generarNetlifyToml({ dominio: "ejemplo.es", origenHost: "origen.ejemplo.es", modo: "solo-copia" });
  assert.ok(!solo.includes("signed = "));
});
