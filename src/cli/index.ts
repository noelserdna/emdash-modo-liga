#!/usr/bin/env node
// CLI: emdash-modo-liga crawl | init | dns | netlify-toml | aviso
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { crawl, paginaAviso, cabeceras, type ModoEspejo } from "./crawl.ts";
import { init } from "./init.ts";
import { generarNetlifyToml } from "./netlify.ts";
import { describirAccion, driverCloudflare, establecerNormales, zonaPorNombre } from "../core/dns.ts";

const aqui = dirname(fileURLToPath(import.meta.url));
const raizPaquete = resolve(aqui, "..", "..");
const version = (JSON.parse(readFileSync(join(raizPaquete, "package.json"), "utf8")) as { version: string }).version;

const AYUDA = `emdash-modo-liga ${version}

  emdash-modo-liga crawl --origen https://origen.ejemplo.es --sitio https://ejemplo.es [--salida publico]
                         [--modo copia-y-proxy|proxy-total|solo-copia] [--extra /ruta,/otra] [--query cursor,page]
                         [--max-query 50] [--concurrencia 4] [--secreto-env MODO_LIGA_FIRMA]
  emdash-modo-liga init  --dominio ejemplo.es [--origen origen.ejemplo.es] [--carpeta espejo] [--modo ...]
                         [--excluir /ruta,/otra] [--proxiar /prefijo] [--query cursor,page,q] [--forzar]
                         [--paquete github:usuario/emdash-modo-liga]
  emdash-modo-liga dns   --dominio ejemplo.es --espejo mi-espejo.netlify.app [--registros ejemplo.es,www.ejemplo.es]
                         [--zona <Zone ID>] [--aplicar] [--reemplazar] [--token-env CLOUDFLARE_API_TOKEN | --token-fichero ruta]
                         (deja los registros "normales": CNAME al espejo con proxy; sin --aplicar solo muestra el plan)
  emdash-modo-liga aviso --sitio https://ejemplo.es [--salida publico]      (solo la página /sin-acceso, sin copia)
  emdash-modo-liga netlify-toml --dominio ejemplo.es [--origen origen.ejemplo.es] [--modo ...] [--excluir ...]
`;

const lista = (v: string | undefined): string[] | undefined => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const modoDe = (v: string | undefined): ModoEspejo => (v === "proxy-total" || v === "solo-copia" ? v : "copia-y-proxy");

async function main(argv: string[]): Promise<number> {
  const [comando, ...resto] = argv;
  const { values } = parseArgs({
    args: resto,
    options: {
      origen: { type: "string" }, sitio: { type: "string" }, salida: { type: "string", default: "publico" }, modo: { type: "string" },
      extra: { type: "string" }, query: { type: "string" }, "max-query": { type: "string" }, concurrencia: { type: "string" }, "secreto-env": { type: "string", default: "MODO_LIGA_FIRMA" },
      dominio: { type: "string" }, carpeta: { type: "string", default: "espejo" }, excluir: { type: "string" }, proxiar: { type: "string" }, forzar: { type: "boolean", default: false }, paquete: { type: "string" },
      espejo: { type: "string" }, registros: { type: "string" }, zona: { type: "string" }, aplicar: { type: "boolean", default: false }, reemplazar: { type: "boolean", default: false },
      "token-env": { type: "string", default: "CLOUDFLARE_API_TOKEN" }, "token-fichero": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (!comando || comando.startsWith("-") || values.help) {
    console.log(AYUDA);
    return comando && !comando.startsWith("-") ? 0 : comando ? 0 : 1;
  }
  if (comando === "crawl") {
    if (!values.origen || !values.sitio) throw new Error("Faltan --origen y --sitio");
    const secreto = process.env[values["secreto-env"]!];
    if (!secreto) throw new Error(`Falta la variable de entorno ${values["secreto-env"]} con el secreto compartido`);
    const r = await crawl({
      origen: values.origen, sitio: values.sitio, salida: values.salida!, secreto, modo: modoDe(values.modo),
      ...(lista(values.extra) ? { extras: lista(values.extra)! } : {}),
      ...(lista(values.query) ? { parametrosQuery: lista(values.query)! } : {}),
      ...(values["max-query"] ? { maxPaginasQuery: Number(values["max-query"]) } : {}),
      ...(values.concurrencia ? { concurrencia: Number(values.concurrencia) } : {}),
      log: (m) => console.log(m),
    });
    if (r.fallos.length) console.warn(`Fallos (${r.fallos.length}):\n  ${r.fallos.slice(0, 20).join("\n  ")}`);
    console.log(`Copia lista en ${values.salida}: ${r.paginas} páginas, ${r.archivos} archivos.`);
    return 0;
  }
  if (comando === "init") {
    if (!values.dominio) throw new Error("Falta --dominio");
    const escritos = await init({
      carpeta: values.carpeta!, dominio: values.dominio, versionPaquete: version, plantillas: join(raizPaquete, "plantillas"), modo: modoDe(values.modo), forzar: values.forzar!,
      ...(values.origen ? { origenHost: values.origen.replace(/^https?:\/\//, "") } : {}),
      ...(values.paquete ? { paquete: values.paquete } : {}),
      ...(lista(values.excluir) ? { excluir: lista(values.excluir)! } : {}),
      ...(lista(values.proxiar) ? { proxiar: lista(values.proxiar)! } : {}),
      ...(lista(values.query) ? { parametrosQuery: lista(values.query)! } : {}),
    });
    console.log(escritos.length ? `Escritos:\n  ${escritos.join("\n  ")}` : "Nada que escribir (ya existía todo; usa --forzar para sobrescribir).");
    console.log(`\nSiguiente: lee ${join(values.carpeta!, "README.md")} para los pasos en Netlify y Cloudflare.`);
    return 0;
  }
  if (comando === "dns") {
    if (!values.dominio || !values.espejo) throw new Error("Faltan --dominio y --espejo (host del sitio de Netlify, p. ej. mi-espejo.netlify.app)");
    const espejo = values.espejo.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const token = values["token-fichero"] ? readFileSync(values["token-fichero"], "utf8").trim() : process.env[values["token-env"]!];
    if (!token) throw new Error(`Falta el token de Cloudflare: variable ${values["token-env"]} o --token-fichero <ruta> (Zone → DNS → Edit y Zone → Zone → Read, solo esa zona)`);
    const nombres = lista(values.registros) ?? [values.dominio, `www.${values.dominio}`];
    const zona = values.zona ?? (await zonaPorNombre(values.dominio, token));
    const r = await establecerNormales(driverCloudflare(zona, token), nombres, espejo, { aplicar: values.aplicar!, reemplazar: values.reemplazar! });
    console.log(`Zona ${values.dominio}: ${zona}  (Zone ID para el ajuste «Id de la zona» del plugin)`);
    for (const p of r.plan) console.log(`  ${describirAccion(p, espejo)}`);
    if (r.plan.some((p) => p.accion === "conflicto")) {
      console.error(`\nHay conflictos: no se ha tocado nada. Revisa los registros o usa --reemplazar. Si el registro es el de un Custom Domain del Worker,\nquítalo antes: en wrangler.jsonc cambia esa entrada por { "pattern": "${values.dominio}/*", "zone_name": "${values.dominio}" }, despliega y repite este comando.`);
      return 1;
    }
    console.log(r.aplicado ? "\nRegistros aplicados. El plugin los capturará como estado normal en su próximo tick." : r.plan.every((p) => p.accion === "nada") ? "\nTodo en orden." : "\nSimulación: añade --aplicar para ejecutar el plan.");
    return 0;
  }
  if (comando === "aviso") {
    if (!values.sitio) throw new Error("Falta --sitio");
    await mkdir(values.salida!, { recursive: true });
    await writeFile(join(values.salida!, "sin-acceso.html"), paginaAviso(null, values.sitio));
    await writeFile(join(values.salida!, "_headers"), cabeceras());
    console.log(`Página de aviso escrita en ${values.salida}/sin-acceso.html (sin copia del sitio).`);
    return 0;
  }
  if (comando === "netlify-toml") {
    if (!values.dominio) throw new Error("Falta --dominio");
    process.stdout.write(generarNetlifyToml({
      dominio: values.dominio, origenHost: (values.origen ?? `origen.${values.dominio}`).replace(/^https?:\/\//, ""), modo: modoDe(values.modo),
      ...(lista(values.excluir) ? { excluir: lista(values.excluir)! } : {}),
      ...(lista(values.proxiar) ? { proxiar: lista(values.proxiar)! } : {}),
      ...(lista(values.query) ? { parametrosQuery: lista(values.query)! } : {}),
    }));
    return 0;
  }
  console.error(`Comando desconocido: ${comando}\n${AYUDA}`);
  return 1;
}

main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
