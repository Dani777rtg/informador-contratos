// US-06 Una sola conversación voz + texto. Pruebas locales, sin red ni APIs externas.
//
// Interfaz asumida de server/session.ts (T009; el constructor puede ajustar nombres,
// pero debe exponer estas tres operaciones):
//   createSessionCodec({ keys: Record<number,string>, currentKeyVersion: number, now?: () => number })
//     .sign(ctx): string                -> estado firmado (HMAC, versión de clave, caducidad 2 h)
//     .verify(token: unknown): Ctx|null -> contexto, o null si no es válido (nunca lanza)
//   emptyContext(): Ctx
//   applyTurn(ctx, { entity?, period?, contract?, results?, topicChange? }): Ctx   (puro)
// Ctx = { entity?, period?, contract?, results? }  (entidad, periodo, contrato en foco, resultados)
import { describe, it, expect } from "vitest";
// AC-06.1 (cambio 005): `resolveFollowUp(message: string, ctx: Ctx): string | null` en server/session.ts,
//   devuelve el id del contrato referido por el seguimiento sobre ctx.results (en orden de aparición;
//   "el más grande" = el primero, pues los resultados vienen ordenados por valor), o null.
import { createSessionCodec, emptyContext, applyTurn, resolveFollowUp } from "../../server/session";

const H = 3600_000;
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const mk = (o: { now?: () => number; keys?: Record<number, string>; v?: number } = {}) =>
  createSessionCodec({
    keys: o.keys ?? { 1: "clave-uno-de-prueba-0123456789abcdef" },
    currentKeyVersion: o.v ?? 1,
    now: o.now ?? (() => T0),
  });

const ctx = applyTurn(emptyContext(), {
  entity: { nit: "890399011", name: "Alcaldía de Cali" },
  period: { from: "2025-01-01", to: "2025-12-31" },
  contract: "CO1.PCCNTR.1234",
  results: ["CO1.PCCNTR.1234", "CO1.PCCNTR.5678"],
});

describe("US-06 contexto compartido entre voz y texto", () => {
  it("AC-06.1: un turno de texto deja contexto que un turno de voz recibe y refina (y viceversa)", () => {
    const codec = mk();
    // texto -> firma; voz reconecta con ese estado y pregunta "¿y en 2024?"
    const fromText = codec.verify(codec.sign(ctx))!;
    const voiceTurn = applyTurn(fromText, { period: { from: "2024-01-01", to: "2024-12-31" } });
    expect(voiceTurn.entity).toEqual(ctx.entity); // entidad conservada
    expect(voiceTurn.period).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    // voz -> texto: "el segundo" se resuelve contra los resultados acumulados
    const back = codec.verify(codec.sign(voiceTurn))!;
    expect(back.results).toEqual(ctx.results);
    expect(back.entity).toEqual(ctx.entity);
  });

  it("AC-06.1: el contrato en foco sobrevive a un seguimiento", () => {
    const next = applyTurn(ctx, { period: { from: "2024-01-01", to: "2024-12-31" } });
    expect(next.contract).toBe("CO1.PCCNTR.1234");
  });

  it.each(["dame ese contrato", "el más grande", "el primero", "ábrelo"])(
    "AC-06.1: el seguimiento %j se resuelve sobre ctx.results",
    (msg) => {
      expect(["CO1.PCCNTR.1234", "CO1.PCCNTR.5678"]).toContain(resolveFollowUp(msg, ctx));
      expect(resolveFollowUp("el primero", ctx)).toBe("CO1.PCCNTR.1234");
    },
  );

  it("AC-06.1: 'el segundo' elige el segundo y sin resultados devuelve null", () => {
    expect(resolveFollowUp("el segundo", ctx)).toBe("CO1.PCCNTR.5678");
    expect(resolveFollowUp("el primero", emptyContext())).toBeNull();
  });

  it("AC-06.2: recargar con el estado firmado recupera el contexto", () => {
    const codec = mk();
    expect(codec.verify(codec.sign(ctx))).toEqual(ctx);
  });

  it("AC-06.2: el estado sigue válido justo antes de 2 h y otra instancia con la misma clave lo acepta", () => {
    const token = mk().sign(ctx);
    expect(mk({ now: () => T0 + 2 * H - 1000 }).verify(token)).toEqual(ctx);
  });

  it("AC-06.3 / TM-13: estado expirado (más de 2 h) -> conversación nueva, sin error", () => {
    const token = mk().sign(ctx);
    const late = mk({ now: () => T0 + 2 * H + 1000 });
    expect(() => late.verify(token)).not.toThrow();
    expect(late.verify(token)).toBeNull();
  });

  it("AC-06.3 / TM-13: firma alterada o contenido modificado -> null sin lanzar", () => {
    const codec = mk();
    const token = codec.sign(ctx);
    const flipped = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
    expect(codec.verify(flipped)).toBeNull();
    const parts = token.split(".");
    const forged = [Buffer.from(JSON.stringify({ entity: { nit: "1" } })).toString("base64url"), ...parts.slice(1)].join(".");
    expect(codec.verify(forged)).toBeNull();
  });

  it("AC-06.3 / TM-13: firmado con otra clave -> null", () => {
    const other = mk({ keys: { 1: "otra-clave-completamente-distinta-9876543210" } });
    expect(mk().verify(other.sign(ctx))).toBeNull();
  });

  it("AC-06.3: versión de clave vieja (retirada) -> null; la nueva firma sí", () => {
    const old = mk({ keys: { 1: "clave-uno-de-prueba-0123456789abcdef" }, v: 1 }).sign(ctx);
    const rotated = mk({ keys: { 2: "clave-dos-de-prueba-0123456789abcdef" }, v: 2 });
    expect(rotated.verify(old)).toBeNull();
    expect(rotated.verify(rotated.sign(ctx))).toEqual(ctx);
  });

  it.each([undefined, null, "", "basura", "a.b.c.d", 42, {}])(
    "AC-06.3: entrada no válida %j -> null sin error",
    (bad) => {
      expect(() => mk().verify(bad)).not.toThrow();
      expect(mk().verify(bad)).toBeNull();
    },
  );

  it("AC-06.4: cambio de tema deja de arrastrar entidad y periodo anteriores", () => {
    const next = applyTurn(ctx, { topicChange: true });
    expect(next.entity).toBeUndefined();
    expect(next.period).toBeUndefined();
  });

  it("AC-06.4: el cambio de tema con nueva entidad usa solo la nueva", () => {
    const next = applyTurn(ctx, { topicChange: true, entity: { nit: "899999061", name: "Bogotá D.C." } });
    expect(next.entity).toEqual({ nit: "899999061", name: "Bogotá D.C." });
    expect(next.period).toBeUndefined();
  });
});
