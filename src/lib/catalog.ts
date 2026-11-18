import { onValue, push, ref, remove, runTransaction, set, update } from 'firebase/database';
import { db } from './firebase';

export const categories = ['Pollos', 'Combos', 'Guarniciones', 'Bebidas', 'Postres', 'Otros'] as const;
export type Category = typeof categories[number];
export type Table = { numero: number; capacidad: number; activa: boolean };
export type Product = { nombre: string; categoria: Category; precioCentimos: number; descripcion: string; activo: boolean };
export type Entry<T> = T & { id: string };

function database() {
  if (!db) throw new Error('No se pudo conectar con la base de datos.');
  return db;
}

export function watchCollection<T>(path: 'mesas' | 'productos', receive: (items: Entry<T>[]) => void, fail: (error: Error) => void) {
  return onValue(ref(database(), path), snapshot => {
    const items: Entry<T>[] = [];
    snapshot.forEach(child => { items.push({ ...child.val(), id: child.key }); });
    receive(items);
  }, fail);
}

export function watchConnection(receive: (connected: boolean) => void) {
  return onValue(ref(database(), '.info/connected'), snapshot => receive(snapshot.val() === true));
}

export async function saveTable(value: Table, editing: boolean) {
  const target = ref(database(), `mesas/${value.numero}`);
  if (editing) {
    // Only change editable fields; a deleted table cannot be recreated by an old form.
    await update(target, { capacidad: value.capacidad, activa: value.activa });
  } else {
    const result = await runTransaction(target, current => current === null ? value : undefined, { applyLocally: false });
    if (!result.committed) throw new Error(`La mesa ${value.numero} ya existe. Usa otro número.`);
  }
}

export async function saveProduct(value: Product, id?: string) {
  if (id) {
    const result = await runTransaction(ref(database(), `productos/${id}`), current => current === null ? null : value, { applyLocally: false });
    if (!result.snapshot.exists()) throw new Error('Este producto ya fue eliminado. Cierra el formulario y crea uno nuevo.');
  } else {
    await set(push(ref(database(), 'productos')), value);
  }
}

export function deleteEntry(path: 'mesas' | 'productos', id: string) {
  return remove(ref(database(), `${path}/${id}`));
}

export function catalogError(error: unknown) {
  if (error instanceof Error) {
    if (/permission[_ -]denied/i.test(error.message)) return 'No se pudo guardar. Comprueba que tu usuario siga siendo administrador y actualiza la página.';
    if (/network|disconnected|unavailable/i.test(error.message)) return 'No hay conexión. Revisa tu internet e inténtalo nuevamente.';
    return error.message;
  }
  return 'No se pudo completar la operación. Inténtalo nuevamente.';
}

export function parsePrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10000000 ? cents : null;
}

export const formatPrice = (cents: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(cents / 100);
