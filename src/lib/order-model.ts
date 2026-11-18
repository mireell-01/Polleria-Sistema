import type { Entry, Product } from './catalog';

export type OrderState = 'pendiente' | 'preparando' | 'listo' | 'entregado' | 'pagado' | 'cancelado';
export type PaymentMethod = 'Efectivo' | 'Yape' | 'Plin' | 'Tarjeta';
export type Role = 'administrador' | 'mozo' | 'cocina' | 'cajero';
export type OrderLine = { productoId: string; nombre: string; precioCentimos: number; cantidad: number; subtotalCentimos: number };
export type BatchState = 'pendiente' | 'preparando' | 'listo' | 'entregado';
export type AdditionalBatch = {
  envioId: string; creadoPor: string; creadoEn: number; actualizadoPor: string; actualizadoEn: number;
  estado: BatchState; observaciones: string; lineas: Record<string, OrderLine>; totalCentimos: number;
};
export type OrderBatch = { id: string; label: string; estado: OrderState; creadoEn: number; observaciones: string; lineas: Record<string, OrderLine>; totalCentimos: number };
export type Payment = { metodo: PaymentMethod; recibidoCentimos: number; vueltoCentimos: number; referencia: string; usuario: string; fecha: number };
export type Order = {
  mesaId: string; creadoPor: string; creadoEn: number; actualizadoPor: string; actualizadoEn: number;
  estado: OrderState; observaciones: string; lineas: Record<string, OrderLine>; totalCentimos: number;
  pago?: Payment; cancelacion?: { motivo: string; usuario: string; fecha: number };
  adicionales?: Record<string, AdditionalBatch>;
};
export const stateLabels: Record<OrderState, string> = { pendiente: 'Pendiente', preparando: 'En preparación', listo: 'Listo para servir', entregado: 'Entregado', pagado: 'Pagado', cancelado: 'Cancelado' };
export const paymentMethods: PaymentMethod[] = ['Efectivo', 'Yape', 'Plin', 'Tarjeta'];
export const isOpen = (order: Order) => order.estado !== 'pagado' && order.estado !== 'cancelado';
export function orderBatches(order: Order): OrderBatch[] {
  return [{ id: 'inicial', label: 'Comanda inicial', estado: order.estado, creadoEn: order.creadoEn, observaciones: order.observaciones, lineas: order.lineas, totalCentimos: Object.values(order.lineas).reduce((sum, line) => sum + line.subtotalCentimos, 0) },
    ...Object.entries(order.adicionales ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([id, batch]) => ({ ...batch, id, label: `Adicional ${Number(id) + 1}` }))];
}
export const orderLines = (order: Order) => orderBatches(order).flatMap(batch => Object.values(batch.lineas));
export const readyBatches = (order: Order) => isOpen(order) ? orderBatches(order).filter(batch => batch.estado === 'listo') : [];
export const canPay = (order: Order) => isOpen(order) && orderBatches(order).every(batch => batch.estado === 'entregado');
export function progressState(order: Order): OrderState {
  if (!isOpen(order)) return order.estado;
  const stages: OrderState[] = ['pendiente', 'preparando', 'listo', 'entregado'];
  return stages.find(stage => orderBatches(order).some(batch => batch.estado === stage)) ?? 'pendiente';
}
export const canWaiterCancel = (order: Order, uid?: string) => isOpen(order) && order.creadoPor === uid && orderBatches(order).every(batch => batch.estado === 'pendiente');

export function nextAdditionalSlot(order: Order, extraTotal: number) {
  if (!isOpen(order)) throw new Error('Este pedido ya está cerrado. Abre un pedido nuevo para la mesa.');
  const slots = Object.keys(order.adicionales ?? {}).map(Number);
  const next = slots.length ? Math.max(...slots) + 1 : 0;
  if (next >= 10) throw new Error('Este pedido ya tiene el máximo de 10 comandas adicionales.');
  if (!Number.isSafeInteger(extraTotal) || extraTotal <= 0 || order.totalCentimos + extraTotal > 10000000) throw new Error('El total acumulado máximo es S/ 100 000.');
  return String(next);
}

export function buildLines(products: Entry<Product>[], quantities: Record<string, number>) {
  const selected = Object.entries(quantities).filter(([, quantity]) => quantity > 0);
  if (!selected.length) throw new Error('Agrega al menos un producto.');
  if (selected.length > 20) throw new Error('Cada pedido admite hasta 20 productos diferentes.');
  const lineas: Record<string, OrderLine> = {};
  let totalCentimos = 0;
  selected.forEach(([id, cantidad], index) => {
    const product = products.find(item => item.id === id);
    if (!product?.activo) throw new Error('Un producto ya no está disponible. Retíralo del pedido.');
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) throw new Error('La cantidad debe ser de 1 a 99.');
    if (!Number.isSafeInteger(product.precioCentimos) || product.precioCentimos <= 0) throw new Error('El precio de un producto no es válido.');
    const subtotalCentimos = product.precioCentimos * cantidad;
    lineas[String(index)] = { productoId: id, nombre: product.nombre, precioCentimos: product.precioCentimos, cantidad, subtotalCentimos };
    totalCentimos += subtotalCentimos;
  });
  if (totalCentimos > 10000000) throw new Error('El total máximo por pedido es S/ 100 000.');
  return { lineas, totalCentimos };
}

export function paymentAmounts(total: number, received: number, method: PaymentMethod) {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(received) || received < total || received > 10000000) throw new Error('El monto recibido debe cubrir el total (máximo S/ 100 000).');
  if (method !== 'Efectivo' && received !== total) throw new Error('El pago digital o con tarjeta debe coincidir con el total.');
  return { recibidoCentimos: received, vueltoCentimos: received - total };
}

export function limaDate(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function summarizeSales(orders: Entry<Order>[], from: string, to: string) {
  const paid = orders.filter(order => order.estado === 'pagado' && order.pago && limaDate(order.pago.fecha) >= from && limaDate(order.pago.fecha) <= to);
  const total = paid.reduce((sum, order) => sum + order.totalCentimos, 0);
  const byMethod = paymentMethods.map(method => ({ method, total: paid.filter(order => order.pago?.metodo === method).reduce((sum, order) => sum + order.totalCentimos, 0) }));
  const ranking = new Map<string, { nombre: string; cantidad: number; total: number }>();
  for (const order of paid) for (const line of orderLines(order)) {
    const previous = ranking.get(line.productoId) ?? { nombre: line.nombre, cantidad: 0, total: 0 };
    ranking.set(line.productoId, { nombre: line.nombre, cantidad: previous.cantidad + line.cantidad, total: previous.total + line.subtotalCentimos });
  }
  return { paid, total, average: paid.length ? Math.round(total / paid.length) : 0, byMethod, ranking: [...ranking.values()].sort((a, b) => b.cantidad - a.cantidad) };
}
