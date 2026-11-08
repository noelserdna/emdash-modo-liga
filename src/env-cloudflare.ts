// Reexporta el entorno del Worker. Vive en un módulo propio para que
// `cloudflare:workers` solo se resuelva donde existe (patrón de
// @emdash-cms/cloudflare/plugins/cloudflare-email-env).
export { env } from "cloudflare:workers";
