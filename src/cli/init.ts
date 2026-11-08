// `emdash-modo-liga init`: crea la carpeta del espejo (base directory del sitio
// de Netlify) con su package.json mínimo, netlify.toml, build.sh y un README con
// la lista de pasos manuales. No toca nada fuera de esa carpeta.
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { generarNetlifyToml, type OpcionesToml } from "./netlify.ts";
import type { ModoEspejo } from "./crawl.ts";

export interface OpcionesInit {
  carpeta: string;
  dominio: string;
  origenHost?: string;
  modo?: ModoEspejo;
  excluir?: string[];
  proxiar?: string[];
  parametrosQuery?: string[];
  versionPaquete: string;
  /** Especificador de la dependencia en espejo/package.json (por defecto `^<versión>` de npm; p. ej. `github:usuario/emdash-modo-liga`). */
  paquete?: string;
  /** Ruta al directorio `plantillas/` del paquete. */
  plantillas: string;
  forzar?: boolean;
}

export async function init(o: OpcionesInit): Promise<string[]> {
  const origenHost = o.origenHost ?? `origen.${o.dominio}`;
  const modo = o.modo ?? "copia-y-proxy";
  const toml: OpcionesToml = { dominio: o.dominio, origenHost, modo, ...(o.excluir ? { excluir: o.excluir } : {}), ...(o.proxiar ? { proxiar: o.proxiar } : {}), ...(o.parametrosQuery ? { parametrosQuery: o.parametrosQuery } : {}) };
  await mkdir(o.carpeta, { recursive: true });
  const escritos: string[] = [];
  const escribir = async (nombre: string, contenido: string) => {
    const destino = join(o.carpeta, nombre);
    if (!o.forzar) {
      try {
        await access(destino);
        return; // no se pisa lo que ya existe
      } catch {
        // no existe
      }
    }
    await writeFile(destino, contenido);
    escritos.push(destino);
  };
  await escribir("netlify.toml", generarNetlifyToml(toml));
  await escribir("build.sh", await readFile(join(o.plantillas, "build.sh"), "utf8"));
  await escribir("secretos.sh", await readFile(join(o.plantillas, "secretos.sh"), "utf8"));
  await escribir("token-cf.sh", await readFile(join(o.plantillas, "token-cf.sh"), "utf8"));
  await escribir(
    "package.json",
    JSON.stringify(
      {
        name: `espejo-${o.dominio.replace(/[^a-z0-9]+/gi, "-")}`,
        private: true,
        type: "module",
        description: `Espejo de ${o.dominio} para el modo liga (emdash-modo-liga).`,
        scripts: { build: "bash build.sh" },
        devDependencies: { "emdash-modo-liga": o.paquete ?? `^${o.versionPaquete}` },
      },
      null,
      2,
    ) + "\n",
  );
  await escribir(".gitignore", "publico/\nnode_modules/\n.netlify/\n");
  await escribir(
    "README.md",
    `# Espejo de ${o.dominio}

Carpeta que Netlify construye (base directory) para servir ${o.dominio} durante los partidos de LaLiga.
La genera \`emdash-modo-liga init\`; los pasos manuales están en la documentación del plugin:

1. Crear el sitio en Netlify enlazado a este repositorio con **base directory** \`${o.carpeta}\`
   (build: \`bash build.sh\`, publish: \`publico\`). Desactivar la protección SSO del equipo si la hay.
2. Domain management: añadir \`${o.dominio}\` y \`www.${o.dominio}\` como dominios propios. Netlify avisará
   de que el DNS no apunta allí: es lo esperado.
3. Variables de entorno del sitio (Site configuration → Environment variables): \`ESPEJO_FIRMA\` con **todos los
   ámbitos** (Builds y Runtime), mismo valor que el secreto \`MODO_LIGA_FIRMA\` del Worker. Las no secretas
   (\`MODO_LIGA_ORIGEN\`, \`MODO_LIGA_SITIO\`, \`MODO_LIGA_MODO\`, \`NODE_VERSION\`) ya van en \`netlify.toml\`.
   Para el certificado mensual: \`CF_Token\`, \`CF_Zone_ID\`, \`NETLIFY_AUTH_TOKEN\`, \`NETLIFY_SITE_ID\`.
   Sin \`ESPEJO_FIRMA\` el build publica solo la página de aviso y deja todo lo demás en proxy al origen.
   Atajo: \`bash ${o.carpeta}/secretos.sh <Project ID>\` genera el secreto y lo guarda en el Worker y en Netlify
   sin mostrarlo (necesita \`npx wrangler login\` y \`npx netlify login\`).
4. Build hooks: crear uno y guardarlo en el Worker: \`npx wrangler secret put MODO_LIGA_BUILD_HOOK\` (pegar la URL).
5. Token de API de Cloudflare (dash.cloudflare.com/profile/api-tokens → Create Token → Custom): permisos
   **Zone → DNS → Edit** y **Zone → Zone → Read**, limitado a la zona \`${o.dominio}\`. Guárdalo en un fichero
   solo tuyo (\`umask 077; pbpaste > ~/.cf-token\` o pégalo en un editor) y nunca en el repositorio.
   \`bash ${o.carpeta}/token-cf.sh ~/.cf-token [<Project ID> <Zone ID>]\` lo guarda en el Worker (\`MODO_LIGA_CF_TOKEN\`)
   y, con los dos argumentos extra, en Netlify (\`CF_Token\`, \`CF_Zone_ID\`) para el certificado, sin mostrarlo.
6. Registros DNS normales (CNAME con proxy al espejo), con el mismo token:
   \`npx emdash-modo-liga dns --dominio ${o.dominio} --espejo <sitio>.netlify.app --token-fichero ~/.cf-token\`
   muestra el plan; con \`--aplicar\` lo ejecuta. Si el apex o \`www\` eran *Custom Domains* del Worker, antes
   cámbialos en \`wrangler.jsonc\` por rutas de zona (\`{ "pattern": "${o.dominio}/*", "zone_name": "${o.dominio}" }\`),
   despliega y, acto seguido, ejecuta el comando: entre ambos pasos el dominio queda unos segundos sin registro.
7. Lanzar un primer deploy y una vez la tarea \`cert\` (\`curl -X POST -d '{"tarea":"cert"}' <build hook>\`).
`,
  );
  return escritos;
}
