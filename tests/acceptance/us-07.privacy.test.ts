// US-07 Privacidad. Contrato de módulos que los constructores deben cumplir (T010):
//  server/privacy/index.ts  exporta:
//    ALLOWED_COLUMNS: readonly string[]
//    sanitizeRow(row: Record<string, unknown>): Record<string, unknown>
//      (fila de contrato; columnas `tipodocproveedor`, `documento_proveedor`)
//    sanitizeFileName(name: string, opts?: { personNames?: string[] }): string
//  server/log.ts exporta:
//    createQuestionLogger(write: (line: string) => void):
//      (entry: { tokens: number; latencyMs: number; channel: 'texto'|'voz'|'whatsapp';
//                errorCode?: string; [extra: string]: unknown }) => void
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const privacy = () => import(resolve(root, 'server/privacy/index.ts'));
const logMod = () => import(resolve(root, 'server/log.ts'));

describe('US-07', () => {
  it('AC-07.1 la lista permitida no incluye banco, cuenta ni documentos de personas naturales', async () => {
    const { ALLOWED_COLUMNS } = await privacy();
    expect(ALLOWED_COLUMNS.length).toBeGreaterThan(0);
    for (const c of ALLOWED_COLUMNS as string[]) {
      expect(c).not.toMatch(/banco|cuenta/i);
    }
  });

  it('AC-07.2 elimina el número de documento de persona natural (CC) de la fila', async () => {
    const { sanitizeRow } = await privacy();
    const out = sanitizeRow({
      proveedor_adjudicado: 'Juan Pérez',
      tipodocproveedor: 'Cédula de Ciudadanía',
      documento_proveedor: '1020304050',
    });
    expect(JSON.stringify(out)).not.toContain('1020304050');
  });

  it('AC-07.2 conserva el NIT de empresas y entidades (NIT 890399011)', async () => {
    const { sanitizeRow } = await privacy();
    const out = sanitizeRow({
      proveedor_adjudicado: 'Constructora Ejemplo S.A.S.',
      tipodocproveedor: 'NIT',
      documento_proveedor: '890399011',
    });
    expect(JSON.stringify(out)).toContain('890399011');
  });

  it('AC-07.2 depura números de documento y nombres de personas de los nombres de archivo', async () => {
    const { sanitizeFileName } = await privacy();
    const out = sanitizeFileName('CC 1020304050 Juan Perez contrato firmado.pdf', {
      personNames: ['Juan Perez'],
    });
    expect(out).not.toContain('1020304050');
    expect(out).not.toContain('Juan Perez');
    expect(out).toMatch(/\.pdf$/);
  });

  it('AC-07.4 el registro por pregunta solo guarda tokens, latencia, canal y código de error', async () => {
    const { createQuestionLogger } = await logMod();
    const lines: string[] = [];
    const log = createQuestionLogger((l: string) => lines.push(l));
    log({
      tokens: 812,
      latencyMs: 640,
      channel: 'voz',
      errorCode: 'E_TIMEOUT',
      question: '¿Qué contratos tiene la alcaldía de Zipaquirá?',
      phone: '+573001234567',
      text: 'contenido',
    });
    const all = lines.join('\n');
    expect(all).toContain('812');
    expect(all).toContain('640');
    expect(all).toContain('voz');
    expect(all).toContain('E_TIMEOUT');
    expect(all).not.toContain('Zipaquirá');
    expect(all).not.toContain('3001234567');
  });

  it('AC-07.4 (cambio 006) registra intención, ruta, herramientas, código de declinación, tipo de error y motivo de cierre, sin texto ni identificadores', async () => {
    const { createQuestionLogger } = await logMod();
    const lines: string[] = [];
    const log = createQuestionLogger((l: string) => lines.push(l));
    log({
      tokens: 700, latencyMs: 900, channel: 'voz',
      intent: 'ranking_entidades', route: 'voz', tools: ['top_entidades', 'detalle_contrato'],
      declineCode: 'NO-05', errorType: 'timeout', closeReason: 'inactividad',
      question: '¿Cuánto gastó la alcaldía de Zipaquirá?', answer: 'La alcaldía de Zipaquirá gastó mucho',
      nit: '890399011', entityName: 'Alcaldía de Zipaquirá', phone: '+573001234567', ip: '203.0.113.77',
    });
    const all = lines.join('\n');
    for (const v of ['ranking_entidades', 'voz', 'top_entidades', 'detalle_contrato', 'NO-05', 'timeout', 'inactividad']) expect(all).toContain(v);
    for (const leak of ['Zipaquirá', 'gastó mucho', '890399011', '3001234567', '203.0.113.77']) expect(all).not.toContain(leak);
  });

  it('AC-07.4 (cambio 007) registro por turno de voz: lugar reconocido, código de resultado, ruta y tiempos, sin contenido', async () => {
    const { createQuestionLogger } = await logMod();
    const lines: string[] = [];
    createQuestionLogger((l: string) => lines.push(l))({
      channel: 'voz', intent: 'ranking', route: 'agente', tools: ['top_entidades'], placeMatched: 'confirmar',
      resultCode: 'ok', latencyMs: 1800, tokens: 900, question: '¿Cuánto en Tunja?', text: 'respuesta privada',
    });
    const all = lines.join('\n');
    for (const v of ['confirmar', 'resultCode', 'placeMatched', 'agente', '1800']) expect(all).toContain(v);
    for (const leak of ['Tunja', 'respuesta privada']) expect(all).not.toContain(leak);
  });

  it('AC-07.4 documenta el plazo de borrado de 30 días', () => {
    const doc = readFileSync(resolve(root, 'docs/PRIVACIDAD.md'), 'utf8');
    expect(doc).toMatch(/30\s*días/i);
  });
});
