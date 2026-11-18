import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectDatabaseEmulator, getDatabase, get, onValue, ref, set, update, remove, runTransaction } from 'firebase/database';

const projectId = 'demo-polleria-sistema';
const namespace = `${projectId}-default-rtdb`;
const endpoint = 'http://127.0.0.1:9000';
const apps = [];

async function adminPut(path, value) {
  const response = await fetch(`${endpoint}/${path}.json?ns=${namespace}`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  assert.equal(response.ok, true, await response.text());
}

function client(uid) {
  const app = initializeApp({ projectId, databaseURL: `https://${namespace}.firebaseio.com` }, uid || 'anonymous');
  apps.push(app);
  const database = getDatabase(app);
  connectDatabaseEmulator(database, '127.0.0.1', 9000, uid ? { mockUserToken: { sub: uid } } : undefined);
  return database;
}

test('perfiles y permisos de Realtime Database', { timeout: 30000 }, async t => {
  const rules = JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url), 'utf8'));
  await adminPut('.settings/rules', rules);
  await adminPut('', {
    usuarios: {
      admin: { nombre: 'Admin', rol: 'administrador', activo: true },
      mozo: { nombre: 'Mozo', rol: 'mozo', activo: true },
      inactivo: { nombre: 'Inactivo', rol: 'administrador', activo: false },
      cocina: { nombre: 'Cocina', rol: 'cocina', activo: true },
      cajero: { nombre: 'Cajero', rol: 'cajero', activo: true },
    },
    privados: { prueba: true },
  });
  try {
    const anonymous = client();
    const admin = client('admin');
    const mozo = client('mozo');
    const inactive = client('inactivo');
    const missing = client('sin-perfil');
    const kitchen = client('cocina');
    const cashier = client('cajero');

    const table = { numero: 1, capacidad: 4, activa: true };
    const product = { nombre: '1/4 de pollo', categoria: 'Pollos', precioCentimos: 1850, descripcion: 'Con papas', activo: true };
    await t.test('administrador crea, consulta, edita y elimina mesas y productos', async () => {
      await set(ref(admin, 'mesas/1'), table);
      await set(ref(admin, 'productos/pollo'), product);
      assert.equal((await get(ref(admin, 'mesas'))).val()['1'].capacidad, 4);
      assert.equal((await get(ref(admin, 'productos'))).val().pollo.precioCentimos, 1850);
      await update(ref(admin, 'mesas/1'), { capacidad: 6, activa: false });
      await update(ref(admin, 'productos/pollo'), { precioCentimos: 2000, activo: false });
      assert.equal((await get(ref(admin, 'mesas/1'))).val().capacidad, 6);
      assert.equal((await get(ref(admin, 'productos/pollo'))).val().activo, false);
      await remove(ref(admin, 'mesas/1'));
      await remove(ref(admin, 'productos/pollo'));
      assert.equal((await get(ref(admin, 'mesas/1'))).exists(), false);
      assert.equal((await get(ref(admin, 'productos/pollo'))).exists(), false);
      await set(ref(admin, 'mesas/1'), table);
      await set(ref(admin, 'productos/pollo'), product);
    });
    await t.test('personal activo consulta la carta pero solo el administrador la modifica', async () => {
      for (const database of [mozo, kitchen, cashier]) {
        assert.equal((await get(ref(database, 'mesas/1'))).val().capacidad, 4);
        assert.equal((await get(ref(database, 'productos/pollo'))).val().precioCentimos, 1850);
      }
      for (const database of [anonymous, inactive, missing]) {
        for (const path of ['mesas', 'productos']) await assert.rejects(get(ref(database, path)), /permission[_ ]denied/i);
      }
      for (const database of [anonymous, mozo, kitchen, cashier, inactive, missing]) {
        await assert.rejects(set(ref(database, 'mesas/2'), { ...table, numero: 2 }), /permission[_ ]denied/i);
        await assert.rejects(update(ref(database, 'productos/pollo'), { precioCentimos: 1 }), /permission[_ ]denied/i);
        await assert.rejects(remove(ref(database, 'mesas/1')), /permission[_ ]denied/i);
        await assert.rejects(remove(ref(database, 'productos/pollo')), /permission[_ ]denied/i);
      }
    });
    await t.test('las reglas rechazan mesas con número, capacidad o estructura inválidos', async () => {
      for (const invalid of [
        { ...table, numero: 2 }, { ...table, numero: 1.5 }, { ...table, numero: 0 },
        { ...table, capacidad: 0 }, { ...table, capacidad: 31 }, { ...table, capacidad: 2.5 },
        { ...table, activa: 'true' }, { numero: 1, activa: true }, { ...table, extra: 'no permitido' },
      ]) await assert.rejects(set(ref(admin, 'mesas/1'), invalid), /permission[_ ]denied/i);
      await assert.rejects(set(ref(admin, 'mesas/1000'), { ...table, numero: 1000 }), /permission[_ ]denied/i);
      await assert.rejects(remove(ref(admin, 'mesas/1/numero')), /permission[_ ]denied/i);
      await assert.rejects(update(ref(admin, 'mesas/99'), { capacidad: 4, activa: true }), /permission[_ ]denied/i);
    });
    await t.test('las reglas validan nombre, categoría, precio, disponibilidad y descripción', async () => {
      for (const invalid of [
        { ...product, nombre: '' }, { ...product, nombre: '   ' }, { ...product, nombre: 'x'.repeat(101) },
        { ...product, precioCentimos: -1 }, { ...product, precioCentimos: 0 },
        { ...product, precioCentimos: 18.5 }, { ...product, precioCentimos: 10000001 },
        { ...product, precioCentimos: '1850' }, { ...product, categoria: 'Inexistente' },
        { ...product, descripcion: 'x'.repeat(301) }, { ...product, activo: 'true' },
        { ...product, extra: true }, { nombre: 'Incompleto' },
      ]) await assert.rejects(set(ref(admin, 'productos/pollo'), invalid), /permission[_ ]denied/i);
      await assert.rejects(remove(ref(admin, 'productos/pollo/precioCentimos')), /permission[_ ]denied/i);
      await set(ref(admin, 'productos/sin-descripcion'), { ...product, descripcion: '' });
    });
    await t.test('dos creaciones simultáneas no sobrescriben el mismo número de mesa', async () => {
      const results = await Promise.all([4, 6].map(capacidad => runTransaction(ref(admin, 'mesas/8'), current => current === null ? { numero: 8, capacidad, activa: true } : undefined, { applyLocally: false })));
      assert.equal(results.filter(result => result.committed).length, 1);
      const original = (await get(ref(admin, 'mesas/8'))).val();
      const duplicate = await runTransaction(ref(admin, 'mesas/8'), current => current === null ? { numero: 8, capacidad: 10, activa: true } : undefined);
      assert.equal(duplicate.committed, false);
      assert.deepEqual((await get(ref(admin, 'mesas/8'))).val(), original);
    });

    await t.test('un visitante no puede leer perfiles', async () => {
      await assert.rejects(get(ref(anonymous, 'usuarios/mozo')), /permission[_ ]denied/i);
    });
    await t.test('cada usuario puede leer su perfil, incluso si está inactivo o falta', async () => {
      assert.equal((await get(ref(mozo, 'usuarios/mozo'))).val().rol, 'mozo');
      assert.equal((await get(ref(inactive, 'usuarios/inactivo'))).val().activo, false);
      assert.equal((await get(ref(missing, 'usuarios/sin-perfil'))).exists(), false);
    });
    await t.test('solo un administrador activo puede leer otros perfiles', async () => {
      assert.equal((await get(ref(admin, 'usuarios/mozo'))).val().nombre, 'Mozo');
      await assert.rejects(get(ref(mozo, 'usuarios/admin')), /permission[_ ]denied/i);
      await assert.rejects(get(ref(inactive, 'usuarios/mozo')), /permission[_ ]denied/i);
    });
    await t.test('no se permite listar perfiles ni consultar otras rutas', async () => {
      await assert.rejects(get(ref(admin, 'usuarios')), /permission[_ ]denied/i);
      await assert.rejects(get(ref(admin, 'privados')), /permission[_ ]denied/i);
    });
    await t.test('los clientes no pueden asignarse roles ni modificar datos', async () => {
      await assert.rejects(set(ref(mozo, 'usuarios/mozo/rol'), 'administrador'), /permission[_ ]denied/i);
      await assert.rejects(set(ref(admin, 'usuarios/mozo/activo'), false), /permission[_ ]denied/i);
      await assert.rejects(set(ref(admin, 'pedidos/nuevo'), true), /permission[_ ]denied/i);
    });
    await t.test('la suscripción recibe cambios de rol, desactivación y eliminación', async () => {
      const values = [];
      const waiters = [];
      const unsubscribe = onValue(ref(mozo, 'usuarios/mozo'), snapshot => {
        values.push(snapshot.val());
        waiters.shift()?.();
      });
      const next = async count => {
        if (values.length < count) await new Promise(resolve => waiters.push(resolve));
        return values[count - 1];
      };
      try {
        assert.equal((await next(1)).rol, 'mozo');
        await adminPut('usuarios/mozo/rol', 'cocina');
        assert.equal((await next(2)).rol, 'cocina');
        await adminPut('usuarios/mozo/activo', false);
        assert.equal((await next(3)).activo, false);
        await adminPut('usuarios/mozo', null);
        assert.equal(await next(4), null);
      } finally {
        unsubscribe();
      }
    });
  } finally {
    await Promise.all(apps.map(app => deleteApp(app)));
  }
});
