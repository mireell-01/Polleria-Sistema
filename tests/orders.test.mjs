import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectDatabaseEmulator, getDatabase, get, ref, set, update, remove, serverTimestamp } from 'firebase/database';

const projectId = 'demo-polleria-sistema';
const namespace = `${projectId}-default-rtdb`;
const apps = [];
async function adminPut(path, value) {
  const response = await fetch(`http://127.0.0.1:9000/${path}.json?ns=${namespace}`, { method: 'PUT', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal(response.ok, true, await response.text());
}
function client(uid) {
  const app = initializeApp({ projectId, databaseURL: `https://${namespace}.firebaseio.com` }, `orders-${uid ?? 'anon'}`);
  apps.push(app);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, '127.0.0.1', 9000, uid ? { mockUserToken: { sub: uid } } : undefined);
  return db;
}
const line = { productoId: 'pollo', nombre: 'Pollo', precioCentimos: 1850, cantidad: 2, subtotalCentimos: 3700 };
const makeOrder = (mesaId = '1', uid = 'mozo') => ({ mesaId, creadoPor: uid, creadoEn: serverTimestamp(), actualizadoPor: uid, actualizadoEn: serverTimestamp(), estado: 'pendiente', observaciones: 'Sin ensalada', lineas: { 0: { ...line } }, totalCentimos: 3700 });
const create = (db, id, order = makeOrder()) => update(ref(db), { [`pedidos/${id}`]: order, [`ocupacion/${order.mesaId}`]: id });
const advance = (db, id, estado, uid) => update(ref(db, `pedidos/${id}`), { estado, actualizadoPor: uid, actualizadoEn: serverTimestamp() });
const payment = (uid = 'cajero', method = 'Efectivo') => ({ metodo: method, recibidoCentimos: method === 'Efectivo' ? 5000 : 3700, vueltoCentimos: method === 'Efectivo' ? 1300 : 0, referencia: method === 'Efectivo' ? '' : 'OP-123', usuario: uid, fecha: serverTimestamp() });
const close = (db, id, mesaId = '1', pago = payment()) => update(ref(db), {
  [`pedidos/${id}/estado`]: 'pagado', [`pedidos/${id}/pago`]: pago,
  [`pedidos/${id}/actualizadoPor`]: pago.usuario, [`pedidos/${id}/actualizadoEn`]: serverTimestamp(), [`ocupacion/${mesaId}`]: null,
});
const cancel = (db, id, mesaId, uid, motivo = 'Cliente desistió') => update(ref(db), {
  [`pedidos/${id}/estado`]: 'cancelado', [`pedidos/${id}/cancelacion`]: { motivo, usuario: uid, fecha: serverTimestamp() },
  [`pedidos/${id}/actualizadoPor`]: uid, [`pedidos/${id}/actualizadoEn`]: serverTimestamp(), [`ocupacion/${mesaId}`]: null,
});
const denied = promise => assert.rejects(promise, /permission[_ ]denied/i);

test('flujo de sala, cocina y caja con reglas reales', { timeout: 60000 }, async t => {
  await adminPut('.settings/rules', JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url), 'utf8')));
  await adminPut('', {
    usuarios: Object.fromEntries([['admin', 'administrador'], ['mozo', 'mozo'], ['otro', 'mozo'], ['cocina', 'cocina'], ['cajero', 'cajero'], ['inactivo', 'administrador'], ['invalido', 'desconocido']].map(([uid, rol]) => [uid, { nombre: uid, rol, activo: uid !== 'inactivo' }])),
    mesas: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), { numero: i + 1, capacidad: 4, activa: i !== 9 }])),
    productos: { pollo: { nombre: 'Pollo', categoria: 'Pollos', precioCentimos: 1850, activo: true }, bebida: { nombre: 'Bebida', categoria: 'Bebidas', precioCentimos: 500, activo: false } },
  });
  try {
    const admin = client('admin'), waiter = client('mozo'), other = client('otro'), kitchen = client('cocina'), cashier = client('cajero');
    const unauthorized = [client(), client('inactivo'), client('sin-perfil'), client('invalido')];
    await t.test('solo personal activo puede leer la operación; cocina y caja no crean pedidos', async () => {
      for (const db of unauthorized) for (const path of ['pedidos', 'ocupacion']) await denied(get(ref(db, path)));
      for (const db of [admin, waiter, kitchen, cashier]) assert.equal((await get(ref(db, 'pedidos'))).exists(), false);
      for (const [db, uid] of [[kitchen, 'cocina'], [cashier, 'cajero']]) await denied(create(db, `prohibido-${uid}`, makeOrder('1', uid)));
      for (const db of unauthorized) await denied(create(db, 'sin-acceso'));
    });
    await t.test('el pedido y la ocupación se crean juntos; no hay pedidos huérfanos', async () => {
      await denied(set(ref(waiter, 'pedidos/huerfano'), makeOrder()));
      await denied(set(ref(waiter, 'ocupacion/1'), 'inexistente'));
      await denied(create(waiter, 'autor-falso', makeOrder('1', 'admin')));
      await denied(create(waiter, 'mesa-inactiva', makeOrder('10')));
      await denied(create(waiter, 'mesa-inexistente', makeOrder('99')));
      await create(waiter, 'principal');
      assert.equal((await get(ref(kitchen, 'pedidos/principal'))).val().totalCentimos, 3700);
      assert.equal((await get(ref(cashier, 'ocupacion/1'))).val(), 'principal');
    });
    await t.test('una mesa ocupada no se puede volver a ocupar, eliminar ni deshabilitar', async () => {
      await denied(create(other, 'duplicado', makeOrder('1', 'otro')));
      await denied(remove(ref(admin, 'mesas/1')));
      await denied(update(ref(admin, 'mesas/1'), { activa: false }));
      await denied(remove(ref(waiter, 'ocupacion/1')));
      const results = await Promise.allSettled([create(waiter, 'carrera-a', makeOrder('2')), create(other, 'carrera-b', makeOrder('2', 'otro'))]);
      assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    });
    await t.test('precio, suma, cantidades y disponibilidad se validan al crear', async () => {
      const base = makeOrder('3');
      const invalid = [
        { ...base, totalCentimos: 1 },
        { ...base, lineas: {} },
        { ...base, lineas: { 0: { ...line, precioCentimos: 1, subtotalCentimos: 2 } }, totalCentimos: 2 },
        { ...base, lineas: { 0: { ...line, nombre: 'Precio inventado' } } },
        { ...base, lineas: { 0: { ...line, cantidad: 0, subtotalCentimos: 0 } }, totalCentimos: 0 },
        { ...base, lineas: { 0: { ...line, cantidad: 100, subtotalCentimos: 185000 } }, totalCentimos: 185000 },
        { ...base, lineas: { 0: { ...line, cantidad: 1.5, subtotalCentimos: 2775 } }, totalCentimos: 2775 },
        { ...base, lineas: { 0: { productoId: 'bebida', nombre: 'Bebida', cantidad: 1, precioCentimos: 500, subtotalCentimos: 500 } }, totalCentimos: 500 },
        { ...base, lineas: { 0: line, 20: line }, totalCentimos: 7400 },
        { ...base, lineas: { 0: { ...line, extra: true } } },
        { ...base, creadoEn: 1 }, { ...base, estado: 'pagado', pago: payment('mozo') },
      ];
      for (let i = 0; i < invalid.length; i++) await denied(create(waiter, `invalido-${i}`, invalid[i]));
      const many = { ...base, lineas: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [index, line])), totalCentimos: 74000 };
      await create(waiter, 'veinte-lineas', many);
    });
    await t.test('el pedido conserva productos, precio, autor y total después del envío', async () => {
      for (const patch of [{ totalCentimos: 1 }, { 'lineas/0/precioCentimos': 1 }, { 'lineas/0': null }, { 'lineas/1': line }, { creadoPor: 'admin' }, { observaciones: null }, { mesaId: '4' }]) {
        await denied(update(ref(kitchen, 'pedidos/principal'), { ...patch, estado: 'preparando', actualizadoPor: 'cocina', actualizadoEn: serverTimestamp() }));
      }
      await denied(remove(ref(admin, 'pedidos/principal')));
      await update(ref(admin, 'productos/pollo'), { precioCentimos: 2000, nombre: 'Nuevo nombre' });
      await advance(kitchen, 'principal', 'preparando', 'cocina');
      assert.equal((await get(ref(kitchen, 'pedidos/principal/lineas/0'))).val().nombre, 'Pollo');
      await update(ref(admin, 'productos/pollo'), { precioCentimos: 1850, nombre: 'Pollo' });
    });
    await t.test('cada rol avanza solo su etapa y no se salta estados', async () => {
      await denied(advance(waiter, 'principal', 'listo', 'mozo'));
      await denied(advance(cashier, 'principal', 'listo', 'cajero'));
      await denied(advance(kitchen, 'principal', 'entregado', 'cocina'));
      await denied(close(cashier, 'principal'));
      await advance(kitchen, 'principal', 'listo', 'cocina');
      await denied(advance(kitchen, 'principal', 'entregado', 'cocina'));
      await advance(waiter, 'principal', 'entregado', 'mozo');
      await denied(advance(kitchen, 'principal', 'preparando', 'cocina'));
    });
    await t.test('pago completo y liberación de mesa son atómicos; el vuelto debe ser exacto', async () => {
      await denied(close(waiter, 'principal', '1', payment('mozo')));
      await denied(update(ref(cashier, 'pedidos/principal'), { estado: 'pagado', pago: payment(), actualizadoPor: 'cajero', actualizadoEn: serverTimestamp() }));
      for (const bad of [{ ...payment(), recibidoCentimos: 100 }, { ...payment(), vueltoCentimos: 0 }, { ...payment(), metodo: 'Otro' }, { ...payment('cajero', 'Yape'), referencia: '' }, { ...payment('cajero', 'Tarjeta'), recibidoCentimos: 5000, vueltoCentimos: 1300 }]) await denied(close(cashier, 'principal', '1', bad));
      await close(cashier, 'principal');
      const result = (await get(ref(cashier, 'pedidos/principal'))).val();
      assert.equal(result.estado, 'pagado');
      assert.equal(result.pago.vueltoCentimos, 1300);
      assert.equal((await get(ref(waiter, 'ocupacion/1'))).exists(), false);
      await denied(close(cashier, 'principal'));
      await denied(update(ref(admin, 'pedidos/principal/pago'), { recibidoCentimos: 6000 }));
      await denied(remove(ref(admin, 'pedidos/principal')));
      await create(waiter, 'nuevo-turno', makeOrder('1'));
    });
    await t.test('cancelación con motivo libera la mesa; el historial no se borra', async () => {
      await denied(cancel(other, 'nuevo-turno', '1', 'otro'));
      await denied(cancel(kitchen, 'nuevo-turno', '1', 'cocina'));
      await denied(cancel(waiter, 'nuevo-turno', '1', 'mozo', '   '));
      await cancel(waiter, 'nuevo-turno', '1', 'mozo');
      assert.equal((await get(ref(waiter, 'ocupacion/1'))).exists(), false);
      assert.equal((await get(ref(waiter, 'pedidos/nuevo-turno'))).val().estado, 'cancelado');
      await denied(advance(admin, 'nuevo-turno', 'pendiente', 'admin'));
      await create(waiter, 'cancelacion-admin', makeOrder('4'));
      await advance(kitchen, 'cancelacion-admin', 'preparando', 'cocina');
      await denied(cancel(waiter, 'cancelacion-admin', '4', 'mozo'));
      await cancel(admin, 'cancelacion-admin', '4', 'admin');
    });
    await t.test('se registra pago digital exacto y la baja del administrador revoca escrituras', async () => {
      await create(admin, 'digital', makeOrder('5', 'admin'));
      await advance(admin, 'digital', 'preparando', 'admin');
      await advance(admin, 'digital', 'listo', 'admin');
      await advance(admin, 'digital', 'entregado', 'admin');
      await close(admin, 'digital', '5', payment('admin', 'Plin'));
      assert.equal((await get(ref(admin, 'pedidos/digital/pago'))).val().metodo, 'Plin');
      await adminPut('usuarios/admin/activo', false);
      await denied(create(admin, 'revocado', makeOrder('6', 'admin')));
    });
  } finally { await Promise.all(apps.map(deleteApp)); }
});
