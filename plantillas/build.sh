#!/usr/bin/env bash
# Build del espejo en Netlify (emdash-modo-liga). El plugin dispara el build hook
# con un cuerpo JSON {"tarea":"crawl"} o {"tarea":"cert"}; Netlify lo deja en
# INCOMING_HOOK_BODY. Sin cuerpo (deploy manual o por git) se hace la copia.
#
# Variables del sitio en Netlify (Build):
#   MODO_LIGA_ORIGEN   https://origen.<dominio>        (custom domain del Worker)
#   MODO_LIGA_SITIO    https://<dominio>
#   MODO_LIGA_FIRMA    secreto compartido con el Worker (el mismo que ESPEJO_FIRMA)
#   MODO_LIGA_MODO     copia-y-proxy | proxy-total | solo-copia   (opcional)
# Para la tarea cert, además:
#   CF_Token, CF_Zone_ID (token Zone→DNS→Edit), NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID
set -euo pipefail

TAREA="crawl"
if [ -n "${INCOMING_HOOK_BODY:-}" ]; then
  TAREA=$(printf '%s' "$INCOMING_HOOK_BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(decodeURIComponent(s)).tarea||"crawl")}catch{try{console.log(JSON.parse(s).tarea||"crawl")}catch{console.log("crawl")}}})')
fi
echo "modo-liga: tarea=$TAREA"

copia() {
  npx emdash-modo-liga crawl \
    --origen "$MODO_LIGA_ORIGEN" --sitio "$MODO_LIGA_SITIO" \
    --modo "${MODO_LIGA_MODO:-copia-y-proxy}" --salida publico
}

certificado() {
  : "${CF_Token:?falta CF_Token}" "${CF_Zone_ID:?falta CF_Zone_ID}" "${NETLIFY_AUTH_TOKEN:?falta NETLIFY_AUTH_TOKEN}" "${NETLIFY_SITE_ID:?falta NETLIFY_SITE_ID}"
  DOMINIO=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$MODO_LIGA_SITIO")
  curl -fsSL https://github.com/acmesh-official/acme.sh/archive/refs/tags/3.1.0.tar.gz | tar xz
  (cd acme.sh-3.1.0 && ./acme.sh --home "$HOME/.acme.sh" --issue --server letsencrypt --dns dns_cf \
      -d "$DOMINIO" -d "www.$DOMINIO" --keylength ec-256 --force)
  D="$HOME/.acme.sh/${DOMINIO}_ecc"
  node -e '
    const fs=require("fs");const [d,site]=process.argv.slice(1);const dom=d.split("/").pop().replace(/_ecc$/,"");
    const datos={site_id:site,certificate:fs.readFileSync(`${d}/${dom}.cer`,"utf8"),key:fs.readFileSync(`${d}/${dom}.key`,"utf8"),ca_certificates:fs.readFileSync(`${d}/ca.cer`,"utf8")};
    fetch(`https://api.netlify.com/api/v1/sites/${site}/ssl`,{method:"POST",headers:{authorization:`Bearer ${process.env.NETLIFY_AUTH_TOKEN}`,"content-type":"application/json"},body:JSON.stringify(datos)})
      .then(async r=>{console.log("provisionSiteTLSCertificate:",r.status);if(!r.ok){console.error(await r.text());process.exit(1)}});
  ' "$D" "$NETLIFY_SITE_ID"
  echo "Certificado subido."
  # El deploy necesita contenido: se reutiliza la copia anterior si existe, o se hace una nueva
  copia
}

case "$TAREA" in
  cert) certificado ;;
  *) copia ;;
esac
