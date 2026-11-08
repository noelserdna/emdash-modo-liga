# emdash-modo-liga

Plugin de [EmDash CMS](https://emdashcms.com) para que un sitio alojado en Cloudflare **siga en línea en España durante los partidos de LaLiga**, cuando las operadoras bloquean IPs compartidas de Cloudflare por orden judicial (sentencia 310/2024, vigente hasta ~junio de 2027).

[English summary](./README.en.md)

## Qué hace

```
Normal:    visitante ─▶ Cloudflare (CNAME proxied + routes) ─▶ Worker EmDash [plugin: cron, hooks, banner]
Modo liga: visitante ─▶ Netlify (mismo CNAME, DNS only, TTL 60)
                         ├─ copia estática del sitio (crawler)        ← prioridad
                         ├─ lo demás: proxy firmado ─▶ origen.<dominio> (Worker) → admin, búsqueda, MCP, login siguen funcionando
                         └─ /sin-acceso (aviso + «Publicar en X» mencionando a @LaLiga y @Cloudflare)
```

- **Calendario**: lee los horarios de Primera y Segunda (ESPN sin clave; football-data.org opcional; lista manual) y abre una ventana por partido (−30 min / +210 min por defecto; las que se solapan se unen).
- **Detección**: cruza las IPs del sitio con la lista de IPs bloqueadas de [hayahora.futbol](https://hayahora.futbol) para recortar la cola de las ventanas y reaccionar a bloqueos fuera de calendario (noches de Champions…). Política configurable: `ambas` (por defecto), `calendario` o `deteccion`.
- **DNS**: cambia los registros del dominio en Cloudflare entre *proxied* (normal) y *DNS only* (modo liga). Solo cambia `proxied` y `ttl`; nunca el contenido del registro.
- **Espejo**: dispara el *build hook* de Netlify cuando publicas contenido (con *debounce*), cada noche y el día 1 de cada mes para renovar el certificado. El crawler rastrea `origen.<dominio>` con una firma propia, así nunca copia el espejo.
- **Aviso**: un banner discreto en todas las páginas (antes del partido, durante el bloqueo y en la copia de emergencia) con el enlace para quejarse en X, y la página `/sin-acceso` en el espejo.
- **Admin y MCP**: formulario de settings en el admin de EmDash; herramientas MCP `modo-liga__estado`, `modo-liga__forzar`, `modo-liga__sincronizar` y `modo-liga__tick`.
- **Estrategia `proxy-off`**: si tu origen no es un Worker (tienes servidor propio detrás del proxy naranja), el mismo motor pasa los registros a *DNS only* hacia tu origen, sin espejo (como el plugin de WordPress *bypass-laligagate*).

## Requisitos

- EmDash ≥ 1.4 en Cloudflare Workers (adapter `@astrojs/cloudflare`). El plugin es *native/trusted*.
- La zona DNS del dominio en Cloudflare, con el Worker enganchado por **`routes`** (no por *Custom Domain* en el apex: esos registros no se pueden editar por API).
- Una cuenta de Netlify (plan Free basta) y un repositorio Git enlazado al sitio de Netlify.
- Token de Cloudflare con permiso **Zone → DNS → Edit** solo para esa zona.

## Instalación en el sitio

```bash
pnpm add emdash-modo-liga
```

`astro.config.mjs`:

```js
import { modoLiga } from "emdash-modo-liga";

emdash({
  // ...
  plugins: [
    modoLiga({ dominio: "ejemplo.es" }),   // el resto se configura en el admin
  ],
})
```

`src/worker.ts` (envuelve el handler de EmDash):

```ts
import handler, { createScheduledHandler } from "@emdash-cms/cloudflare/worker";
import { withModoLiga } from "emdash-modo-liga";

export default {
  ...withModoLiga(handler, { origenHost: "origen.ejemplo.es", canonicalHost: "ejemplo.es", siteUrlEspejo: "https://mi-espejo.netlify.app" }),
  scheduled: createScheduledHandler(),
} satisfies ExportedHandler;
```

`wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "ejemplo.es/*", "zone_name": "ejemplo.es" },
  { "pattern": "www.ejemplo.es/*", "zone_name": "ejemplo.es" },
  { "pattern": "origen.ejemplo.es", "custom_domain": true }
],
"triggers": { "crons": ["* * * * *"] }
```

DNS en Cloudflare (a mano, una vez): `CNAME ejemplo.es → mi-espejo.netlify.app` y `CNAME www → mi-espejo.netlify.app`, ambos **proxied** (nube naranja). Con las `routes`, el Worker atiende todas las peticiones; el CNAME solo importa cuando se quita el proxy.

Secretos del Worker:

```bash
openssl rand -base64 32 | wrangler secret put MODO_LIGA_FIRMA        # el mismo valor va a Netlify como ESPEJO_FIRMA
wrangler secret put MODO_LIGA_CF_TOKEN                               # Zone→DNS→Edit
wrangler secret put MODO_LIGA_BUILD_HOOK                             # URL del build hook de Netlify
wrangler secret put MODO_LIGA_FOOTBALL_DATA_TOKEN                    # opcional
```

## El espejo en Netlify

```bash
npx emdash-modo-liga init --dominio ejemplo.es            # crea espejo/ con netlify.toml, build.sh, package.json y README
```

Después, en Netlify: sitio nuevo enlazado al repo con *base directory* `espejo`, dominios `ejemplo.es` y `www.ejemplo.es` (avisará de que el DNS no apunta: es lo esperado), la variable de entorno `ESPEJO_FIRMA` con todos los ámbitos (las no secretas ya van en `netlify.toml`), un build hook, y desactivar la protección SSO del equipo. Todo está en `espejo/README.md`.

Modos del espejo (`--modo`): `copia-y-proxy` (por defecto; copia estática y lo demás al origen), `proxy-total` (sin copia; todo al origen; para webs complejas) y `solo-copia` (sin exponer el origen; lo dinámico va a `/sin-acceso`).

Como alternativa a los build hooks, `plantillas/espejo.yml` y `plantillas/espejo-cert.yml` hacen lo mismo desde GitHub Actions (driver `webhook`).

## Admin

En **Plugins → modo-liga** se configuran: forzado (`auto|on|off`), política, márgenes, estrategia, zona de Cloudflare, registros, fuentes y competiciones, detección, driver del espejo y textos del aviso y del banner. Los secretos nunca van en el admin.

## Comprobar

```bash
curl -s https://ejemplo.es/_emdash/api/plugins/modo-liga/estado | jq       # público
curl -sI https://origen.ejemplo.es/                                         # 404 sin firma
# Ensayo fuera de partido: forzar on desde el admin o con la tool MCP modo-liga__forzar; dig +short ejemplo.es
```

## Limitaciones conocidas

- Netlify no es inmune a los bloqueos (se quejó en mayo de 2025), pero no aparece en los datos de OONI de 2026. Si Netlify cae durante un partido, no hay plan C salvo un VPS (`driver: webhook`).
- Firebase Hosting, Vercel (no Enterprise) y GitHub Pages **no sirven** como espejo con cambio de DNS: no admiten certificado propio.
- Durante una ventana Google también ve el espejo. La copia conserva canonical, sitemap y robots.
- hayahora.futbol y la API de ESPN no tienen SLA. Ante un fallo se mantiene el último estado conocido.

## Créditos y fuentes

Nace del «modo liga» de [desarrollomcp.com](https://dev.to/noelserdna/bloqueos-de-laliga-a-cloudflare-como-seguimos-abiertos-con-mcp-4ing). Datos: [OONI, LaLiga collateral](https://ooni.org/post/2026-laliga-collateral), [hayahora.futbol](https://hayahora.futbol), [#LaLigaGate](https://laligagate.com). Licencia MIT.
