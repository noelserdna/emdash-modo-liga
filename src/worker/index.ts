// Wrapper del Worker: acepta en origen.<dominio> solo las peticiones firmadas
// (Netlify con `x-nf-sign`, o el crawler con su propio JWS), las rehace en el
// host canónico conservando `request.cf`, pone la IP real del visitante y
// marca la petición. En el resto de hosts borra las cabeceras reservadas para
// que nadie pueda fingir que viene del espejo.
import { EMISOR_CRAWL, EMISOR_NETLIFY, verificarJws, type DatosFirma } from "../core/firma.ts";
import { esIp } from "../core/deteccion.ts";

export const CABECERA_FIRMA = "x-nf-sign";
export const CABECERA_FIRMA_CRAWL = "x-modo-liga-firma";
export const CABECERA_IP_NETLIFY = "x-nf-client-connection-ip";
export const MARCA = "x-modo-liga";
export const MARCA_ORIGEN = "x-modo-liga-origen";
export const CABECERAS_RESERVADAS = [CABECERA_FIRMA, CABECERA_FIRMA_CRAWL, CABECERA_IP_NETLIFY, MARCA, MARCA_ORIGEN];

export interface OpcionesWorker {
  /** Host del Worker que Netlify y el crawler usan como origen (custom domain). */
  origenHost: string;
  /** Host público del sitio. */
  canonicalHost: string;
  /** Nombre de la variable de entorno con el secreto compartido. */
  secretEnv?: string;
  /** `https://<sitio>.netlify.app`: si se indica, la firma de Netlify debe llevarlo en `site_url`. */
  siteUrlEspejo?: string;
  ahora?: () => number;
}

/** Forma mínima de un ExportedHandler de Cloudflare (el `fetch` es opcional en el tipo). */
export interface ManejadorFetch<Env = unknown> {
  fetch?(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response;
}

export interface ManejadorEnvuelto<Env = unknown> {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

type RequestConCf = Request & { cf?: unknown };

/** Petición reenviada por el espejo o el crawler, rehecha en el host canónico; null si la firma no vale. */
export async function peticionDelEspejo(request: Request, secreto: string | undefined, opciones: OpcionesWorker, ahora = Date.now()): Promise<{ peticion: Request; firma: DatosFirma } | null> {
  const jws = request.headers.get(CABECERA_FIRMA) ?? request.headers.get(CABECERA_FIRMA_CRAWL);
  const firma = await verificarJws(jws, secreto, {
    ahora,
    emisores: [EMISOR_NETLIFY, EMISOR_CRAWL],
    ...(opciones.siteUrlEspejo ? { siteUrlEspejo: opciones.siteUrlEspejo } : {}),
  });
  if (!firma) return null;

  const url = new URL(request.url);
  const destino = new URL(url.pathname + url.search, `https://${opciones.canonicalHost}`);
  const headers = new Headers(request.headers);
  headers.delete(CABECERA_FIRMA);
  headers.delete(CABECERA_FIRMA_CRAWL);
  headers.delete(MARCA_ORIGEN);
  headers.set(MARCA, firma.iss === EMISOR_CRAWL ? "crawl" : "espejo");
  const ip = headers.get(CABECERA_IP_NETLIFY)?.trim();
  if (ip && esIp(ip)) headers.set("CF-Connecting-IP", ip);
  headers.delete(CABECERA_IP_NETLIFY);

  const conCuerpo = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { cf?: unknown; duplex?: "half" } = {
    method: request.method,
    headers,
    body: conCuerpo ? request.body : null,
    redirect: "manual",
    ...(conCuerpo ? { duplex: "half" } : {}),
  };
  const cf = (request as RequestConCf).cf;
  if (cf) init.cf = cf;
  return { peticion: new Request(destino, init), firma };
}

/** Borra las cabeceras que solo puede poner el propio Worker. */
export function sinCabecerasReservadas(request: Request): Request {
  if (!CABECERAS_RESERVADAS.some((c) => request.headers.has(c))) return request;
  const headers = new Headers(request.headers);
  for (const c of CABECERAS_RESERVADAS) headers.delete(c);
  return new Request(request, { headers });
}

function conMarcaOrigen(respuesta: Response): Response {
  const headers = new Headers(respuesta.headers);
  headers.set(MARCA_ORIGEN, "1");
  return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers });
}

export function withModoLiga<Env = unknown>(manejador: ManejadorFetch<Env>, opciones: OpcionesWorker): ManejadorEnvuelto<Env> {
  const base = manejador.fetch;
  if (!base) throw new Error("withModoLiga: el handler no tiene fetch");
  const secretEnv = opciones.secretEnv ?? "MODO_LIGA_FIRMA";
  const ahora = opciones.ahora ?? (() => Date.now());
  return {
    async fetch(request, env, ctx) {
      const host = new URL(request.url).hostname;
      if (host === opciones.origenHost) {
        const valor = (env as Record<string, unknown> | undefined)?.[secretEnv];
        const secreto = typeof valor === "string" && valor.length > 0 ? valor : undefined;
        const resultado = await peticionDelEspejo(request, secreto, opciones, ahora());
        if (!resultado) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
        return conMarcaOrigen(await base.call(manejador, resultado.peticion, env, ctx));
      }
      return base.call(manejador, sinCabecerasReservadas(request), env, ctx);
    },
  };
}
