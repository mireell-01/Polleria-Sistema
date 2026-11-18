import { useState, type FormEvent } from 'react';
import { Armchair, Minus, Plus, Send, Trash2 } from 'lucide-react';
import { auth } from '../lib/firebase';
import { categories, formatPrice, type Entry, type Product } from '../lib/catalog';
import { addToOrder, advanceOrder, cancelOrder, createOrder, orderError } from '../lib/orders';
import { buildLines, canWaiterCancel, isOpen, nextAdditionalSlot, progressState, readyBatches, stateLabels, type Order, type Role } from '../lib/order-model';
import { Feedback, OrderDetails, OrderModal, useConnection, useMenu, useOrders } from './OrderShared';

function Composer({ table, products, occupied, existingOrder, connected, close, complete }: { table: string; products: Entry<Product>[]; occupied: boolean; existingOrder?: Entry<Order>; connected: boolean; close: () => void; complete: () => void }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = products.filter(product => product.activo && (!category || product.categoria === category) && product.nombre.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  const selected = Object.entries(quantities).filter(([, quantity]) => quantity > 0);
  const total = selected.reduce((sum, [id, quantity]) => sum + (products.find(product => product.id === id)?.precioCentimos ?? 0) * quantity, 0);
  const invalid = selected.some(([id]) => !products.find(product => product.id === id)?.activo);
  const blocked = existingOrder ? !isOpen(existingOrder) ? 'El pedido ya se cerró. Cierra esta ventana y revisa la mesa.' : Object.keys(existingOrder.adicionales ?? {}).length >= 10 ? 'Se alcanzó el máximo de 10 comandas adicionales.' : '' : occupied ? 'Esta mesa acaba de recibir otro pedido. Cierra el formulario para verlo.' : '';
  function change(id: string, value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 99) return;
    setError('');
    if (!quantities[id] && value && selected.length >= 20) { setError('Máximo 20 productos diferentes por pedido.'); return; }
    setQuantities(previous => ({ ...previous, [id]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !connected || blocked || invalid) return;
    setError('');
    try {
      const lines = buildLines(products, quantities);
      if (existingOrder) nextAdditionalSlot(existingOrder, lines.totalCentimos);
      setBusy(true);
      if (existingOrder) await addToOrder(existingOrder, products, quantities, notes);
      else await createOrder(table, products, quantities, notes);
      complete();
    } catch (reason) { setError(orderError(reason)); }
    finally { setBusy(false); }
  }
  return <OrderModal title={`${existingOrder ? 'Agregar productos' : 'Nuevo pedido'} · Mesa ${table}`} busy={busy} close={close}>
    <form className="catalog-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <div className="catalog-filters"><input aria-label="Buscar en la carta" placeholder="Buscar en la carta…" value={search} onChange={event => setSearch(event.target.value)}/><select aria-label="Categoría de la carta" value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="menu-picker">{available.map(product => <div className="menu-choice" key={product.id}><span><b>{product.nombre}</b><small>{formatPrice(product.precioCentimos)}</small></span><button className="secondary" type="button" aria-label={`Agregar ${product.nombre}`} onClick={() => change(product.id, (quantities[product.id] ?? 0) + 1)} disabled={(quantities[product.id] ?? 0) >= 99}><Plus size={17}/></button></div>)}{!available.length && <p className="field-help">No hay productos disponibles con ese filtro.</p>}</div>
        <h3 className="section-label">{existingOrder ? 'Productos adicionales' : 'Tu pedido'}</h3>
        {!selected.length && <p className="field-help">Agrega productos de la carta para enviar el pedido.</p>}
        <div className="cart-lines">{selected.map(([id, quantity]) => {
          const product = products.find(item => item.id === id);
          return <div key={id} className="cart-line"><span><b>{product?.nombre ?? 'Producto eliminado'}</b><small>{product?.activo ? formatPrice(product.precioCentimos * quantity) : 'Ya no está disponible; retíralo del pedido.'}</small></span><div className="quantity-control"><button type="button" className="icon-button" aria-label={`Restar ${product?.nombre}`} onClick={() => change(id, quantity - 1)}><Minus size={15}/></button><input type="number" min="1" max="99" step="1" aria-label={`Cantidad de ${product?.nombre}`} value={quantity} onChange={event => change(id, Number(event.target.value))}/><button type="button" className="icon-button" aria-label={`Sumar ${product?.nombre}`} disabled={quantity === 99} onClick={() => change(id, quantity + 1)}><Plus size={15}/></button><button type="button" className="icon-button delete-button" aria-label={`Retirar ${product?.nombre}`} onClick={() => change(id, 0)}><Trash2 size={16}/></button></div></div>;
        })}</div>
        <label>Indicaciones para cocina <span className="optional">(opcional)</span><textarea maxLength={300} rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ej. Sin ensalada, papas bien doradas"/></label>
      </fieldset>
      {existingOrder && <div className="additional-summary"><span>Cuenta actual: {formatPrice(existingOrder.totalCentimos)}</span><span>Adicionales: {formatPrice(total)}</span></div>}
      <div className="order-total"><span>{existingOrder ? 'Nuevo total acumulado' : 'Total'}</span><strong>{formatPrice(total + (existingOrder?.totalCentimos ?? 0))}</strong></div>
      <Feedback connected={connected} error={error || blocked}/>
      <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancelar</button><button className="primary add-button" disabled={busy || !connected || !!blocked || invalid || !selected.length}><Send size={16}/>{busy ? 'Enviando…' : existingOrder ? 'Enviar adicionales a cocina' : 'Enviar a cocina'}</button></div>
      <p className="field-help composer-help">{existingOrder ? 'Cocina recibirá una comanda nueva con estos productos. Lo enviado anteriormente conserva sus precios y su estado.' : 'Revisa el pedido antes de enviarlo. Los productos y precios quedan registrados al confirmar.'}</p>
    </form>
  </OrderModal>;
}

export function CancelOrderDialog({ order, connected, close, complete }: { order: Entry<Order>; connected: boolean; close: () => void; complete: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !connected) return;
    setBusy(true); setError('');
    try { await cancelOrder(order, reason); complete(); }
    catch (failure) { setError(orderError(failure)); }
    finally { setBusy(false); }
  }
  return <OrderModal title={`Cancelar pedido · Mesa ${order.mesaId}`} busy={busy} close={close}><form className="catalog-form" onSubmit={submit}><p>El pedido quedará registrado como cancelado y la mesa volverá a estar libre.</p><label>Motivo<textarea autoFocus required maxLength={200} value={reason} disabled={busy} onChange={event => setReason(event.target.value)}/></label><Feedback connected={connected} error={error}/><div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Volver</button><button className="danger" disabled={busy || !connected || !reason.trim()}>{busy ? 'Cancelando…' : 'Confirmar cancelación'}</button></div></form></OrderModal>;
}

export default function Floor({ role }: { role: Role }) {
  const menu = useMenu();
  const { orders, loading, error: loadError } = useOrders();
  const connected = useConnection();
  const [table, setTable] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [additionalId, setAdditionalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const activeOrders = orders.filter(isOpen);
  const detail = orders.find(order => order.id === detailId);
  const cancellation = orders.find(order => order.id === cancelId);
  const additionalOrder = orders.find(order => order.id === additionalId);
  const disabled = loading || menu.loading || !connected || !!menu.error || !!loadError;
  async function delivered(order: Entry<Order>, batchId = 'inicial') {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try { await advanceOrder(order, 'entregado', batchId); setMessage(`Mesa ${order.mesaId}: ${batchId === 'inicial' ? 'comanda inicial entregada' : `adicional ${Number(batchId) + 1} entregado`}.`); }
    catch (reason) { setError(orderError(reason)); }
    finally { setBusy(false); }
  }
  function openTable(id: string) { setMessage(''); setError(''); const orderId = menu.occupancy[id]; if (orderId) setDetailId(orderId); else setTable(id); }
  return <div className="operations">
    <div className="catalog-stats"><div><div><strong>{menu.loading ? '—' : menu.tables.filter(item => item.activa && !menu.occupancy[item.id]).length}</strong><span>Mesas libres</span></div></div><div><div><strong>{loading ? '—' : activeOrders.length}</strong><span>Pedidos abiertos</span></div></div><div><div><strong>{loading ? '—' : activeOrders.reduce((sum, item) => sum + readyBatches(item).length, 0)}</strong><span>Comandas listas para servir</span></div></div></div>
    <Feedback loading={loading || menu.loading} connected={connected} error={error || menu.error || loadError} message={message}/>
    <section className="catalog-panel"><h2>Salón</h2><p className="catalog-description">Elige una mesa libre para tomar un pedido o una mesa ocupada para ver su avance.</p><div className="table-grid">{menu.tables.filter(item => item.activa || menu.occupancy[item.id]).map(item => {
      const order = orders.find(value => value.id === menu.occupancy[item.id]);
      const occupied = !!menu.occupancy[item.id];
      return <button key={item.id} className={`floor-table ${occupied ? 'occupied' : ''}`} disabled={disabled} onClick={() => openTable(item.id)}><Armchair size={29}/><strong>Mesa {item.numero}</strong><span>{item.capacidad} personas</span><span className={`order-status state-${order ? progressState(order) : 'libre'}`}>{order ? stateLabels[progressState(order)] : occupied ? 'Ocupada' : 'Libre'}</span>{order && <b>{formatPrice(order.totalCentimos)}</b>}</button>;
    })}</div>{!menu.loading && !menu.tables.some(item => item.activa || menu.occupancy[item.id]) && <p className="catalog-empty">No hay mesas habilitadas. Regístralas en Mesas y productos.</p>}</section>
    <section className="catalog-panel"><h2>Pedidos en atención</h2><div className="orders-grid">{activeOrders.map(order => <article className="order-card" key={order.id}><h3>Mesa {order.mesaId}</h3><OrderDetails order={order}/><div className="order-actions"><button className="secondary" disabled={busy || disabled || Object.keys(order.adicionales ?? {}).length >= 10} onClick={() => { setMessage(''); setAdditionalId(order.id); }}><Plus size={15}/> Agregar productos</button>{readyBatches(order).map(batch => <button key={batch.id} className="primary" disabled={busy || disabled} onClick={() => delivered(order, batch.id)}>{busy ? 'Guardando…' : `Entregar ${batch.label.toLowerCase()}`}</button>)}{(role === 'administrador' || canWaiterCancel(order, auth.currentUser?.uid)) && <button className="text-button delete-button" disabled={busy || disabled} onClick={() => setCancelId(order.id)}>Cancelar pedido</button>}</div></article>)}</div>{!loading && !activeOrders.length && <p className="catalog-empty">Aún no hay pedidos abiertos.</p>}</section>
    {table && <Composer table={table} products={menu.products} occupied={!!menu.occupancy[table]} connected={connected} close={() => setTable(null)} complete={() => { setMessage(`Pedido de la mesa ${table} enviado a cocina.`); setTable(null); }}/>} 
    {additionalOrder && <Composer table={additionalOrder.mesaId} existingOrder={additionalOrder} products={menu.products} occupied={true} connected={connected} close={() => setAdditionalId(null)} complete={() => { setMessage(`Productos adicionales de la mesa ${additionalOrder.mesaId} enviados a cocina.`); setAdditionalId(null); }}/>} 
    {detail && <OrderModal title={`Mesa ${detail.mesaId}`} busy={busy} close={() => setDetailId(null)}><OrderDetails order={detail}/><Feedback error={error} connected={connected}/><div className="dialog-actions"><button className="secondary" disabled={busy} onClick={() => setDetailId(null)}>Cerrar</button>{isOpen(detail) && <button className="secondary" disabled={busy || disabled || Object.keys(detail.adicionales ?? {}).length >= 10} onClick={() => { setAdditionalId(detail.id); setDetailId(null); }}>Agregar productos</button>}{readyBatches(detail).map(batch => <button key={batch.id} className="primary" disabled={busy || disabled} onClick={() => delivered(detail, batch.id)}>Entregar {batch.label.toLowerCase()}</button>)}</div></OrderModal>}
    {cancellation && <CancelOrderDialog order={cancellation} connected={connected} close={() => setCancelId(null)} complete={() => { setMessage(`Pedido de la mesa ${cancellation.mesaId} cancelado.`); setCancelId(null); }}/>} 
  </div>;
}
