// Drivers del espejo: cómo se pide que se reconstruya la copia estática (o se
// renueve el certificado). El trabajo pesado corre fuera del Worker.

export type Tarea = "crawl" | "cert";

export interface ResultadoReconstruccion {
  ok: boolean;
  driver: string;
  tarea: Tarea;
  detalle: string;
}

export interface DriverEspejo {
  id: string;
  reconstruir(tarea: Tarea, fetchFn: typeof fetch, ahora: number): Promise<ResultadoReconstruccion>;
}

/** Build hook de Netlify: el cuerpo llega al build como INCOMING_HOOK_BODY. */
export function driverNetlifyBuildHook(url: string): DriverEspejo {
  return {
    id: "netlify-build-hook",
    async reconstruir(tarea, fetchFn, ahora) {
      const destino = new URL(url);
      destino.searchParams.set("trigger_title", `modo-liga: ${tarea} ${new Date(ahora).toISOString()}`);
      const r = await fetchFn(destino.toString(), {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ tarea, at: ahora }),
      });
      return { ok: r.ok, driver: "netlify-build-hook", tarea, detalle: `HTTP ${r.status}` };
    },
  };
}

/** Webhook genérico (GitHub repository_dispatch, un VPS, n8n…). */
export function driverWebhook(url: string, cabeceras: Record<string, string> = {}): DriverEspejo {
  return {
    id: "webhook",
    async reconstruir(tarea, fetchFn, ahora) {
      const r = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceras },
        body: JSON.stringify({ evento: "modo-liga", tarea, at: new Date(ahora).toISOString() }),
      });
      return { ok: r.ok, driver: "webhook", tarea, detalle: `HTTP ${r.status}` };
    },
  };
}
