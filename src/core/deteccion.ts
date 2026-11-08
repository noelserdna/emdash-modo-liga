// Detección del bloqueo real con hayahora.futbol: listas de IPs bloqueadas en
// texto plano (una por línea), sin SLA ni CORS. Se cruzan con las IPs "normales"
// del sitio (las que Cloudflare asigna a la zona), resueltas por DNS sobre HTTPS
// y cacheadas. Nunca se usa data.json (5 MB). Módulo puro.

export const URL_HAYAHORA_ANY = "https://hayahora.futbol/estado/blocked-any.txt";
export const OPERADORES_HAYAHORA = ["movistar", "digi", "vodafone", "orange", "masmovil"] as const;

export function urlHayahora(operador?: string): string {
  return operador ? `https://hayahora.futbol/estado/blocked-${operador}.txt` : URL_HAYAHORA_ANY;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function esIp(texto: string): boolean {
  return IPV4.test(texto) || (texto.includes(":") && IPV6.test(texto));
}

export function parseListaIps(texto: string): string[] {
  return [...new Set(texto.split(/\r?\n/).map((l) => l.trim()).filter(esIp))];
}

export async function leerBloqueadas(fetchFn: typeof fetch, url = URL_HAYAHORA_ANY): Promise<string[]> {
  const r = await fetchFn(url, { headers: { accept: "text/plain" } });
  if (!r.ok) throw new Error(`hayahora ${url}: ${r.status}`);
  return parseListaIps(await r.text());
}

/** Resuelve A y AAAA de `host` por DoH (formato JSON de Cloudflare/Google). */
export async function resolverIps(host: string, fetchFn: typeof fetch, resolver = "https://cloudflare-dns.com/dns-query"): Promise<string[]> {
  const ips: string[] = [];
  for (const tipo of ["A", "AAAA"]) {
    const r = await fetchFn(`${resolver}?name=${encodeURIComponent(host)}&type=${tipo}`, { headers: { accept: "application/dns-json" } });
    if (!r.ok) throw new Error(`DoH ${host} ${tipo}: ${r.status}`);
    const datos = (await r.json()) as { Answer?: { type: number; data: string }[] };
    for (const a of datos.Answer ?? []) if ((a.type === 1 || a.type === 28) && esIp(a.data)) ips.push(a.data);
  }
  return [...new Set(ips)];
}

export function cruce(propias: string[], bloqueadas: string[]): string[] {
  const set = new Set(bloqueadas.map((ip) => ip.toLowerCase()));
  return propias.filter((ip) => set.has(ip.toLowerCase()));
}

export interface Deteccion {
  consultadoAt: number;
  /** Cuántas IPs hay bloqueadas en total (pulso del bloqueo, aunque no sean nuestras). */
  totalBloqueadas: number;
  propiasBloqueadas: string[];
  /** true si alguna IP propia está bloqueada; si no hay IPs propias conocidas, si hay bloqueo general. */
  bloqueado: boolean;
}

export async function detectar(propias: string[], fetchFn: typeof fetch, ahora: number, url = URL_HAYAHORA_ANY): Promise<Deteccion> {
  const bloqueadas = await leerBloqueadas(fetchFn, url);
  const propiasBloqueadas = cruce(propias, bloqueadas);
  return {
    consultadoAt: ahora,
    totalBloqueadas: bloqueadas.length,
    propiasBloqueadas,
    bloqueado: propias.length ? propiasBloqueadas.length > 0 : bloqueadas.length > 0,
  };
}
