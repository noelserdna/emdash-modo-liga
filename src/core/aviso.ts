// Textos del aviso al visitante y publicación en X. Todo es plantilla con
// {sitio} y {url}; el dueño puede sustituirlos desde el admin.

export const TEXTO_X_POR_DEFECTO =
  "Hoy no puedo entrar en {sitio}: @LaLiga obliga a bloquear IPs de @Cloudflare durante los partidos y se lleva por delante webs legales. Bloquear a todos por el fútbol no está bien.";

export interface Textos {
  titulo: string;
  encabezado: string;
  explicacion: string;
  consecuencia: string;
  llamada: string;
  boton: string;
  textoX: string;
  bannerAntes: string;
  bannerDurante: string;
  bannerEspejo: string;
}

export const TEXTOS_POR_DEFECTO: Textos = {
  titulo: "Hoy hay fútbol: acceso limitado",
  encabezado: "Hoy hay fútbol y puede que no llegues a {sitio}",
  explicacion:
    "Mientras dura un partido de LaLiga, las operadoras españolas bloquean direcciones de Cloudflare por una orden judicial que pidió LaLiga. {sitio} funciona sobre Cloudflare y queda bloqueada junto con muchas otras webs legales.",
  consecuencia:
    "Para no dejarte sin nada, durante los partidos servimos una copia de la web desde otro sitio. Algunas funciones pueden no estar disponibles hasta que termine el bloqueo.",
  llamada: "¿Te parece mal? A nosotros también. Cuéntalo en X: el mensaje ya va escrito, solo tienes que publicarlo.",
  boton: "Publicar en X",
  textoX: TEXTO_X_POR_DEFECTO,
  bannerAntes: "Hoy hay partido de LaLiga: si esta web deja de cargar, es por los bloqueos a Cloudflare. Volveremos en cuanto termine.",
  bannerDurante: "Estamos en horario de bloqueo por el fútbol. Si algo no carga, no es cosa tuya.",
  bannerEspejo: "Estás viendo la copia de emergencia de {sitio} mientras dura el bloqueo de LaLiga.",
};

export function rellenar(plantilla: string, variables: Record<string, string>): string {
  return plantilla.replace(/\{(\w+)\}/g, (m, k: string) => variables[k] ?? m);
}

export function urlPublicarEnX(texto: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(texto)}`;
}

/** Longitud según X: cada URL cuenta 23 caracteres. */
export function longitudEnX(texto: string): number {
  const sinUrls = texto.replace(/https?:\/\/\S+|\b[\w-]+(\.[\w-]+)+\b(\/\S*)?/g, "x".repeat(23));
  return [...sinUrls].length;
}

export function cabeEnX(texto: string): boolean {
  return longitudEnX(texto) <= 280;
}
