// DNS: el registro "normal" del dominio es un registro con proxy de Cloudflare
// (CNAME al espejo si el sitio es un Worker con `routes`; A/CNAME al origen si
// la estrategia es proxy-off). En modo liga el MISMO registro pasa a DNS only
// con TTL corto: solo cambian `proxied` y `ttl`. Idempotente. Módulo puro.

export interface EstadoRegistro {
  type: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

export interface RegistroDns extends EstadoRegistro {
  id: string;
  name: string;
}

export interface DriverDns {
  leer(nombre: string): Promise<RegistroDns[]>;
  actualizar(id: string, cambios: Partial<EstadoRegistro>): Promise<void>;
}

/** Lo que necesita la CLI `dns` para dar de alta los registros normales. */
export interface DriverDnsCompleto extends DriverDns {
  crear(nombre: string, estado: EstadoRegistro): Promise<void>;
  borrar(id: string): Promise<void>;
}

export const TTL_LIGA = 60;
/** Con proxy, Cloudflare devuelve siempre ttl 1 (automático). */
export const TTL_AUTO = 1;
const TIPOS_VALIDOS = new Set(["A", "AAAA", "CNAME"]);

export function deseado(normal: EstadoRegistro, dentro: boolean, ttlLiga = TTL_LIGA): EstadoRegistro {
  return dentro
    ? { type: normal.type, content: normal.content, proxied: false, ttl: ttlLiga }
    : { type: normal.type, content: normal.content, proxied: true, ttl: TTL_AUTO };
}

export function igual(a: EstadoRegistro, b: EstadoRegistro): boolean {
  return a.type === b.type && a.content.toLowerCase() === b.content.toLowerCase() && a.proxied === b.proxied && (a.proxied || a.ttl === b.ttl);
}

/** Un registro vale como "normal" solo si está detrás del proxy de Cloudflare. */
export function esNormalValido(r: EstadoRegistro): boolean {
  return r.proxied === true && TIPOS_VALIDOS.has(r.type);
}

export interface CambioDns {
  nombre: string;
  cambiado: boolean;
  estado: EstadoRegistro;
}

export type Normales = Record<string, EstadoRegistro>;

/** Lee los registros de `nombres` y devuelve los que sirven como normal; el resto va en `problemas`. */
export async function capturarNormales(driver: DriverDns, nombres: string[]): Promise<{ normales: Normales; problemas: string[] }> {
  const normales: Normales = {};
  const problemas: string[] = [];
  for (const nombre of nombres) {
    const registros = (await driver.leer(nombre)).filter((r) => TIPOS_VALIDOS.has(r.type));
    if (registros.length !== 1) {
      problemas.push(`${nombre}: se esperaba un registro A/AAAA/CNAME y hay ${registros.length}`);
      continue;
    }
    const r = registros[0]!;
    if (!esNormalValido(r)) {
      problemas.push(`${nombre}: el registro no está detrás del proxy de Cloudflare (¿modo liga activo o configuración incompleta?); no se captura`);
      continue;
    }
    normales[nombre] = { type: r.type, content: r.content, proxied: true, ttl: TTL_AUTO };
  }
  return { normales, problemas };
}

/** Pone cada registro en el estado que toca. Solo hace PATCH de los que difieren. */
export async function aplicar(driver: DriverDns, normales: Normales, dentro: boolean, ttlLiga = TTL_LIGA): Promise<CambioDns[]> {
  const cambios: CambioDns[] = [];
  for (const [nombre, normal] of Object.entries(normales)) {
    const objetivo = deseado(normal, dentro, ttlLiga);
    const registros = (await driver.leer(nombre)).filter((r) => r.type === normal.type);
    if (registros.length !== 1) throw new Error(`${nombre}: se esperaba un registro ${normal.type} y hay ${registros.length}`);
    const actual = registros[0]!;
    if (igual(actual, objetivo)) {
      cambios.push({ nombre, cambiado: false, estado: objetivo });
      continue;
    }
    await driver.actualizar(actual.id, { proxied: objetivo.proxied, ttl: objetivo.ttl });
    cambios.push({ nombre, cambiado: true, estado: objetivo });
  }
  return cambios;
}

/** ¿Están todos los registros en el estado que corresponde a `dentro`? */
export async function comprobar(driver: DriverDns, normales: Normales, dentro: boolean, ttlLiga = TTL_LIGA): Promise<boolean> {
  for (const [nombre, normal] of Object.entries(normales)) {
    const registros = (await driver.leer(nombre)).filter((r) => r.type === normal.type);
    if (registros.length !== 1 || !igual(registros[0]!, deseado(normal, dentro, ttlLiga))) return false;
  }
  return true;
}

// ── Alta del registro normal (CLI `dns`) ─────────────────────────────────────

export type AccionNormal =
  | { nombre: string; accion: "nada"; registro: RegistroDns }
  | { nombre: string; accion: "crear" }
  | { nombre: string; accion: "actualizar"; registro: RegistroDns; cambios: Partial<EstadoRegistro> }
  | { nombre: string; accion: "reemplazar"; borrar: RegistroDns[] }
  | { nombre: string; accion: "conflicto"; registros: RegistroDns[]; motivo: string };

/**
 * Plan para dejar `nombre` con un único `CNAME → espejo` con proxy (el registro normal). Puro.
 * Sin `reemplazar`, cualquier registro distinto es un conflicto y no se toca nada.
 */
export function planificarNormal(nombre: string, existentes: RegistroDns[], espejo: string, reemplazar = false): AccionNormal {
  const registros = existentes.filter((r) => r.name.toLowerCase() === nombre.toLowerCase() && TIPOS_VALIDOS.has(r.type));
  if (registros.length === 0) return { nombre, accion: "crear" };
  const r = registros[0]!;
  if (registros.length === 1 && r.type === "CNAME") {
    if (r.content.toLowerCase() === espejo.toLowerCase()) {
      return r.proxied ? { nombre, accion: "nada", registro: r } : { nombre, accion: "actualizar", registro: r, cambios: { proxied: true, ttl: TTL_AUTO } };
    }
    if (reemplazar) return { nombre, accion: "actualizar", registro: r, cambios: { content: espejo, proxied: true, ttl: TTL_AUTO } };
    return { nombre, accion: "conflicto", registros, motivo: `ya hay un CNAME a ${r.content}` };
  }
  if (reemplazar) return { nombre, accion: "reemplazar", borrar: registros };
  return { nombre, accion: "conflicto", registros, motivo: `hay ${registros.length} registro(s): ${registros.map((x) => `${x.type} ${x.content}`).join(", ")}` };
}

export interface ResultadoNormales {
  plan: AccionNormal[];
  aplicado: boolean;
}

/**
 * Deja cada nombre con su `CNAME → espejo` proxied. Planifica todo antes de tocar nada:
 * con un conflicto (o sin `aplicar`) no se ejecuta ningún cambio.
 */
export async function establecerNormales(
  driver: DriverDnsCompleto,
  nombres: string[],
  espejo: string,
  opciones: { aplicar?: boolean; reemplazar?: boolean } = {},
): Promise<ResultadoNormales> {
  const plan: AccionNormal[] = [];
  for (const nombre of nombres) plan.push(planificarNormal(nombre, await driver.leer(nombre), espejo, opciones.reemplazar ?? false));
  if (!opciones.aplicar || plan.some((p) => p.accion === "conflicto")) return { plan, aplicado: false };
  const normal: EstadoRegistro = { type: "CNAME", content: espejo, proxied: true, ttl: TTL_AUTO };
  for (const p of plan) {
    if (p.accion === "crear") await driver.crear(p.nombre, normal);
    else if (p.accion === "actualizar") await driver.actualizar(p.registro.id, p.cambios);
    else if (p.accion === "reemplazar") {
      for (const r of p.borrar) await driver.borrar(r.id);
      await driver.crear(p.nombre, normal);
    }
  }
  return { plan, aplicado: true };
}

export function describirAccion(p: AccionNormal, espejo: string): string {
  switch (p.accion) {
    case "nada": return `${p.nombre}: ya es CNAME → ${espejo} con proxy; nada que hacer`;
    case "crear": return `${p.nombre}: crear CNAME → ${espejo} (proxied)`;
    case "actualizar": return `${p.nombre}: actualizar el ${p.registro.type} existente con ${JSON.stringify(p.cambios)}`;
    case "reemplazar": return `${p.nombre}: borrar ${p.borrar.map((r) => `${r.type} ${r.content}`).join(", ")} y crear CNAME → ${espejo} (proxied)`;
    case "conflicto": return `${p.nombre}: CONFLICTO, ${p.motivo}`;
  }
}

// ── Driver de Cloudflare ─────────────────────────────────────────────────────

const API_CLOUDFLARE = "https://api.cloudflare.com/client/v4";

interface RespuestaApi<T> {
  success: boolean;
  errors?: { message: string }[];
  result: T;
}

export function driverCloudflare(zonaId: string, token: string, fetchFn: typeof fetch = fetch): DriverDnsCompleto {
  async function llamar<T>(ruta: string, init: RequestInit = {}): Promise<T> {
    const r = await fetchFn(`${API_CLOUDFLARE}${ruta}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const datos = (await r.json()) as RespuestaApi<T>;
    if (!r.ok || !datos.success) {
      throw new Error(`API de Cloudflare ${ruta}: ${r.status} ${datos.errors?.map((e) => e.message).join("; ") ?? ""}`);
    }
    return datos.result;
  }
  return {
    async leer(nombre) {
      const r = await llamar<RegistroDns[]>(`/zones/${zonaId}/dns_records?name=${encodeURIComponent(nombre)}`);
      return r.map((x) => ({ id: x.id, name: x.name, type: x.type, content: x.content, proxied: Boolean(x.proxied), ttl: x.ttl }));
    },
    async actualizar(id, cambios) {
      await llamar(`/zones/${zonaId}/dns_records/${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
    },
    async crear(nombre, estado) {
      await llamar(`/zones/${zonaId}/dns_records`, {
        method: "POST",
        body: JSON.stringify({ type: estado.type, name: nombre, content: estado.content, proxied: estado.proxied, ttl: estado.ttl }),
      });
    },
    async borrar(id) {
      await llamar(`/zones/${zonaId}/dns_records/${id}`, { method: "DELETE" });
    },
  };
}

/** Zone ID a partir del nombre de la zona. Necesita Zone → Zone → Read; si el token no lo tiene, pásale el id a mano. */
export async function zonaPorNombre(dominio: string, token: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const r = await fetchFn(`${API_CLOUDFLARE}/zones?name=${encodeURIComponent(dominio)}&status=active`, { headers: { Authorization: `Bearer ${token}` } });
  const datos = (await r.json()) as RespuestaApi<{ id: string }[]>;
  if (!r.ok || !datos.success) {
    throw new Error(`API de Cloudflare /zones: ${r.status} ${datos.errors?.map((e) => e.message).join("; ") ?? ""} (el token necesita Zone → Zone → Read, o indica el Zone ID)`);
  }
  const zona = datos.result[0];
  if (!zona) throw new Error(`No hay ninguna zona activa llamada ${dominio} accesible con ese token`);
  return zona.id;
}
