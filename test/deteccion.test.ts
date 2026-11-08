import { test } from "node:test";
import assert from "node:assert/strict";
import { URL_HAYAHORA_ANY, cruce, detectar, esIp, parseListaIps, resolverIps, urlHayahora } from "../src/core/deteccion.ts";

test("parseListaIps: una IP por línea, ignora basura y duplicados", () => {
  assert.deepEqual(parseListaIps("192.124.249.25\n\n 188.114.96.5 \n192.124.249.25\nno-es-ip\n2606:4700::6810:1\n999.1.1.1\n"), ["192.124.249.25", "188.114.96.5", "2606:4700::6810:1"]);
  assert.ok(esIp("1.2.3.4") && !esIp("1.2.3") && !esIp("texto"));
  assert.equal(urlHayahora(), URL_HAYAHORA_ANY);
  assert.equal(urlHayahora("movistar"), "https://hayahora.futbol/estado/blocked-movistar.txt");
});

test("resolverIps: A y AAAA por DoH", async () => {
  const fetchFalso = (async (u: string) => {
    const tipo = new URL(u).searchParams.get("type");
    return Response.json({ Answer: tipo === "A" ? [{ type: 1, data: "188.114.96.5" }, { type: 1, data: "188.114.97.5" }, { type: 5, data: "x.netlify.app." }] : [{ type: 28, data: "2a06:98c1:3120::5" }] });
  }) as unknown as typeof fetch;
  assert.deepEqual(await resolverIps("ejemplo.es", fetchFalso), ["188.114.96.5", "188.114.97.5", "2a06:98c1:3120::5"]);
});

test("detectar: cruza con las IPs propias; sin IPs propias usa el pulso general", async () => {
  const lista = (async () => new Response("192.124.249.25\n188.114.97.5\n")) as unknown as typeof fetch;
  const d = await detectar(["188.114.96.5", "188.114.97.5"], lista, 1000);
  assert.deepEqual([d.bloqueado, d.propiasBloqueadas, d.totalBloqueadas, d.consultadoAt], [true, ["188.114.97.5"], 2, 1000]);
  assert.equal((await detectar(["1.1.1.1"], lista, 1)).bloqueado, false);
  assert.equal((await detectar([], lista, 1)).bloqueado, true);
  const vacia = (async () => new Response("")) as unknown as typeof fetch;
  assert.equal((await detectar([], vacia, 1)).bloqueado, false);
  assert.deepEqual(cruce(["A", "b"], ["a", "c"]), ["A"]);
  const caida = (async () => new Response("", { status: 502 })) as unknown as typeof fetch;
  await assert.rejects(detectar([], caida, 1), /hayahora/);
});
