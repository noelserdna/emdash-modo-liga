// Tipos mínimos del runtime de Workers para compilar sin @cloudflare/workers-types.
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
