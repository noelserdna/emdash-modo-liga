// netlify.toml del espejo. Las reglas con `signed` y las cabeceras hacia el
// upstream solo existen en netlify.toml (no en _redirects), y _redirects se
// evalúa antes: por eso el crawler no escribe reglas con comodines y todo lo
// que es proxy vive aquí.
import type { ModoEspejo } from "./crawl.ts";

export interface OpcionesToml {
  dominio: string;
  origenHost: string;
  modo: ModoEspejo;
  /** Nombre de la variable de entorno de Netlify (ámbito Runtime) con el secreto compartido. */
  variableFirma?: string;
  /** Prefijos que siempre van al origen (además de /_emdash y /.well-known). */
  proxiar?: string[];
  /** Parámetros de query que mandan la petición al origen (paginación, búsqueda). */
  parametrosQuery?: string[];
  /** Rutas que en el espejo llevan a /sin-acceso. */
  excluir?: string[];
  conWww?: boolean;
  publish?: string;
}

function regla(from: string, to: string, status: number, extra: Record<string, string | boolean> = {}): string {
  const lineas = [`[[redirects]]`, `  from = ${JSON.stringify(from)}`, `  to = ${JSON.stringify(to)}`, `  status = ${status}`];
  for (const [k, v] of Object.entries(extra)) lineas.push(`  ${k} = ${typeof v === "string" ? JSON.stringify(v) : v}`);
  return lineas.join("\n");
}

export function generarNetlifyToml(o: OpcionesToml): string {
  const firma = o.variableFirma ?? "ESPEJO_FIRMA";
  const origen = `https://${o.origenHost}`;
  const proxiar = [...new Set(["/_emdash", "/.well-known", ...(o.proxiar ?? [])])];
  const parametros = o.parametrosQuery ?? ["cursor", "page", "pagina", "q"];
  const bloques: string[] = [];
  bloques.push(`# Espejo de ${o.dominio} para el modo liga (emdash-modo-liga). Generado por \`emdash-modo-liga init\`.`);
  bloques.push(`# Durante los partidos de LaLiga el DNS de ${o.dominio} apunta aquí. Lo que no está en la copia`);
  bloques.push(`# se reenvía firmado a ${origen} (signed proxy redirects: la variable ${firma},`);
  bloques.push(`# ámbitos Builds y Runtime, con el mismo valor que el secreto MODO_LIGA_FIRMA del Worker).`);
  bloques.push(`# Las reglas se aplican en orden: la primera que coincide gana.\n`);
  bloques.push(`[build]\n  publish = ${JSON.stringify(o.publish ?? "publico")}\n  command = "bash build.sh"\n  # Variables no secretas del build; la única secreta (${firma}) se pone en la UI de Netlify.\n  [build.environment]\n    NODE_VERSION = "24"\n    MODO_LIGA_ORIGEN = ${JSON.stringify(origen)}\n    MODO_LIGA_SITIO = ${JSON.stringify(`https://${o.dominio}`)}\n    MODO_LIGA_MODO = ${JSON.stringify(o.modo)}\n`);
  if (o.conWww !== false) bloques.push(`# www → dominio raíz\n${regla(`https://www.${o.dominio}/*`, `https://${o.dominio}/:splat`, 301, { force: true })}\n`);
  if (o.modo !== "solo-copia") {
    bloques.push(`# ── Reenviadas al Worker con firma ──`);
    for (const p of proxiar) {
      bloques.push(regla(`${p}/*`, `${origen}${p}/:splat`, 200, { force: true, signed: firma }));
      bloques.push(regla(p, `${origen}${p}`, 200, { force: true, signed: firma }));
    }
    bloques.push("");
  }
  if (o.excluir?.length) {
    bloques.push(`# ── Lo que el espejo no puede hacer: a la página de aviso ──`);
    for (const r of o.excluir) bloques.push(regla(r, "/sin-acceso", 302, { force: true }));
    bloques.push("");
  }
  if (o.modo === "copia-y-proxy") {
    bloques.push(`# ── Páginas con parámetros (paginación, búsqueda): siempre frescas desde el origen ──`);
    for (const p of parametros) {
      bloques.push([`[[redirects]]`, `  from = "/*"`, `  query = { ${p} = ":${p}" }`, `  to = ${JSON.stringify(`${origen}/:splat`)}`, `  status = 200`, `  force = true`, `  signed = ${JSON.stringify(firma)}`].join("\n"));
    }
    bloques.push("");
    bloques.push(`# ── Todo lo que no exista en la copia va al origen (sin force: los ficheros estáticos ganan) ──`);
    bloques.push(regla("/*", `${origen}/:splat`, 200, { signed: firma }));
    bloques.push("");
  } else if (o.modo === "proxy-total") {
    bloques.push(`# ── Proxy total: todo al origen salvo /sin-acceso y los ficheros del propio espejo ──`);
    bloques.push(regla("/sin-acceso", "/sin-acceso.html", 200, { force: true }));
    bloques.push(regla("/__modo-liga/*", "/__modo-liga/:splat", 200, { force: true }));
    bloques.push(regla("/*", `${origen}/:splat`, 200, { force: true, signed: firma }));
    bloques.push("");
  }
  bloques.push(`# Cabeceras: las de los estáticos están en _headers (las proxiadas las pone el origen).`);
  bloques.push(`[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Modo-Liga-Espejo = "1"\n`);
  return bloques.join("\n");
}
