import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/order-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildLines, paymentAmounts, summarizeSales, limaDate } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const products = [{ id: 'pollo', nombre: 'Pollo', precioCentimos: 1850, categoria: 'Pollos', activo: true }, { id: 'bebida', nombre: 'Bebida', precioCentimos: 550, categoria: 'Bebidas', activo: true }];

test('totales exactos en céntimos, cantidades y disponibilidad', () => {
  const result = buildLines(products, { pollo: 2, bebida: 1 });
  assert.equal(result.totalCentimos, 4250);
  assert.equal(result.lineas[0].subtotalCentimos, 3700);
  assert.throws(() => buildLines(products, {}), /al menos/);
  assert.throws(() => buildLines(products, { pollo: 1.5 }), /cantidad/);
  assert.throws(() => buildLines(products, { pollo: 100 }), /cantidad/);
  assert.throws(() => buildLines(products, { eliminado: 1 }), /disponible/);
  assert.throws(() => buildLines([{ ...products[0], activo: false }], { pollo: 1 }), /disponible/);
  const many = Array.from({ length: 21 }, (_, index) => ({ ...products[0], id: String(index) }));
  assert.throws(() => buildLines(many, Object.fromEntries(many.map(item => [item.id, 1]))), /20 productos/);
  assert.throws(() => buildLines([{ ...products[0], precioCentimos: 10000000 }], { pollo: 2 }), /máximo/);
});
test('efectivo y pagos digitales calculan y validan el vuelto', () => {
  assert.deepEqual(paymentAmounts(3700, 5000, 'Efectivo'), { recibidoCentimos: 5000, vueltoCentimos: 1300 });
  assert.deepEqual(paymentAmounts(3700, 3700, 'Yape'), { recibidoCentimos: 3700, vueltoCentimos: 0 });
  assert.throws(() => paymentAmounts(3700, 3600, 'Efectivo'));
  assert.throws(() => paymentAmounts(3700, 5000, 'Tarjeta'));
  assert.throws(() => paymentAmounts(3700, NaN, 'Efectivo'));
});
test('reportes usan fecha de cobro en Lima y excluyen pedidos abiertos o cancelados', () => {
  const date = Date.parse('2026-11-18T04:59:00Z');
  assert.equal(limaDate(date), '2026-11-17');
  assert.equal(limaDate(Date.parse('2026-11-18T05:00:00Z')), '2026-11-18');
  const sale = { id: '1', estado: 'pagado', creadoEn: date - 86400000, totalCentimos: 3700, lineas: { 0: { productoId: 'pollo', nombre: 'Pollo', cantidad: 2, subtotalCentimos: 3700 } }, pago: { fecha: date, metodo: 'Efectivo', recibidoCentimos: 5000, vueltoCentimos: 1300 } };
  const result = summarizeSales([sale, { ...sale, id: '2', estado: 'cancelado' }, { ...sale, id: '3', estado: 'pendiente' }, { ...sale, id: '4', pago: { ...sale.pago, fecha: date + 60000 } }], '2026-11-17', '2026-11-17');
  assert.equal(result.total, 3700);
  assert.equal(result.average, 3700);
  assert.equal(result.paid.length, 1);
  assert.equal(result.byMethod[0].total, 3700);
  assert.equal(result.ranking[0].cantidad, 2);
  assert.equal(summarizeSales([], '2026-11-17', '2026-11-17').average, 0);
});
