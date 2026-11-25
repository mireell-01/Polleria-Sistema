import { useEffect, useState } from 'react';
import { ChefHat, Maximize2, Minimize2 } from 'lucide-react';
import { advanceOrder, orderError } from '../lib/orders';
import { isOpen, orderBatches, type Order, type OrderState } from '../lib/order-model';
import type { Entry } from '../lib/catalog';
import { displayTime, Feedback, useConnection, useOrders } from './OrderShared';

const clock = (timestamp: number) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' }).format(timestamp);

// focus: pantalla solo de cocina (sin barra lateral), para ver mejor las comandas.
export default function Kitchen({ focus = false, onToggleFocus }: { focus?: boolean; onToggleFocus?: () => void }) {
  const { orders, loading, error: loadError } = useOrders();
  const connected = useConnection();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  async function advance(order: Entry<Order>, state: OrderState, batchId: string) {
    if (busy || !connected) return;
    setBusy(`${order.id}/${batchId}`); setError(''); setMessage('');
    try { await advanceOrder(order, state, batchId); setMessage(`Mesa ${order.mesaId}: ${batchId === 'inicial' ? 'comanda inicial' : `adicional ${Number(batchId) + 1}`} ${state === 'preparando' ? 'en preparación' : 'listo para servir'}.`); }
    catch (reason) { setError(orderError(reason)); }
    finally { setBusy(null); }
  }
  const columns = [{ state: 'pendiente', title: 'Por preparar', next: 'preparando', action: 'Iniciar preparación' }, { state: 'preparando', title: 'En preparación', next: 'listo', action: 'Marcar listo' }, { state: 'listo', title: 'Listos para servir' }] as const;
  const pending = orders.filter(isOpen).flatMap(order => orderBatches(order)).filter(batch => batch.estado === 'pendiente' || batch.estado === 'preparando').length;
  const toolbar = focus
    ? <header className="kitchen-focus-bar">
        <span className="kitchen-focus-title"><span className="logo"><ChefHat size={24}/></span><span><strong>Pantalla de cocina</strong><small>{pending} {pending === 1 ? 'comanda pendiente' : 'comandas pendientes'}</small></span></span>
        <span className="kitchen-focus-clock" aria-label="Hora actual">{clock(now)}</span>
        <button className="kitchen-focus-button" onClick={onToggleFocus}><Minimize2 size={18}/> Salir de pantalla completa</button>
      </header>
    : onToggleFocus && <div className="kitchen-toolbar"><button className="kitchen-focus-button" onClick={onToggleFocus} title="Muestra solo las comandas, sin la barra lateral"><Maximize2 size={18}/> Pantalla completa</button></div>;
  return <div className={`operations ${focus ? 'kitchen-focus' : ''}`}>{toolbar}<Feedback loading={loading} error={error || loadError} message={message} connected={connected}/><div className="kitchen-board">{columns.map(column => {
    const items = orders.filter(isOpen).flatMap(order => orderBatches(order).map(batch => ({ order, batch }))).filter(({ batch }) => batch.estado === column.state).sort((a, b) => a.batch.creadoEn - b.batch.creadoEn);
    return <section className={`kitchen-column column-${column.state}`} key={column.state}><h2>{column.title}<span>{items.length}</span></h2>{items.map(({ order, batch }) => <article className="kitchen-ticket" key={`${order.id}/${batch.id}`}><div className="ticket-heading"><h3>Mesa {order.mesaId}</h3><span>{Math.max(0, Math.floor((now - batch.creadoEn) / 60000))} min</span></div><strong className={`batch-label ${batch.id !== 'inicial' ? 'additional-label' : ''}`}>{batch.label}</strong><p className="order-meta">#{order.id.slice(-6)} · {displayTime(batch.creadoEn)}</p><ul className="kitchen-items">{Object.values(batch.lineas).map((line, index) => <li key={index}><b>{line.cantidad}</b><span>{line.nombre}</span></li>)}</ul>{batch.observaciones && <p className="order-notes">{batch.observaciones}</p>}{'next' in column && <button className="primary" disabled={!!busy || !connected || !!loadError} onClick={() => advance(order, column.next, batch.id)}>{busy === `${order.id}/${batch.id}` ? 'Guardando…' : column.action}</button>}</article>)}{!loading && !items.length && <p className="kitchen-empty">No hay comandas en esta etapa.</p>}</section>;
  })}</div></div>;
}
