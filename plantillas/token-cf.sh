#!/usr/bin/env bash
# Guarda el token de API de Cloudflare del modo liga sin que pase por la pantalla ni por el historial:
# lo lee de un fichero y lo mete como secreto del Worker (MODO_LIGA_CF_TOKEN) y, si se indican el sitio
# y la zona, en Netlify (CF_Token y CF_Zone_ID, para renovar el certificado desde el build).
#
# El token se crea en dash.cloudflare.com/profile/api-tokens (Create Token → Custom) con los permisos
# Zone → DNS → Edit y Zone → Zone → Read, limitado a la zona del sitio. Guárdalo en un fichero solo tuyo
# (umask 077) fuera del repositorio.
#
# Requisitos: wrangler autenticado (npx wrangler login) y, para Netlify, Netlify CLI autenticada
# (npx netlify-cli login). Se ejecuta desde la raíz del repositorio del sitio (donde está wrangler.jsonc).
#
# Uso: bash espejo/token-cf.sh <fichero-con-el-token> [<Project ID de Netlify> <Zone ID>]
set -euo pipefail

FICHERO="${1:?Falta la ruta del fichero con el token}"
TOKEN=$(tr -d '[:space:]' < "$FICHERO")
[ -n "$TOKEN" ] || { echo "El fichero $FICHERO está vacío" >&2; exit 1; }

printf '%s' "$TOKEN" | npx wrangler secret put MODO_LIGA_CF_TOKEN
if [ -n "${2:-}" ]; then
  ZONA="${3:?Falta el Zone ID (tercer argumento)}"
  NETLIFY_SITE_ID="$2" npx netlify-cli env:set CF_Token "$TOKEN" --secret >/dev/null 2>&1 \
    || NETLIFY_SITE_ID="$2" npx netlify-cli env:set CF_Token "$TOKEN" >/dev/null
  NETLIFY_SITE_ID="$2" npx netlify-cli env:set CF_Zone_ID "$ZONA" >/dev/null
fi
echo "Token guardado en el Worker (MODO_LIGA_CF_TOKEN)${2:+ y en Netlify (CF_Token, CF_Zone_ID)}."
