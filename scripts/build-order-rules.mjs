// Regenerates the operational rules, preserving the profile/catalog schemas.
// The 20 explicit slots let Realtime Database verify the full sum server-side.
import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../database.rules.json', import.meta.url);
const document = JSON.parse(await readFile(file, 'utf8'));
const rules = document.rules;
const role = "root.child('usuarios').child(auth.uid).child('rol').val()";
const active = "auth != null && root.child('usuarios').child(auth.uid).child('activo').val() === true";
const hasRole = (...roles) => `(${roles.map(value => `${role} === '${value}'`).join(' || ')})`;
const admin = hasRole('administrador');
const staff = `${active} && ${hasRole('administrador', 'mozo', 'cocina', 'cajero')}`;
const waiters = hasRole('administrador', 'mozo');
const cooks = hasRole('administrador', 'cocina');
const cashiers = hasRole('administrador', 'cajero');
const state = "newData.child('estado').val()";
const previous = "data.child('estado').val()";
const newRoot = 'newData.parent().parent()';
const newOccupation = `${newRoot}.child('ocupacion').child(newData.child('mesaId').val())`;
const oldOccupation = "root.child('ocupacion').child(data.child('mesaId').val())";
const immutable = expression => ({ '.validate': `(${expression}) && (!data.exists() || newData.val() === data.val())` });
const required = keys => `newData.hasChildren(${JSON.stringify(keys)})`;
const validText = max => `newData.isString() && newData.val().length <= ${max} && newData.val().matches(/.*[^ \\t\\r\\n].*/)`;

rules.mesas['.read'] = staff;
rules.productos['.read'] = staff;
rules.mesas.$mesaId['.write'] = `${active} && ${admin} && (!root.child('ocupacion').child($mesaId).exists() || (newData.exists() && newData.child('activa').val() === true))`;

const slots = Array.from({ length: 20 }, (_, index) => String(index));
const sameSlots = slots.map(slot => `newData.child('${slot}').exists() === data.child('${slot}').exists()`).join(' && ');
const product = "root.child('productos').child(newData.child('productoId').val())";
const lineRules = {
  '.validate': `${required(['productoId', 'nombre', 'precioCentimos', 'cantidad', 'subtotalCentimos'])} && (data.exists() || (${product}.child('activo').val() === true && newData.child('nombre').val() === ${product}.child('nombre').val() && newData.child('precioCentimos').val() === ${product}.child('precioCentimos').val()))`,
  productoId: immutable('newData.isString() && newData.val().length > 0 && newData.val().length <= 128'),
  nombre: immutable(validText(100)),
  precioCentimos: immutable('newData.isNumber() && newData.val() > 0 && newData.val() <= 10000000 && newData.val() % 1 === 0'),
  cantidad: immutable('newData.isNumber() && newData.val() >= 1 && newData.val() <= 99 && newData.val() % 1 === 0'),
  subtotalCentimos: immutable("newData.isNumber() && newData.val() === newData.parent().child('precioCentimos').val() * newData.parent().child('cantidad').val()"),
  $other: { '.validate': false },
};
const lineas = { '.validate': `newData.hasChild('0') && (!data.exists() || (${sameSlots}))`, $other: { '.validate': false } };
slots.forEach(slot => { lineas[slot] = lineRules; });
const sum = slots.map(slot => `(newData.parent().child('lineas/${slot}/subtotalCentimos').exists() ? newData.parent().child('lineas/${slot}/subtotalCentimos').val() : 0)`).join(' + ');
const extraSlots = Array.from({ length: 10 }, (_, index) => String(index));
const retainExtras = extraSlots.map(slot => `(!data.child('adicionales/${slot}').exists() || newData.child('adicionales/${slot}').exists())`).join(' && ');
const extrasInState = (snapshot, expected) => extraSlots.map(slot => `(!${snapshot}.child('adicionales/${slot}').exists() || ${snapshot}.child('adicionales/${slot}/estado').val() === '${expected}')`).join(' && ');
const extraSum = extraSlots.map(slot => `(newData.parent().child('adicionales/${slot}/totalCentimos').exists() ? newData.parent().child('adicionales/${slot}/totalCentimos').val() : 0)`).join(' + ');
const unchangedBatch = "data.exists() && newData.parent().child('estado').val() === data.parent().child('estado').val()";
const additionalRules = {
  '.validate': `${required(['envioId', 'creadoPor', 'creadoEn', 'actualizadoPor', 'actualizadoEn', 'estado', 'lineas', 'totalCentimos'])} && ((!data.exists() && ${waiters} && ${state} === 'pendiente' && newData.parent().parent().child('estado').val() !== 'pagado' && newData.parent().parent().child('estado').val() !== 'cancelado') || (data.exists() && (${state} === ${previous} || (${cooks} && ${previous} === 'pendiente' && ${state} === 'preparando') || (${cooks} && ${previous} === 'preparando' && ${state} === 'listo') || (${waiters} && ${previous} === 'listo' && ${state} === 'entregado')))) && (!data.exists() || newData.child('observaciones').val() === data.child('observaciones').val())`,
  envioId: immutable('newData.isString() && newData.val().length > 0 && newData.val().length <= 128'),
  creadoPor: immutable('newData.isString() && (data.exists() || newData.val() === auth.uid)'),
  creadoEn: immutable('newData.isNumber() && (data.exists() || newData.val() === now)'),
  actualizadoPor: { '.validate': `newData.val() === ((${unchangedBatch}) ? data.val() : auth.uid)` },
  actualizadoEn: { '.validate': `newData.isNumber() && newData.val() === ((${unchangedBatch}) ? data.val() : now)` },
  estado: { '.validate': "newData.val() === 'pendiente' || newData.val() === 'preparando' || newData.val() === 'listo' || newData.val() === 'entregado'" },
  observaciones: immutable('newData.isString() && newData.val().length <= 300'),
  lineas,
  totalCentimos: immutable(`newData.isNumber() && newData.val() > 0 && newData.val() <= 10000000 && newData.val() === (${sum})`),
  $other: { '.validate': false },
};
const adicionales = { $other: { '.validate': false } };
extraSlots.forEach((slot, index) => {
  const previousExists = index === 0 ? 'true' : `root.child('pedidos').child($pedidoId).child('adicionales/${index - 1}').exists()`;
  adicionales[slot] = { ...additionalRules, '.validate': `${additionalRules['.validate']} && (data.exists() || (${previousExists}))` };
});
const transitions = [
  `(${cooks} && ${previous} === 'pendiente' && ${state} === 'preparando')`,
  `(${cooks} && ${previous} === 'preparando' && ${state} === 'listo')`,
  `(${waiters} && ${previous} === 'listo' && ${state} === 'entregado')`,
  `(${cashiers} && ${previous} === 'entregado' && ${state} === 'pagado' && (${extrasInState('data', 'entregado')}))`,
  `(${state} === 'cancelado' && (${admin} || (${role} === 'mozo' && ${previous} === 'pendiente' && data.child('creadoPor').val() === auth.uid && (${extrasInState('data', 'pendiente')}))))`,
  `(${state} === ${previous} && ${hasRole('administrador', 'mozo', 'cocina')})`,
].join(' || ');

rules.pedidos = {
  '.read': staff,
  '.indexOn': ['estado', 'creadoEn', 'pago/fecha'],
  $pedidoId: {
    '.write': `${staff} && newData.exists() && ((!data.exists() && ${waiters} && ${state} === 'pendiente' && !newData.child('adicionales').exists() && !root.child('ocupacion').child(newData.child('mesaId').val()).exists() && root.child('mesas').child(newData.child('mesaId').val()).child('activa').val() === true) || (data.exists() && ${previous} !== 'pagado' && ${previous} !== 'cancelado' && ${oldOccupation}.val() === $pedidoId && (${transitions})))`,
    '.validate': `${required(['mesaId', 'creadoPor', 'creadoEn', 'actualizadoPor', 'actualizadoEn', 'estado', 'lineas', 'totalCentimos'])} && ((${state} === 'pagado' || ${state} === 'cancelado') ? !${newOccupation}.exists() : ${newOccupation}.val() === $pedidoId) && (newData.child('pago').exists() === (${state} === 'pagado')) && (newData.child('cancelacion').exists() === (${state} === 'cancelado')) && newData.child('observaciones').val() === (data.exists() ? data.child('observaciones').val() : newData.child('observaciones').val()) && (${retainExtras}) && (${state} !== 'pagado' || (${extrasInState('newData', 'entregado')}))`,
    mesaId: immutable('newData.isString() && newData.val().length > 0 && newData.val().length <= 3'),
    creadoPor: immutable('newData.isString() && (data.exists() || newData.val() === auth.uid)'),
    creadoEn: immutable('newData.isNumber() && (data.exists() || newData.val() === now)'),
    actualizadoPor: { '.validate': 'newData.val() === auth.uid' },
    actualizadoEn: { '.validate': 'newData.isNumber() && newData.val() === now' },
    estado: { '.validate': "newData.val() === 'pendiente' || newData.val() === 'preparando' || newData.val() === 'listo' || newData.val() === 'entregado' || newData.val() === 'pagado' || newData.val() === 'cancelado'" },
    observaciones: immutable('newData.isString() && newData.val().length <= 300'),
    lineas,
    adicionales,
    totalCentimos: { '.validate': `newData.isNumber() && newData.val() > 0 && newData.val() <= 10000000 && newData.val() === (${sum}) + (${extraSum})` },
    pago: {
      '.validate': `${required(['metodo', 'recibidoCentimos', 'vueltoCentimos', 'usuario', 'fecha'])} && newData.parent().child('estado').val() === 'pagado' && (newData.child('metodo').val() === 'Efectivo' || (newData.child('referencia').isString() && newData.child('referencia').val().matches(/.*[^ \\t\\r\\n].*/)))`,
      metodo: { '.validate': "newData.val() === 'Efectivo' || newData.val() === 'Yape' || newData.val() === 'Plin' || newData.val() === 'Tarjeta'" },
      recibidoCentimos: { '.validate': "newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= newData.parent().parent().child('totalCentimos').val() && newData.val() <= 10000000 && (newData.parent().child('metodo').val() === 'Efectivo' || newData.val() === newData.parent().parent().child('totalCentimos').val())" },
      vueltoCentimos: { '.validate': "newData.isNumber() && newData.val() === newData.parent().child('recibidoCentimos').val() - newData.parent().parent().child('totalCentimos').val()" },
      referencia: { '.validate': 'newData.isString() && newData.val().length <= 80' },
      usuario: { '.validate': 'newData.val() === auth.uid' },
      fecha: { '.validate': 'newData.isNumber() && newData.val() === now' },
      $other: { '.validate': false },
    },
    cancelacion: {
      '.validate': `${required(['motivo', 'usuario', 'fecha'])} && newData.parent().child('estado').val() === 'cancelado'`,
      motivo: { '.validate': validText(200) },
      usuario: { '.validate': 'newData.val() === auth.uid' },
      fecha: { '.validate': 'newData.isNumber() && newData.val() === now' },
      $other: { '.validate': false },
    },
    $other: { '.validate': false },
  },
};
const proposedOrder = `${newRoot}.child('pedidos').child(newData.val())`;
const closedOrder = `${newRoot}.child('pedidos').child(data.val())`;
rules.ocupacion = {
  '.read': staff,
  $mesaId: {
    '.write': `${staff} && ((!data.exists() && newData.isString() && ${waiters} && !root.child('pedidos').child(newData.val()).exists() && ${proposedOrder}.child('mesaId').val() === $mesaId && ${proposedOrder}.child('estado').val() === 'pendiente' && ${proposedOrder}.child('creadoPor').val() === auth.uid) || (data.exists() && !newData.exists() && ((${cashiers} && ${closedOrder}.child('estado').val() === 'pagado') || (${waiters} && ${closedOrder}.child('estado').val() === 'cancelado'))))`,
    '.validate': 'newData.isString() && newData.val().length > 0 && newData.val().length <= 128',
  },
};
await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
console.log('Reglas de pedidos, ocupación y pagos generadas.');
