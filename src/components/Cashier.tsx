import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatPrice, parsePrice, type Entry } from '../lib/catalog';
import { canPay, isOpen, limaDate, paymentAmounts, paymentMethods, type Order, type PaymentMethod } from '../lib/order-model';
import { orderError, payOrder } from '../lib/orders';
import { Feedback, OrderDetails, OrderModal, useConnection, useOrders } from './OrderShared';

function Receipt({ order, close }: { order: Entry<Order>; close: () => void }) {
  const title = order.pago ? 'Registro de pago' : 'Precuenta';
  const contents = <><h2>BrasaGest · {title}</h2><h3>Mesa {order.mesaId}</h3><OrderDetails order={order}/></>;
  return <><OrderModal title={title} busy={false} close={close}><h3>Mesa {order.mesaId}</h3><OrderDetails order={order}/><div className="dialog-actions"><button className="secondary" onClick={close}>Cerrar</button><button className="primary" onClick={() => window.print()}>Imprimir</button></div></OrderModal>{createPortal(<div className="print-receipt">{contents}</div>, document.body)}</>;
}

function Checkout({ order, connected, close, complete }: { order: Entry<Order>; connected: boolean; close: () => void; complete: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('Efectivo');
  const [received, setReceived] = useState((order.totalCentimos / 100).toFixed(2));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cents = method === 'Efectivo' ? parsePrice(received) : order.totalCentimos;
  const change = cents === null ? 0 : cents - order.totalCentimos;
  const valid = cents !== null && change >= 0 && (method === 'Efectivo' || reference.trim());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !connected || !canPay(order) || !valid) return;
    setBusy(true); setError('');
    try {
      paymentAmounts(order.totalCentimos, cents!, method);
      await payOrder(order, method, cents!, reference);
      complete();
    } catch (reason) { setError(orderError(reason)); }
    finally { setBusy(false); }
  }
  return <OrderModal title={`Cobrar · Mesa ${order.mesaId}`} busy={busy} close={close}><OrderDetails order={order}/><form className="catalog-form" onSubmit={submit}>
    <fieldset disabled={busy || !canPay(order)}><label>Método de pago<select value={method} onChange={event => setMethod(event.target.value as PaymentMethod)}>{paymentMethods.map(value => <option key={value}>{value}</option>)}</select></label>
      {method === 'Efectivo' ? <label>Efectivo recibido (S/)<input autoFocus required inputMode="decimal" maxLength={12} value={received} onChange={event => setReceived(event.target.value)}/></label> : <label>Referencia de operación<input required maxLength={80} value={reference} onChange={event => setReference(event.target.value)} placeholder="Número de operación o referencia"/></label>}
    </fieldset><p className="change-amount">Vuelto: <strong>{formatPrice(Math.max(0, change))}</strong></p>
    {cents !== null && change < 0 && <p className="error">El importe recibido no cubre el total.</p>}
    <Feedback error={error || (!canPay(order) ? 'El pedido cambió o tiene comandas sin entregar. Cierra la ventana y revisa el estado actualizado.' : '')} connected={connected}/>
    <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Volver</button><button className="primary" disabled={busy || !connected || !valid || !canPay(order)}>{busy ? 'Registrando…' : 'Registrar pago recibido'}</button></div>
  </form></OrderModal>;
}

export default function Cashier() {
  const { orders, loading, error } = useOrders();
  const connected = useConnection();
  const [tab, setTab] = useState<'pendientes' | 'cobrados'>('pendientes');
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const today = limaDate(Date.now());
  const paid = orders.filter(order => order.estado === 'pagado' && order.pago && limaDate(order.pago.fecha) === today).sort((a, b) => b.pago!.fecha - a.pago!.fecha);
  const open = orders.filter(isOpen);
  const shown = tab === 'pendientes' ? open : paid;
  const checkout = orders.find(order => order.id === checkoutId);
  const receipt = orders.find(order => order.id === receiptId);
  return <div className="operations"><div className="catalog-stats"><div><div><strong>{formatPrice(paid.reduce((sum, order) => sum + order.totalCentimos, 0))}</strong><span>Cobrado hoy</span></div></div><div><div><strong>{open.filter(canPay).length}</strong><span>Listos para cobrar</span></div></div><div><div><strong>{formatPrice(open.reduce((sum, order) => sum + order.totalCentimos, 0))}</strong><span>Consumo pendiente</span></div></div></div>
    <Feedback loading={loading} error={error} message={message} connected={connected}/>
    <div className="catalog-tabs"><button className={tab === 'pendientes' ? 'selected' : ''} aria-pressed={tab === 'pendientes'} onClick={() => setTab('pendientes')}>Por cobrar</button><button className={tab === 'cobrados' ? 'selected' : ''} aria-pressed={tab === 'cobrados'} onClick={() => setTab('cobrados')}>Cobrados hoy</button></div>
    <p className="catalog-description">Se cobra la cuenta completa cuando todas las comandas, incluidos los adicionales, están entregadas. Al cobrar, la mesa queda libre.</p>
    <div className="orders-grid">{shown.map(order => <article className="order-card" key={order.id}><h3>Mesa {order.mesaId}</h3><OrderDetails order={order}/><div className="order-actions"><button className="secondary" onClick={() => setReceiptId(order.id)}>{order.pago ? 'Ver registro' : 'Ver precuenta'}</button>{!order.pago && <button className="primary" disabled={!connected || !!error || !canPay(order)} onClick={() => { setMessage(''); setCheckoutId(order.id); }}>Cobrar</button>}</div></article>)}</div>
    {!loading && !shown.length && <p className="catalog-panel catalog-empty">{tab === 'pendientes' ? 'No hay pedidos pendientes de cobro.' : 'Todavía no hay pagos registrados hoy.'}</p>}
    {checkout && <Checkout order={checkout} connected={connected} close={() => setCheckoutId(null)} complete={() => { setMessage(`Pago registrado. Mesa ${checkout.mesaId} liberada.`); setCheckoutId(null); setReceiptId(checkout.id); }}/>} 
    {receipt && <Receipt order={receipt} close={() => setReceiptId(null)}/>} 
  </div>;
}
