// Fragmento de página: el estado ya resuelto va dentro del HTML como JSON
// (sin fetch en el cliente) y un script pequeño pinta el aviso. El crawler
// sustituye ese JSON por uno con `espejo: true`.
import type { PluginContext } from "emdash";
import { rellenar, urlPublicarEnX } from "../core/aviso.ts";
import { ventanasDe, ventanaActual, proximaVentana, ventanasVigentes } from "../core/ventanas.ts";
import { iniciosDe } from "../core/horarios/index.ts";
import { leerConfig, type Config, type OpcionesModoLiga } from "./config.ts";
import { leerEstado, type Estado } from "./estado.ts";

export const ID_JSON = "modo-liga-estado";

export interface EstadoPublico {
  activo: boolean;
  espejo: boolean;
  motivo: string;
  proxima: string | null;
  ventana: { inicio: string; fin: string } | null;
  sitio: string;
  textos: { antes: string; durante: string; espejo: string };
  aviso: { titulo: string; encabezado: string; explicacion: string; consecuencia: string; llamada: string; boton: string };
  x: string;
  avisoUrl: string | null;
  generado: string;
}

export function estadoPublicoDe(estado: Estado, c: Config, ahora: number, espejo = false): EstadoPublico {
  const vars = { sitio: c.dominio, url: `https://${c.dominio}` };
  const ventanas = ventanasVigentes(ventanasDe(iniciosDe(estado.partidos), { antesMs: c.antesMs, despuesMs: c.despuesMs }), ahora);
  const actual = ventanaActual(ventanas, ahora);
  const proxima = proximaVentana(ventanas, ahora);
  return {
    activo: estado.decision.dentro,
    espejo,
    motivo: estado.motivo,
    proxima: proxima ? new Date(proxima.inicio).toISOString() : null,
    ventana: actual ? { inicio: new Date(actual.inicio).toISOString(), fin: new Date(actual.fin).toISOString() } : null,
    sitio: c.dominio,
    textos: {
      antes: rellenar(c.textos.bannerAntes, vars),
      durante: rellenar(c.textos.bannerDurante, vars),
      espejo: rellenar(c.textos.bannerEspejo, vars),
    },
    aviso: {
      titulo: rellenar(c.textos.titulo, vars),
      encabezado: rellenar(c.textos.encabezado, vars),
      explicacion: rellenar(c.textos.explicacion, vars),
      consecuencia: rellenar(c.textos.consecuencia, vars),
      llamada: rellenar(c.textos.llamada, vars),
      boton: rellenar(c.textos.boton, vars),
    },
    x: urlPublicarEnX(rellenar(c.textos.textoX, vars)),
    avisoUrl: c.rutaAviso,
    generado: new Date(ahora).toISOString(),
  };
}

/** Script del banner. Sin dependencias; respeta prefers-reduced-motion y se puede cerrar por sesión. */
export const SCRIPT_BANNER = `(function(){try{var n=document.getElementById(${JSON.stringify(ID_JSON)});if(!n)return;var e=JSON.parse(n.textContent||"{}");var t=null;if(e.espejo)t=e.textos.espejo;else if(e.activo)t=e.textos.durante;else if(e.proxima&&new Date(e.proxima).getTime()-Date.now()<72e5)t=e.textos.antes;if(!t)return;var k="modo-liga-cerrado:"+(e.espejo?"espejo":e.activo?"durante":"antes");try{if(sessionStorage.getItem(k))return}catch(_){}
var b=document.createElement("div");b.setAttribute("role","status");b.id="modo-liga-banner";b.style.cssText="position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;gap:.75rem;align-items:center;justify-content:center;flex-wrap:wrap;padding:.6rem 1rem;font:14px/1.4 system-ui,sans-serif;background:var(--color-surface,#fff);color:var(--color-text,#111);border-top:1px solid var(--color-border,#ddd);box-shadow:0 -2px 12px rgba(0,0,0,.08)";
var s=document.createElement("span");s.textContent=t;b.appendChild(s);
var x=document.createElement("a");x.href=e.x;x.target="_blank";x.rel="noopener";x.textContent="Quejarse en X";x.style.cssText="font-weight:600;color:inherit;text-decoration:underline";b.appendChild(x);
if(e.avisoUrl){var q=document.createElement("a");q.href=e.avisoUrl;q.textContent="¿Qué pasa?";q.style.cssText="color:inherit;text-decoration:underline";b.appendChild(q)}
var c=document.createElement("button");c.type="button";c.setAttribute("aria-label","Cerrar aviso");c.textContent="\\u00d7";c.style.cssText="margin-left:.5rem;border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:inherit";c.onclick=function(){b.remove();try{sessionStorage.setItem(k,"1")}catch(_){}};b.appendChild(c);
document.body.appendChild(b)}catch(_){}})();`;

const CACHE_MS = 60_000;
let cache: { at: number; html: string } | null = null;

export function etiquetaJson(estado: EstadoPublico): string {
  return `<script type="application/json" id="${ID_JSON}">${JSON.stringify(estado).replace(/</g, "\\u003c")}</script>`;
}

export async function fragmentosDePagina(ctx: Pick<PluginContext, "kv" | "settings" | "site">, opciones: OpcionesModoLiga, ahora = Date.now()) {
  if (!cache || ahora - cache.at > CACHE_MS) {
    const c = await leerConfig(ctx, opciones);
    if (!c.banner) {
      cache = { at: ahora, html: "" };
    } else {
      const estado = await leerEstado(ctx.kv);
      cache = { at: ahora, html: etiquetaJson(estadoPublicoDe(estado, c, ahora)) };
    }
  }
  if (!cache.html) return null;
  return [
    { kind: "html" as const, placement: "body:end" as const, html: cache.html, key: "modo-liga-estado" },
    { kind: "inline-script" as const, placement: "body:end" as const, code: SCRIPT_BANNER, key: "modo-liga-banner" },
  ];
}

export function olvidarCache(): void {
  cache = null;
}
