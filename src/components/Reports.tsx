import { useState } from 'react';
import { formatPrice } from '../lib/catalog';
import { isOpen, limaDate, orderLines, summarizeSales } from '../lib/order-model';
import { displayTime, Feedback, useConnection, useOrders } from './OrderShared';

export function Overview() {
  const { orders, loading, error } = useOrders();
  const connected = useConnection();
  const today = limaDate(Date.now());
  const summary = summarizeSales(orders, today, today);
  return <><Feedback loading={loading} error={error} connected={connected}/><div className="catalog-stats"><div><div><strong>{loading || error ? '—' : formatPrice(summary.total)}</strong><span>Ventas cobradas hoy</span></div></div><div><div><strong>{loading || error ? '—' : orders.filter(isOpen).length}</strong><span>Pedidos abiertos</span></div></div><div><div><strong>{loading || error ? '—' : summary.paid.length}</strong><span>Pedidos cobrados hoy</span></div></div></div></>;
}

export default function Reports() {
  const { orders, loading, error } = useOrders();
  const connected = useConnection();
  const [from, setFrom] = useState(limaDate(Date.now()));
  const [to, setTo] = useState(limaDate(Date.now()));
  const invalid = !from || !to || from > to;
  const summary = summarizeSales(orders, from, to);
  const cancelled = orders.filter(order => order.estado === 'cancelado' && limaDate(order.actualizadoEn) >= from && limaDate(order.actualizadoEn) <= to);
  function exportCsv() {
    const cell = (value: string | number) => {
      let text = String(value);
      if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows: (string | number)[][] = [['Pedido', 'Mesa', 'Fecha (Lima)', 'Método', 'Total (S/)', 'Referencia', 'Productos']];
    for (const order of summary.paid) rows.push([order.id, order.mesaId, `${limaDate(order.pago!.fecha)} ${new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(order.pago!.fecha)}`, order.pago!.metodo, (order.totalCentimos / 100).toFixed(2), order.pago!.referencia ?? '', orderLines(order).map(line => `${line.cantidad} x ${line.nombre}`).join(' | ')]);
    const url = URL.createObjectURL(new Blob(['\ufeff', rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `ventas-${from}-${to}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="operations"><div className="catalog-panel report-filters"><label>Desde<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label>Hasta<input type="date" value={to} onChange={event => setTo(event.target.value)}/></label><button className="secondary" onClick={() => { setFrom(limaDate(Date.now())); setTo(limaDate(Date.now())); }}>Hoy</button><button className="primary" disabled={invalid || loading || !!error || !summary.paid.length} onClick={exportCsv}>Exportar ventas CSV</button></div>
    <Feedback loading={loading} error={invalid ? 'Elige un rango de fechas válido.' : error} connected={connected}/>
    {!invalid && <><p className="catalog-description">Ventas según la fecha del pago registrado, en horario de Lima. Los pedidos abiertos y cancelados no suman ingresos.</p><div className="catalog-stats"><div><div><strong>{formatPrice(summary.total)}</strong><span>Total cobrado</span></div></div><div><div><strong>{summary.paid.length}</strong><span>Pedidos cobrados</span></div></div><div><div><strong>{formatPrice(summary.average)}</strong><span>Promedio por pedido</span></div></div></div>
      <div className="report-columns"><section className="catalog-panel"><h2>Por método de pago</h2><ul className="report-ranking">{summary.byMethod.map(item => <li key={item.method}><span>{item.method}</span><strong>{formatPrice(item.total)}</strong></li>)}</ul></section><section className="catalog-panel"><h2>Productos más vendidos</h2><ul className="report-ranking">{summary.ranking.slice(0, 10).map((item, index) => <li key={index}><span>{item.nombre}<small>{item.cantidad} unidades</small></span><strong>{formatPrice(item.total)}</strong></li>)}</ul>{!summary.ranking.length && <p className="field-help">No hay ventas en este período.</p>}</section></div>
      <section className="catalog-panel"><h2>Detalle de ventas</h2><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Fecha</th><th>Mesa</th><th>Pedido</th><th>Pago</th><th>Total</th></tr></thead><tbody>{[...summary.paid].sort((a, b) => b.pago!.fecha - a.pago!.fecha).map(order => <tr key={order.id}><td>{displayTime(order.pago!.fecha)}</td><td>{order.mesaId}</td><td>#{order.id.slice(-6)}</td><td>{order.pago!.metodo}</td><td>{formatPrice(order.totalCentimos)}</td></tr>)}</tbody></table></div>{!summary.paid.length && <p className="catalog-empty">No hay pagos registrados en estas fechas.</p>}</section>
      <section className="catalog-panel"><h2>Cancelaciones ({cancelled.length})</h2>{cancelled.map(order => <p className="cancellation-row" key={order.id}><b>Mesa {order.mesaId} · #{order.id.slice(-6)}</b><span>{order.cancelacion?.motivo}</span><small>{displayTime(order.actualizadoEn)}</small></p>)}{!cancelled.length && <p className="field-help">Sin cancelaciones en este período.</p>}</section>
    </>}
  </div>;
}
