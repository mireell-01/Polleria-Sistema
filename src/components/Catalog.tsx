import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Armchair, CheckCircle2, Pencil, Plus, Search, Trash2, Utensils, X } from 'lucide-react';
import { categories, catalogError, deleteEntry, formatPrice, parsePrice, saveProduct, saveTable, watchCollection, watchConnection, type Entry, type Product, type Table } from '../lib/catalog';
import { watchOccupancy } from '../lib/orders';

type Editor = { kind: 'mesas'; item?: Entry<Table> } | { kind: 'productos'; item?: Entry<Product> };
type Deletion = { path: 'mesas' | 'productos'; id: string; label: string };

function useCollection<T>(path: 'mesas' | 'productos') {
  const [items, setItems] = useState<Entry<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => watchCollection<T>(path, values => {
    setItems(values); setLoading(false); setError('');
  }, () => {
    setItems([]); setLoading(false); setError('No se pudieron cargar los datos. Comprueba tu conexión y tus permisos de administrador.');
  }), [path]);
  return { items, loading, error };
}

function Modal({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="catalog-dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" aria-label="Cerrar formulario" disabled={busy} onClick={close}><X size={21}/></button></div>
    {children}
  </dialog>;
}

function EditorForm({ editor, occupied, connected, close, complete }: { editor: Editor; occupied: boolean; connected: boolean; close: () => void; complete: (message: string) => void }) {
  const table = editor.kind === 'mesas' ? editor.item : undefined;
  const product = editor.kind === 'productos' ? editor.item : undefined;
  const [numero, setNumero] = useState(String(table?.numero ?? ''));
  const [capacidad, setCapacidad] = useState(String(table?.capacidad ?? 4));
  const [nombre, setNombre] = useState(product?.nombre ?? '');
  const [categoria, setCategoria] = useState<Product['categoria']>(product?.categoria ?? 'Pollos');
  const [precio, setPrecio] = useState(product ? (product.precioCentimos / 100).toFixed(2) : '');
  const [descripcion, setDescripcion] = useState(product?.descripcion ?? '');
  const [active, setActive] = useState(table?.activa ?? product?.activo ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isTable = editor.kind === 'mesas';
  const title = `${editor.item ? 'Editar' : isTable ? 'Nueva' : 'Nuevo'} ${isTable ? 'mesa' : 'producto'}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !connected) return;
    setError('');
    if (isTable && (!Number.isInteger(Number(numero)) || Number(numero) < 1 || Number(numero) > 999 || !Number.isInteger(Number(capacidad)) || Number(capacidad) < 1 || Number(capacidad) > 30)) {
      setError('Ingresa un número de mesa de 1 a 999 y una capacidad de 1 a 30 personas.'); return;
    }
    const cents = parsePrice(precio);
    if (!isTable && (!nombre.trim() || nombre.trim().length > 100 || cents === null)) {
      setError('Escribe el nombre y un precio mayor que cero, con hasta dos decimales (máximo S/ 100 000).'); return;
    }
    setBusy(true);
    try {
      if (isTable) await saveTable({ numero: Number(numero), capacidad: Number(capacidad), activa: active }, !!editor.item);
      else await saveProduct({ nombre: nombre.trim(), categoria, precioCentimos: cents!, descripcion: descripcion.trim(), activo: active }, product?.id);
      complete(isTable ? `Mesa ${numero} guardada.` : `${nombre.trim()} guardado.`);
    } catch (reason) { setError(catalogError(reason)); }
    finally { setBusy(false); }
  }

  return <Modal title={title} busy={busy} close={close}>
    <form className="catalog-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        {isTable ? <>
          <div className="form-row"><label>Número de mesa<input autoFocus={!table} type="number" min="1" max="999" step="1" required value={numero} disabled={!!table} onChange={e => setNumero(e.target.value)} placeholder="Ej. 1"/></label>
          <label>Capacidad (personas)<input autoFocus={!!table} type="number" min="1" max="30" step="1" required value={capacidad} onChange={e => setCapacidad(e.target.value)}/></label></div>
          {table && <p className="field-help">El número identifica la mesa y no se puede cambiar.</p>}
        </> : <>
          <label>Nombre del producto<input autoFocus required maxLength={100} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. 1/4 de pollo con papas"/></label>
          <div className="form-row"><label>Categoría<select value={categoria} onChange={e => setCategoria(e.target.value as Product['categoria'])}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
          <label>Precio (S/)<input required inputMode="decimal" value={precio} onChange={e => setPrecio(e.target.value)} placeholder="Ej. 18.50" maxLength={12}/></label></div>
          <label>Descripción <span className="optional">(opcional)</span><textarea maxLength={300} rows={3} value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Porción, acompañamientos o presentación"/></label>
        </>}
        <label className="checkbox-label"><input type="checkbox" checked={active} disabled={isTable && occupied} onChange={e => setActive(e.target.checked)}/>{isTable ? 'Mesa habilitada' : 'Producto disponible'}</label>
        <p className="field-help">{isTable ? occupied ? 'Esta mesa tiene un pedido abierto. Debe cerrarse antes de deshabilitarla o eliminarla.' : 'Deshabilita la mesa cuando no esté en uso en tu local.' : 'Puedes marcar un producto como no disponible sin borrarlo de la carta.'}</p>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      {!connected && <p className="notice" role="status">Sin conexión. {busy ? 'El guardado se completará al recuperar la conexión.' : 'Espera a que vuelva la conexión para guardar.'}</p>}
      <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy || !connected}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  </Modal>;
}

function DeleteDialog({ entry, connected, close, complete }: { entry: Deletion; connected: boolean; close: () => void; complete: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (busy || !connected) return;
    setBusy(true); setError('');
    try { await deleteEntry(entry.path, entry.id); complete(`${entry.label} eliminado.`); }
    catch (reason) { setError(catalogError(reason)); }
    finally { setBusy(false); }
  }
  return <Modal title="Confirmar eliminación" busy={busy} close={close}>
    <p>¿Eliminar <strong>{entry.label}</strong>? Esta acción no se puede deshacer.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!connected && <p className="notice" role="status">Sin conexión. {busy ? 'La eliminación se completará al recuperar la conexión.' : 'Espera a que vuelva la conexión.'}</p>}
    <div className="dialog-actions"><button className="secondary" disabled={busy} onClick={close}>Cancelar</button><button className="danger" disabled={busy || !connected} onClick={confirm}>{busy ? 'Eliminando…' : 'Eliminar'}</button></div>
  </Modal>;
}

export default function Catalog() {
  const tables = useCollection<Table>('mesas');
  const products = useCollection<Product>('productos');
  const [tab, setTab] = useState<'mesas' | 'productos'>('mesas');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [message, setMessage] = useState('');
  const [connected, setConnected] = useState(false);
  const [occupancy, setOccupancy] = useState<Record<string, string>>({});
  useEffect(() => watchConnection(setConnected), []);
  useEffect(() => watchOccupancy(setOccupancy), []);
  const current = tab === 'mesas' ? tables : products;
  const activeTables = tables.items.filter(table => table.activa);
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visibleProducts = products.items.filter(product => (!category || product.categoria === category) && normalize(`${product.nombre} ${product.descripcion}`).includes(normalize(query))).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const complete = (text: string) => { setEditor(null); setDeletion(null); setMessage(text); };
  const create = () => { setMessage(''); setEditor(tab === 'mesas' ? { kind: 'mesas' } : { kind: 'productos' }); };
  const disabled = !connected || current.loading || !!current.error;

  return <div className="catalog">
    <div className="catalog-stats">
      <div><span className="stat-icon"><Armchair size={23}/></span><div><strong>{tables.loading || tables.error ? '—' : activeTables.length}</strong><span>Mesas habilitadas</span></div></div>
      <div><span className="stat-icon"><Utensils size={23}/></span><div><strong>{products.loading || products.error ? '—' : products.items.filter(product => product.activo).length}</strong><span>Productos disponibles</span></div></div>
      <div><span className="stat-icon"><CheckCircle2 size={23}/></span><div><strong>{tables.loading || tables.error ? '—' : activeTables.reduce((sum, table) => sum + table.capacidad, 0)}</strong><span>Asientos habilitados</span></div></div>
    </div>
    <div className="catalog-panel">
      <div className="catalog-toolbar"><div className="catalog-tabs" aria-label="Secciones del catálogo">{(['mesas', 'productos'] as const).map(value => <button key={value} aria-pressed={tab === value} className={tab === value ? 'selected' : ''} onClick={() => { setTab(value); setMessage(''); }}>{value === 'mesas' ? 'Mesas' : 'Productos'}</button>)}</div>
        <button className="primary add-button" disabled={disabled} onClick={create}><Plus size={18}/>{tab === 'mesas' ? 'Nueva mesa' : 'Nuevo producto'}</button>
      </div>
      <p className="catalog-description">{tab === 'mesas' ? 'Organiza las mesas de tu local y define cuántas personas pueden sentarse.' : 'Administra tu carta, los precios y la disponibilidad de cada producto.'}</p>
      {message && <p className="success-message" role="status"><CheckCircle2 size={18}/>{message}</p>}
      {!connected && <p className="notice" role="status">Conectando con el sistema… Necesitas conexión para guardar cambios.</p>}
      {current.error && <p className="error" role="alert">{current.error}</p>}
      {tab === 'productos' && <div className="catalog-filters"><label className="search-field"><Search size={18}/><input aria-label="Buscar productos" placeholder="Buscar un producto…" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="Filtrar por categoría" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option>{categories.map(value => <option key={value}>{value}</option>)}</select></div>}
      {current.loading ? <p className="catalog-empty" role="status">Cargando {tab}…</p> : !current.error && (tab === 'mesas' ? <>
        {tables.items.length === 0 ? <div className="catalog-empty"><Armchair size={40}/><h3>Agrega tu primera mesa</h3><p>Asigna un número y su capacidad para empezar a organizar el salón.</p><button className="secondary" disabled={disabled} onClick={create}>Crear mesa</button></div> : <div className="table-grid">{[...tables.items].sort((a, b) => a.numero - b.numero).map(table => <article className={`table-card ${table.activa ? '' : 'inactive'}`} key={table.id}>
          <div className="table-card-top"><span className="table-symbol"><Armchair size={28}/></span><span className={`status-badge ${table.activa ? 'enabled' : ''}`}>{table.activa ? 'Habilitada' : 'Deshabilitada'}</span></div>
          <h3>Mesa {table.numero}</h3><p>{table.capacidad} {table.capacidad === 1 ? 'persona' : 'personas'}{occupancy[table.id] && ' · Pedido abierto'}</p>
          <div className="row-actions"><button className="text-button" disabled={disabled} aria-label={`Editar mesa ${table.numero}`} onClick={() => { setMessage(''); setEditor({ kind: 'mesas', item: table }); }}><Pencil size={16}/>Editar</button><button className="icon-button delete-button" disabled={disabled || !!occupancy[table.id]} title={occupancy[table.id] ? 'Cierra el pedido antes de eliminar la mesa' : 'Eliminar mesa'} aria-label={`Eliminar mesa ${table.numero}`} onClick={() => setDeletion({ path: 'mesas', id: table.id, label: `Mesa ${table.numero}` })}><Trash2 size={17}/></button></div>
        </article>)}</div>}
      </> : <>
        {visibleProducts.length === 0 ? <div className="catalog-empty"><Utensils size={40}/><h3>{products.items.length ? 'Sin coincidencias' : 'Crea tu carta'}</h3><p>{products.items.length ? 'Prueba con otro nombre o categoría.' : 'Agrega tus pollos, combos, bebidas y acompañamientos con sus precios.'}</p>{products.items.length ? <button className="secondary" onClick={() => { setQuery(''); setCategory(''); }}>Limpiar filtros</button> : <button className="secondary" disabled={disabled} onClick={create}>Crear producto</button>}</div> : <div className="product-list">{visibleProducts.map(product => <article className="product-row" key={product.id}>
          <span className="product-symbol"><Utensils size={23}/></span><div className="product-details"><span className="product-category">{product.categoria}</span><h3>{product.nombre}</h3>{product.descripcion && <p>{product.descripcion}</p>}<span className={`status-badge ${product.activo ? 'enabled' : ''}`}>{product.activo ? 'Disponible' : 'No disponible'}</span></div>
          <strong className="product-price">{formatPrice(product.precioCentimos)}</strong><div className="row-actions"><button className="icon-button" disabled={disabled} aria-label={`Editar ${product.nombre}`} onClick={() => { setMessage(''); setEditor({ kind: 'productos', item: product }); }}><Pencil size={18}/></button><button className="icon-button delete-button" disabled={disabled} aria-label={`Eliminar ${product.nombre}`} onClick={() => setDeletion({ path: 'productos', id: product.id, label: product.nombre })}><Trash2 size={18}/></button></div>
        </article>)}</div>}
      </>)}
    </div>
    {editor && <EditorForm editor={editor} occupied={editor.kind === 'mesas' && !!editor.item && !!occupancy[editor.item.id]} connected={connected} close={() => setEditor(null)} complete={complete}/>}
    {deletion && <DeleteDialog entry={deletion} connected={connected} close={() => setDeletion(null)} complete={complete}/>}
  </div>;
}
