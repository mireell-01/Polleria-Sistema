import { onValue, push, ref, serverTimestamp, update } from 'firebase/database';
import { auth, db } from './firebase';
import { buildLines, nextAdditionalSlot, paymentAmounts, type Order, type OrderState, type PaymentMethod } from './order-model';
import type { Entry, Product } from './catalog';

function context() {
  if (!db || !auth.currentUser) throw new Error('Inicia sesión nuevamente para continuar.');
  return { database: db, uid: auth.currentUser.uid };
}

export function watchOrders(receive: (orders: Entry<Order>[]) => void, fail: (error: Error) => void) {
  const { database } = context();
  return onValue(ref(database, 'pedidos'), snapshot => {
    const orders: Entry<Order>[] = [];
    snapshot.forEach(child => { orders.push({ ...child.val(), id: child.key }); });
    receive(orders.sort((a, b) => b.creadoEn - a.creadoEn));
  }, fail);
}

export function watchOccupancy(receive: (occupancy: Record<string, string>) => void, fail?: (error: Error) => void) {
  const { database } = context();
  return onValue(ref(database, 'ocupacion'), snapshot => receive(snapshot.val() ?? {}), fail);
}

export async function createOrder(mesaId: string, products: Entry<Product>[], quantities: Record<string, number>, notes: string) {
  const { database, uid } = context();
  const id = push(ref(database, 'pedidos')).key!;
  const order = { mesaId, creadoPor: uid, creadoEn: serverTimestamp(), actualizadoPor: uid, actualizadoEn: serverTimestamp(), estado: 'pendiente', observaciones: notes.trim(), ...buildLines(products, quantities) };
  // Both paths are validated together: a second order cannot claim an occupied table.
  await update(ref(database), { [`pedidos/${id}`]: order, [`ocupacion/${mesaId}`]: id });
  return id;
}

export async function addToOrder(order: Entry<Order>, products: Entry<Product>[], quantities: Record<string, number>, notes: string) {
  const { database, uid } = context();
  const lines = buildLines(products, quantities);
  const slot = nextAdditionalSlot(order, lines.totalCentimos);
  const batch = { envioId: push(ref(database, 'pedidos')).key!, creadoPor: uid, creadoEn: serverTimestamp(), actualizadoPor: uid, actualizadoEn: serverTimestamp(), estado: 'pendiente', observaciones: notes.trim(), ...lines };
  // Immutable batch identity and the server-side sum reject concurrent stale appends.
  await update(ref(database, `pedidos/${order.id}`), {
    [`adicionales/${slot}`]: batch, totalCentimos: order.totalCentimos + lines.totalCentimos,
    actualizadoPor: uid, actualizadoEn: serverTimestamp(),
  });
}

export async function advanceOrder(order: Entry<Order>, next: OrderState, batchId = 'inicial') {
  const { database, uid } = context();
  const changes = batchId === 'inicial' ? { estado: next } : {
    [`adicionales/${batchId}/estado`]: next, [`adicionales/${batchId}/actualizadoPor`]: uid,
    [`adicionales/${batchId}/actualizadoEn`]: serverTimestamp(),
  };
  await update(ref(database, `pedidos/${order.id}`), { ...changes, actualizadoPor: uid, actualizadoEn: serverTimestamp() });
}

export async function cancelOrder(order: Entry<Order>, reason: string) {
  const { database, uid } = context();
  if (!reason.trim()) throw new Error('Indica el motivo de la cancelación.');
  await update(ref(database), {
    [`pedidos/${order.id}/estado`]: 'cancelado', [`pedidos/${order.id}/actualizadoPor`]: uid,
    [`pedidos/${order.id}/actualizadoEn`]: serverTimestamp(),
    [`pedidos/${order.id}/cancelacion`]: { motivo: reason.trim(), usuario: uid, fecha: serverTimestamp() },
    [`ocupacion/${order.mesaId}`]: null,
  });
}

export async function payOrder(order: Entry<Order>, method: PaymentMethod, received: number, reference: string) {
  const { database, uid } = context();
  if (method !== 'Efectivo' && !reference.trim()) throw new Error('Indica el número de operación o la referencia del pago.');
  const amounts = paymentAmounts(order.totalCentimos, received, method);
  await update(ref(database), {
    [`pedidos/${order.id}/estado`]: 'pagado', [`pedidos/${order.id}/actualizadoPor`]: uid,
    [`pedidos/${order.id}/actualizadoEn`]: serverTimestamp(),
    [`pedidos/${order.id}/pago`]: { metodo: method, ...amounts, referencia: method === 'Efectivo' ? '' : reference.trim(), usuario: uid, fecha: serverTimestamp() },
    [`ocupacion/${order.mesaId}`]: null,
  });
}

export function orderError(error: unknown) {
  if (error instanceof Error && /permission[_ -]denied/i.test(error.message)) return 'No se pudo completar: la mesa, el pedido, los precios o tus permisos cambiaron. Revisa los datos actualizados e inténtalo otra vez.';
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}
