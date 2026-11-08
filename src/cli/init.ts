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
  await escribir(
    "package.json",
    JSON.stringify(
      {
        name: `espejo-${o.dominio.replace(/[^a-z0-9]+/gi, "-")}`,
        private: true,
        type: "module",
        description: `Espejo de ${o.dominio} para el modo liga (emdash-modo-liga).`,
        scripts: { build: "bash build.sh" },
        devDependencies: { "emdash-modo-liga": `^${o.versionPaquete}` },
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
3. Variables de entorno del sitio: \`ESPEJO_FIRMA\` (ámbito **Runtime**, mismo valor que el secreto
   \`MODO_LIGA_FIRMA\` del Worker), y para el build: \`MODO_LIGA_ORIGEN=https://${origenHost}\`,
   \`MODO_LIGA_SITIO=https://${o.dominio}\`, \`MODO_LIGA_FIRMA\`, \`MODO_LIGA_MODO=${modo}\`.
   Para el certificado mensual: \`CF_Token\`, \`CF_Zone_ID\`, \`NETLIFY_AUTH_TOKEN\`, \`NETLIFY_SITE_ID\`.
4. Build hooks: crear uno y guardarlo en el Worker como secreto \`MODO_LIGA_BUILD_HOOK\`.
5. Lanzar un primer deploy y una vez la tarea \`cert\` (\`curl -X POST -d '{"tarea":"cert"}' <build hook>\`).
`,
  );
  return escritos;
}
