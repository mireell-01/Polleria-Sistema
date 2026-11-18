import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { formatPrice, watchCollection, watchConnection, type Entry, type Product, type Table } from '../lib/catalog';
import { watchOccupancy, watchOrders } from '../lib/orders';
import { orderBatches, progressState, stateLabels, type Order } from '../lib/order-model';

export function useOrders() {
  const [orders, setOrders] = useState<Entry<Order>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => watchOrders(values => { setOrders(values); setLoading(false); setError(''); }, () => {
    setOrders([]); setLoading(false); setError('No se pudieron cargar los pedidos. Comprueba tu conexión y los permisos de tu usuario.');
  }), []);
  return { orders, loading, error };
}

export function useConnection() {
  const [connected, setConnected] = useState(false);
  useEffect(() => watchConnection(setConnected), []);
  return connected;
}

export function useMenu() {
  const [tables, setTables] = useState<Entry<Table>[]>([]);
  const [products, setProducts] = useState<Entry<Product>[]>([]);
  const [occupancy, setOccupancy] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState({ tables: false, products: false, occupancy: false });
  const [error, setError] = useState('');
  useEffect(() => {
    const fail = () => setError('No se pudieron cargar las mesas o la carta. Actualiza la página y comprueba tus permisos.');
    const stops = [
      watchCollection<Table>('mesas', values => { setTables(values.sort((a, b) => a.numero - b.numero)); setLoaded(value => ({ ...value, tables: true })); }, fail),
      watchCollection<Product>('productos', values => { setProducts(values.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))); setLoaded(value => ({ ...value, products: true })); }, fail),
      watchOccupancy(values => { setOccupancy(values); setLoaded(value => ({ ...value, occupancy: true })); }, fail),
    ];
    return () => stops.forEach(stop => stop());
  }, []);
  return { tables, products, occupancy, loading: !Object.values(loaded).every(Boolean), error };
}

export function OrderModal({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: ReactNode }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => { element.current?.showModal(); }, []);
  return <dialog ref={element} className="catalog-dialog order-dialog" aria-labelledby="order-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-heading"><h2 id="order-dialog-title">{title}</h2><button className="icon-button" aria-label="Cerrar" disabled={busy} onClick={close}><X size={20}/></button></div>{children}
  </dialog>;
}

export function Feedback({ loading = false, error, connected = true, message }: { loading?: boolean; error?: string; connected?: boolean; message?: string }) {
  return <>{loading && <p role="status" className="notice">Cargando datos…</p>}{!connected && <p role="status" className="notice">Sin conexión con el sistema. Las operaciones en curso esperan la reconexión.</p>}{error && <p role="alert" className="error">{error}</p>}{message && <p role="status" className="success-message">{message}</p>}</>;
}

export const displayTime = (timestamp: number) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp);

export function OrderDetails({ order }: { order: Entry<Order> }) {
  return <>
    <div className="order-meta"><span>Pedido #{order.id.slice(-6)}</span><span>{displayTime(order.creadoEn)}</span></div>
    <span className={`order-status state-${progressState(order)}`}>{stateLabels[progressState(order)]}</span>
    {orderBatches(order).map(batch => <section className="batch-detail" key={batch.id}>
      <div className="batch-heading"><b>{batch.label}</b>{order.adicionales && <span className={`order-status state-${batch.estado}`}>{stateLabels[batch.estado]}</span>}</div>
      {batch.id !== 'inicial' && <small className="order-meta">Enviado: {displayTime(batch.creadoEn)}</small>}
      <ul className="order-lines">{Object.values(batch.lineas).map((line, index) => <li key={index}><span><b>{line.cantidad} ×</b> {line.nombre}<small>{formatPrice(line.precioCentimos)} por unidad</small></span><strong>{formatPrice(line.subtotalCentimos)}</strong></li>)}</ul>
      {batch.observaciones && <p className="order-notes"><b>Indicaciones:</b> {batch.observaciones}</p>}
      {order.adicionales && <p className="batch-subtotal">Subtotal: {formatPrice(batch.totalCentimos)}</p>}
    </section>)}
    <div className="order-total"><span>{order.adicionales ? 'Total acumulado' : 'Total'}</span><strong>{formatPrice(order.totalCentimos)}</strong></div>
    {order.cancelacion && <p className="notice">Cancelación: {order.cancelacion.motivo}</p>}
    {order.pago && <div className="payment-summary"><p>Pago registrado: <b>{order.pago.metodo}</b> · {displayTime(order.pago.fecha)}</p><p>Recibido: {formatPrice(order.pago.recibidoCentimos)} · Vuelto: {formatPrice(order.pago.vueltoCentimos)}</p>{order.pago.referencia && <p>Referencia: {order.pago.referencia}</p>}</div>}
  </>;
}
