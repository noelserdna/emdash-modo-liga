#!/usr/bin/env bash
# Crea el secreto compartido del modo liga y lo guarda a la vez en el Worker
# (MODO_LIGA_FIRMA) y en el sitio de Netlify (ESPEJO_FIRMA) sin mostrarlo por pantalla.
#
# Requisitos: wrangler autenticado (npx wrangler login) y Netlify CLI autenticada
# (npx netlify login). Se ejecuta desde la raíz del repositorio del sitio (donde está wrangler.jsonc).
#
# Uso: bash espejo/secretos.sh <id-del-sitio-de-netlify>
#      (Project configuration → General → Project details → Project ID)
set -euo pipefail

SITIO_NETLIFY="${1:?Falta el Project ID del sitio de Netlify}"
SECRETO=$(openssl rand -hex 32)

printf '%s' "$SECRETO" | npx wrangler secret put MODO_LIGA_FIRMA
NETLIFY_SITE_ID="$SITIO_NETLIFY" npx netlify env:set ESPEJO_FIRMA "$SECRETO" >/dev/null
echo "Secreto compartido guardado en el Worker (MODO_LIGA_FIRMA) y en Netlify (ESPEJO_FIRMA)."
echo "Lanza ahora un deploy en Netlify para que el espejo haga la primera copia."
