// Copia estática del sitio para el espejo. Rastrea SIEMPRE origen.<dominio> con
// la firma del crawler (nunca el dominio público, que puede estar apuntando al
// propio espejo), exige la marca `x-modo-liga-origen` en cada respuesta y se
// niega a copiar páginas con sesión. Genera también 404.html, sin-acceso.html,
// _headers, _redirects y __modo-liga/estado.json.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, extname } from "node:path";
import { datosFirmaCrawl, emitirJws } from "../core/firma.ts";
import type { EstadoPublico } from "../runtime/fragmentos.ts";

export type ModoEspejo = "copia-y-proxy" | "proxy-total" | "solo-copia";

export interface OpcionesCrawl {
  /** https://origen.<dominio> */
  origen: string;
  /** https://<dominio> (host canónico que llevan los enlaces absolutos). */
  sitio: string;
  salida: string;
  secreto: string;
  modo: ModoEspejo;
  /** Rutas extra que no están en el sitemap. */
  extras?: string[];
  /** Parámetros de query cuyas páginas se guardan (solo-copia) o se reenvían (copia-y-proxy). */
  parametrosQuery?: string[];
  maxPaginasQuery?: number;
  concurrencia?: number;
  idPlugin?: string;
  log?: (m: string) => void;
}

export interface ResultadoCrawl {
  paginas: number;
  archivos: number;
  fallos: string[];
  estado: EstadoPublico | null;
}

const UA = "emdash-modo-liga/crawl";
const COOKIES_SESION = /(^|;\s*)(emdash[-_]?session|auth_session|__session|session)=/i;

export function archivoDe(ruta: string, esHtml: boolean): string {
  if (ruta === "/" || ruta === "") return "index.html";
  const limpia = ruta.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!esHtml) return limpia;
  return /\.[a-z0-9]{1,5}$/i.test(limpia) ? limpia : `${limpia}.html`;
}

/** Nombre de archivo para una página con query: /articulos?cursor=abc → __q/articulos/cursor/abc.html */
export function archivoDeQuery(ruta: string, parametro: string, valor: string): string {
  const seguro = valor.replace(/[^A-Za-z0-9._-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`);
  return join("__q", ruta.replace(/^\/+/, "") || "index", parametro, `${seguro}.html`);
}

/** Rutas propias (relativas) enlazadas desde HTML o CSS, incluidas las absolutas al host canónico. */
export function enlaces(texto: string, sitio: string): string[] {
  const rutas = new Set<string>();
  const propio = sitio.replace(/\/$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of texto.matchAll(/(?:src|href|content|poster|data-src)=["']([^"']+)["']/g)) rutas.add(m[1]!);
  for (const m of texto.matchAll(/srcset=["']([^"']+)["']/g)) for (const parte of m[1]!.split(",")) rutas.add(parte.trim().split(/\s+/)[0] ?? "");
  for (const m of texto.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) rutas.add(m[2]!);
  const salida: string[] = [];
  for (let r of rutas) {
    r = r.replace(new RegExp(`^${propio}`), "");
    if (!r.startsWith("/") || r.startsWith("//")) continue;
    salida.push(r.split("#")[0]!);
  }
  return [...new Set(salida)];
}

const ES_RECURSO = /\.(css|js|mjs|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|webmanifest|json|txt|xml|pdf|mp4|webm|mp3)(\?.*)?$/i;

export function esRecurso(ruta: string): boolean {
  return ruta.startsWith("/_astro/") || ES_RECURSO.test(ruta) || ruta.startsWith("/_emdash/api/media/file/") || ruta.startsWith("/_image");
}

/** ¿Se descarga este recurso o se deja para el proxy? */
export function seCopia(ruta: string, modo: ModoEspejo): boolean {
  if (modo === "proxy-total") return false;
  if (ruta.startsWith("/_emdash/api/media/file/") || ruta.startsWith("/_image")) return modo === "solo-copia";
  if (ruta.startsWith("/_emdash/")) return false;
  return true;
}

/** Sustituye el JSON de estado del banner por uno con espejo: true. */
export function marcarComoEspejo(html: string, idPlugin = "modo-liga"): string {
  const id = `${idPlugin}-estado`;
  return html.replace(new RegExp(`(<script type="application/json" id="${id}">)([^<]*)(</script>)`), (_m, a: string, json: string, c: string) => {
    try {
      const datos = JSON.parse(json) as Record<string, unknown>;
      return `${a}${JSON.stringify({ ...datos, espejo: true }).replace(/</g, "\\u003c")}${c}`;
    } catch {
      return `${a}${json}${c}`;
    }
  });
}

/** Rutas de /_image?href=... → fichero local con hash; devuelve el HTML reescrito y el mapa. */
export function reescribirImagenes(html: string, mapa: Map<string, string>): string {
  return html.replace(/\/_image\?[^"'\s,)]+/g, (u) => {
    const destino = mapa.get(u) ?? `/__img/${createHash("sha1").update(u).digest("hex").slice(0, 16)}`;
    mapa.set(u, destino);
    return destino;
  });
}

export async function crawl(o: OpcionesCrawl): Promise<ResultadoCrawl> {
  const log = o.log ?? (() => {});
  const origen = o.origen.replace(/\/$/, "");
  const sitio = o.sitio.replace(/\/$/, "");
  const idPlugin = o.idPlugin ?? "modo-liga";
  const parametros = o.parametrosQuery ?? ["cursor", "page", "pagina"];
  const maxQuery = o.maxPaginasQuery ?? 50;
  let firma = await emitirJws(datosFirmaCrawl(Date.now()), o.secreto);
  let firmadoAt = Date.now();

  async function pedir(ruta: string): Promise<Response> {
    if (Date.now() - firmadoAt > 8 * 60_000) {
      firma = await emitirJws(datosFirmaCrawl(Date.now()), o.secreto);
      firmadoAt = Date.now();
    }
    const r = await fetch(origen + ruta, { redirect: "manual", headers: { "user-agent": UA, "x-modo-liga-firma": firma } });
    if (r.headers.get("x-modo-liga-origen") !== "1") {
      // Los ficheros estáticos (/_astro/*, fuentes, imágenes) los sirve la capa de assets de
      // Cloudflare sin pasar por el Worker: llegan sin marca y son inofensivos. El HTML, no.
      const tipo = (r.headers.get("content-type") ?? "").toLowerCase();
      const estatico = esRecurso(ruta) && !/html|xml|json/.test(tipo);
      if (!estatico) throw new Error(`${ruta}: la respuesta no viene del origen del modo liga (falta x-modo-liga-origen). ¿Es ${origen} el custom domain del Worker con withModoLiga?`);
    }
    const sc = r.headers.get("set-cookie") ?? "";
    if (COOKIES_SESION.test(sc)) throw new Error(`${ruta}: la respuesta trae una cookie de sesión; la copia no sería anónima.`);
    return r;
  }

  async function guardar(archivo: string, cuerpo: string | Uint8Array): Promise<void> {
    const destino = join(o.salida, archivo);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, cuerpo);
  }

  await rm(o.salida, { recursive: true, force: true });
  await mkdir(o.salida, { recursive: true });

  // Estado público del plugin (textos del aviso y del banner)
  let estado: EstadoPublico | null = null;
  try {
    const r = await pedir(`/_emdash/api/plugins/${idPlugin}/estado`);
    if (r.ok) {
      // EmDash envuelve las respuestas de las rutas de plugin en { success, data }
      const cuerpo = (await r.json()) as { success?: boolean; data?: EstadoPublico } | EstadoPublico;
      estado = "data" in cuerpo && cuerpo.data ? cuerpo.data : (cuerpo as EstadoPublico);
    }
  } catch (e) {
    log(`aviso: no se pudo leer el estado del plugin: ${String(e)}`);
  }
  if (estado) await guardar("__modo-liga/estado.json", JSON.stringify({ ...estado, espejo: true }));

  // URLs del sitemap (índice o directo)
  const paginas = new Set<string>(["/", ...(o.extras ?? [])]);
  const sitemaps = ["/sitemap.xml"];
  const vistosSitemaps = new Set<string>();
  while (sitemaps.length) {
    const sm = sitemaps.shift()!;
    if (vistosSitemaps.has(sm)) continue;
    vistosSitemaps.add(sm);
    const r = await pedir(sm);
    if (!r.ok) continue;
    const xml = await r.text();
    await guardar(archivoDe(sm, false), xml);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const u = new URL(m[1]!, sitio);
      const ruta = u.pathname + u.search;
      if (/sitemap[^/]*\.xml$/i.test(u.pathname)) sitemaps.push(u.pathname);
      else paginas.add(ruta);
    }
  }

  const fallos: string[] = [];
  const recursos = new Set<string>();
  const hechos = new Set<string>();
  const imagenes = new Map<string, string>();
  const queries: { ruta: string; parametro: string; valor: string }[] = [];
  let totalPaginas = 0;

  async function pagina(ruta: string, archivo: string): Promise<void> {
    const r = await pedir(ruta);
    if (r.status !== 200) {
      fallos.push(`${ruta}: ${r.status}`);
      return;
    }
    let html = await r.text();
    if (html.includes('data-emdash-edit-mode') || html.includes("emdash-edit-mode=true")) throw new Error(`${ruta}: la página lleva el modo de edición; la copia no es anónima.`);
    html = marcarComoEspejo(html, idPlugin);
    if (o.modo === "solo-copia") html = reescribirImagenes(html, imagenes);
    await guardar(archivo, html);
    totalPaginas++;
    for (const e of enlaces(html, sitio)) {
      if (esRecurso(e)) {
        if (seCopia(e, o.modo)) recursos.add(e);
        continue;
      }
      const [camino, query] = e.split("?") as [string, string?];
      if (!query) continue;
      const params = new URLSearchParams(query);
      for (const p of parametros) {
        const v = params.get(p);
        if (v && params.size === 1 && queries.length < maxQuery && !queries.some((q) => q.ruta === camino && q.parametro === p && q.valor === v)) queries.push({ ruta: camino, parametro: p, valor: v });
      }
    }
  }

  const lote = async <T,>(items: T[], fn: (x: T) => Promise<void>) => {
    const cola = [...items];
    const n = Math.max(1, o.concurrencia ?? 4);
    await Promise.all(Array.from({ length: n }, async () => {
      while (cola.length) {
        const x = cola.shift()!;
        try {
          await fn(x);
        } catch (e) {
          if (e instanceof Error && /modo liga|anónima/.test(e.message)) throw e;
          fallos.push(String(e));
        }
      }
    }));
  };

  if (o.modo !== "proxy-total") {
    await lote([...paginas], async (ruta) => {
      const [camino, query] = ruta.split("?") as [string, string?];
      if (query) return; // las páginas con query se recogen desde los enlaces
      await pagina(camino, archivoDe(camino, true));
      hechos.add(camino);
    });
    // Páginas con query (paginación): solo se guardan en solo-copia; en copia-y-proxy las sirve el origen
    if (o.modo === "solo-copia") {
      for (let i = 0; i < queries.length; i++) {
        const q = queries[i]!;
        await pagina(`${q.ruta}?${q.parametro}=${encodeURIComponent(q.valor)}`, archivoDeQuery(q.ruta, q.parametro, q.valor)).catch((e) => fallos.push(String(e)));
      }
    }
    // 404 del sitio
    const no = await pedir("/__modo-liga-no-existe-" + Date.now().toString(36));
    if (no.status === 404) await guardar("404.html", marcarComoEspejo(await no.text(), idPlugin));
    // Recursos (y los que enlazan los CSS)
    const pendientes = [...recursos];
    while (pendientes.length) {
      const grupo = pendientes.splice(0, 50);
      await lote(grupo, async (ruta) => {
        if (hechos.has(ruta)) return;
        hechos.add(ruta);
        const r = await pedir(ruta);
        if (r.status !== 200) {
          fallos.push(`${ruta}: ${r.status}`);
          return;
        }
        const cuerpo = new Uint8Array(await r.arrayBuffer());
        const destino = ruta.startsWith("/_image") ? `${imagenes.get(ruta) ?? reescribirImagenes(ruta, imagenes)}${extensionDe(r.headers.get("content-type"))}` : archivoDe(ruta.split("?")[0]!, false);
        if (ruta.startsWith("/_image")) imagenes.set(ruta, destino);
        await guardar(destino, cuerpo);
        if (/\.css(\?|$)/i.test(ruta)) for (const e of enlaces(new TextDecoder().decode(cuerpo), sitio)) if (esRecurso(e) && seCopia(e, o.modo) && !hechos.has(e)) pendientes.push(e);
      });
    }
  }

  // Página de aviso y ficheros de Netlify
  await guardar("sin-acceso.html", paginaAviso(estado, sitio));
  await guardar("_headers", cabeceras());
  const redirects = redirectsDe(queries, o.modo);
  if (redirects) await guardar("_redirects", redirects);

  log(JSON.stringify({ paginas: totalPaginas, archivos: hechos.size, fallos: fallos.length }));
  if (o.modo !== "proxy-total" && fallos.length > Math.max(3, paginas.size / 10)) throw new Error(`Demasiados fallos (${fallos.length}): ${fallos.slice(0, 5).join(" | ")}`);
  return { paginas: totalPaginas, archivos: hechos.size, fallos, estado };
}

function extensionDe(tipo: string | null): string {
  const t = (tipo ?? "").split(";")[0]!.trim();
  const mapa: Record<string, string> = { "image/avif": ".avif", "image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/svg+xml": ".svg" };
  return mapa[t] ?? (extname(t) || "");
}

export function cabeceras(): string {
  return [
    "/*",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "  X-Modo-Liga-Espejo: 1",
    "",
    "/_astro/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/__img/*",
    "  Cache-Control: public, max-age=86400",
    "",
    "/sin-acceso",
    "  X-Robots-Tag: noindex",
    "",
  ].join("\n");
}

/** En solo-copia, las páginas con query se sirven desde sus ficheros. */
export function redirectsDe(queries: { ruta: string; parametro: string }[], modo: ModoEspejo): string {
  if (modo !== "solo-copia") return "";
  const reglas = new Set<string>();
  for (const q of queries) reglas.add(`${q.ruta} ${q.parametro}=:v /__q${q.ruta === "/" ? "/index" : q.ruta}/${q.parametro}/:v 200`);
  return [...reglas].join("\n") + (reglas.size ? "\n" : "");
}

function escapar(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function paginaAviso(estado: EstadoPublico | null, sitio: string): string {
  const host = new URL(sitio).hostname;
  const a = estado?.aviso ?? {
    titulo: "Hoy hay fútbol: acceso limitado",
    encabezado: `Hoy hay fútbol y puede que no llegues a ${host}`,
    explicacion: `Mientras dura un partido de LaLiga, las operadoras españolas bloquean direcciones de Cloudflare por una orden judicial que pidió LaLiga. ${host} funciona sobre Cloudflare y queda bloqueada junto con muchas otras webs legales.`,
    consecuencia: "Durante los partidos servimos una copia de la web desde otro sitio. Algunas funciones pueden no estar disponibles hasta que termine el bloqueo.",
    llamada: "¿Te parece mal? A nosotros también. Cuéntalo en X: el mensaje ya va escrito.",
    boton: "Publicar en X",
  };
  const x = estado?.x ?? "https://x.com/intent/post";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapar(a.titulo)} · ${escapar(host)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:Canvas;color:CanvasText}
main{max-width:40rem;margin:0 auto;padding:3rem 1.25rem}
h1{font-size:1.75rem;line-height:1.2;margin:0 0 1rem}
p{margin:0 0 1rem}
.caja{border:1px solid color-mix(in srgb,CanvasText 20%,transparent);border-radius:.75rem;padding:1.25rem;margin:1.5rem 0}
.boton{display:inline-block;padding:.65rem 1.1rem;border-radius:.5rem;background:CanvasText;color:Canvas;text-decoration:none;font-weight:600}
small{opacity:.7}
</style>
</head>
<body>
<main>
<p><a href="/">← ${escapar(host)}</a></p>
<h1>${escapar(a.encabezado)}</h1>
<p>${escapar(a.explicacion)}</p>
<p>${escapar(a.consecuencia)}</p>
<div class="caja">
<p><strong>${escapar(a.llamada)}</strong></p>
<p><a class="boton" href="${escapar(x)}" target="_blank" rel="noopener">${escapar(a.boton)}</a></p>
</div>
<p><small>Más información sobre los bloqueos: <a href="https://hayahora.futbol/" rel="noopener">hayahora.futbol</a> · <a href="https://laligagate.com/" rel="noopener">#LaLigaGate</a>.</small></p>
</main>
</body>
</html>
`;
}
