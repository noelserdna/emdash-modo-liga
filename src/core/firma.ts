// JWS HS256 compacto, como el que Netlify envía en `x-nf-sign` con los signed
// proxy redirects, y el que emite el crawler para rastrear origen.<dominio>.
// Solo WebCrypto: vale en Workers, Node y navegador. Módulo puro.

export const EMISOR_NETLIFY = "netlify";
export const EMISOR_CRAWL = "modo-liga-crawl";

export interface DatosFirma {
  iss: string;
  exp?: number;
  iat?: number;
  site_url?: string;
  deploy_context?: string;
  [clave: string]: unknown;
}

export interface OpcionesVerificacion {
  ahora?: number;
  emisores?: string[];
  /** Si se indica, una firma de Netlify debe traer este `site_url`. */
  siteUrlEspejo?: string;
}

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

function aBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64url(texto: string): Uint8Array<ArrayBuffer> {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(texto.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function clave(secreto: string, uso: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", codificador.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, [uso]);
}

/** Devuelve los datos firmados si el JWS es válido; null si no. */
export async function verificarJws(jws: string | null | undefined, secreto: string | undefined, opciones: OpcionesVerificacion = {}): Promise<DatosFirma | null> {
  if (!jws || !secreto) return null;
  const partes = jws.split(".");
  if (partes.length !== 3) return null;
  const [cab, cuerpo, firma] = partes as [string, string, string];
  try {
    const cabecera = JSON.parse(decodificador.decode(deBase64url(cab))) as { alg?: string };
    if (cabecera.alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await clave(secreto, "verify"), deBase64url(firma), codificador.encode(`${cab}.${cuerpo}`));
    if (!ok) return null;
    const datos = JSON.parse(decodificador.decode(deBase64url(cuerpo))) as DatosFirma;
    const ahora = opciones.ahora ?? Date.now();
    const emisores = opciones.emisores ?? [EMISOR_NETLIFY, EMISOR_CRAWL];
    if (typeof datos.iss !== "string" || !emisores.includes(datos.iss)) return null;
    if (typeof datos.exp === "number" && datos.exp * 1000 <= ahora) return null;
    if (datos.iss === EMISOR_NETLIFY && opciones.siteUrlEspejo && datos.site_url !== opciones.siteUrlEspejo) return null;
    return datos;
  } catch {
    return null;
  }
}

export async function emitirJws(datos: DatosFirma, secreto: string): Promise<string> {
  const cab = aBase64url(codificador.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const cuerpo = aBase64url(codificador.encode(JSON.stringify(datos)));
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", await clave(secreto, "sign"), codificador.encode(`${cab}.${cuerpo}`)));
  return `${cab}.${cuerpo}.${aBase64url(firma)}`;
}

/** Firma del crawler: caduca en `vidaSegundos`. */
export function datosFirmaCrawl(ahora: number, vidaSegundos = 600): DatosFirma {
  const iat = Math.floor(ahora / 1000);
  return { iss: EMISOR_CRAWL, iat, exp: iat + vidaSegundos };
}
