import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { ChefHat, LayoutDashboard, Utensils, ClipboardList, Receipt, LogOut, ShieldCheck, CircleAlert, PanelTop, Flame, ChartColumn } from 'lucide-react';
import { auth, configured, db } from './lib/firebase';
import Catalog from './components/Catalog';
import Floor from './components/Floor';
import Kitchen from './components/Kitchen';
import Cashier from './components/Cashier';
import Reports, { Overview } from './components/Reports';

type Role = 'administrador'|'mozo'|'cocina'|'cajero';
type Profile = { nombre: string; rol: Role; activo: boolean };
const modules = [
  {title:'Panel general',role:'administrador',icon:LayoutDashboard,desc:'Indicadores y supervisión'},
  {title:'Mesas y productos',role:'administrador',icon:Utensils,desc:'Administración de carta y mesas'},
  {title:'Pedidos en sala',role:'mozo',icon:ClipboardList,desc:'Atención y comandas'},
  {title:'Pantalla de cocina',role:'cocina',icon:ChefHat,desc:'Comandas en tiempo real'},
  {title:'Caja y pagos',role:'cajero',icon:Receipt,desc:'Precuentas y cobros'},
  {title:'Reportes',role:'administrador',icon:ChartColumn,desc:'Ventas por fecha, método y producto'},
];
function Login() {
  const [email,setEmail] = useState(''); const [password,setPassword] = useState('');
  const [error,setError] = useState(''); const [loading,setLoading] = useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setError('');setLoading(true); try {await signInWithEmailAndPassword(auth,email,password);} catch {setError('No se pudo ingresar. Revisa el correo, la contraseña y que el usuario esté creado en Firebase Authentication.');} finally{setLoading(false);} }
  return <main className="login-page"><section className="login-panel"><div className="brand-title"><span className="logo"><Flame size={27}/></span><div><strong>BrasaGest</strong><small>Gestión inteligente para pollerías</small></div></div><div className="welcome"><span className="eyebrow">SISTEMA DE GESTIÓN</span><h1>¡Bienvenido de nuevo!</h1><p>Accede al panel de tu establecimiento con tus credenciales.</p></div>{!configured&&<div className="notice"><CircleAlert size={18}/> Primero configura el archivo .env con los datos de Firebase, incluida VITE_FIREBASE_DATABASE_URL.</div>}<form onSubmit={submit}><label>Correo electrónico<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="ejemplo@polleria.com"/></label><label>Contraseña<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></label>{error&&<p className="error">{error}</p>}<button className="primary" disabled={loading||!configured}>{loading?'Ingresando...':'Iniciar sesión'}</button></form><p className="footnote">Acceso exclusivo para personal autorizado</p></section><aside className="login-visual"><div className="visual-inner"><span className="visual-icon"><ChefHat size={42}/></span><h2>Cada pedido, bajo control.</h2><p>Mesas, comandas, cocina y caja conectadas en un solo lugar.</p><div className="preview"><span>01 · Pedido recibido</span><span>02 · En preparación</span><span>03 · Listo para entregar</span></div></div></aside></main>;
}
const FOCUS_KEY = 'brasagest-cocina-pantalla-completa';
function readFocus() { try { return localStorage.getItem(FOCUS_KEY) === '1'; } catch { return false; } }
function saveFocus(on: boolean) { try { if (on) localStorage.setItem(FOCUS_KEY, '1'); else localStorage.removeItem(FOCUS_KEY); } catch { /* sin almacenamiento */ } }

function Dashboard({user,profile}:{user:User;profile:Profile}){
  const [selectedModule,setSelected] = useState<string>(() => readFocus() ? 'Pantalla de cocina' : 'Panel general');
  const allowed = modules.filter(m=>profile.rol==='administrador'||m.role===profile.rol);
  const selected = allowed.some(m => m.title === selectedModule) ? selectedModule : allowed[0].title;

  // Pantalla completa de cocina: oculta la barra lateral y, si el navegador lo permite,
  // también las barras del navegador. Se recuerda al recargar (útil en la pantalla de la cocina).
  const [kitchenFocus,setKitchenFocus] = useState(readFocus);
  function toggleKitchenFocus() {
    const on = !kitchenFocus;
    setKitchenFocus(on); saveFocus(on);
    if (on) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  useEffect(() => {
    // Si sale con la tecla Esc, también se sale del modo cocina.
    const onChange = () => { if (!document.fullscreenElement) { setKitchenFocus(false); saveFocus(false); } };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  if (kitchenFocus && selected === 'Pantalla de cocina') {
    return <main className="kitchen-focus-page"><Kitchen focus onToggleFocus={toggleKitchenFocus}/></main>;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-title"><span className="logo"><Flame size={25}/></span><div><strong>BrasaGest</strong><small>Panel de gestión</small></div></div>
      <div className="side-label">ESPACIO DE TRABAJO</div>
      <nav aria-label="Menú principal">{allowed.map(m => <button key={m.title} title={m.title} aria-label={m.title} aria-current={selected === m.title ? 'page' : undefined} className={`navitem ${selected === m.title ? 'active' : ''}`} onClick={() => setSelected(m.title)}><m.icon size={19}/><span>{m.title}</span></button>)}</nav>
      <div className="side-bottom"><span className="avatar">{profile.nombre?.[0]?.toUpperCase() || 'U'}</span><div className="who"><strong>{profile.nombre}</strong><small>{profile.rol}</small></div><button className="logout" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => signOut(auth)}><LogOut size={19}/></button></div>
    </aside>
    <main className="main"><header className="topbar"><span><PanelTop size={17}/> Sistema de pollería <b>/</b> {selected}</span><span className="dot-status">Sesión activa</span></header>
      <section className="content"><span className="eyebrow">PANEL DE CONTROL</span><h1>{selected}</h1>
        <p className="subhead">{selected === 'Mesas y productos' ? 'Todo listo para organizar tu salón y preparar la carta.' : <>Hola, {profile.nombre}. Has iniciado sesión con el rol <strong>{profile.rol}</strong>.</>}</p>
        {selected === 'Mesas y productos' && profile.rol === 'administrador' ? <Catalog/> : selected === 'Pedidos en sala' ? <Floor role={profile.rol}/> : selected === 'Pantalla de cocina' ? <Kitchen onToggleFocus={toggleKitchenFocus}/> : selected === 'Caja y pagos' ? <Cashier/> : selected === 'Reportes' && profile.rol === 'administrador' ? <Reports/> : <>
          <Overview/>
          <div className="hero"><div><span className="hero-label"><ShieldCheck size={15}/> Operación en tiempo real</span><h2>Del pedido al cobro, en un solo lugar</h2><p>Organiza tu salón, envía los pedidos a cocina, registra los pagos y consulta las ventas del día.</p><button className="primary" onClick={() => setSelected('Pedidos en sala')}>Abrir pedidos en sala</button></div><div className="hero-emblem"><Flame size={58}/></div></div>
          <h3>Módulos del sistema</h3><div className="cards">{allowed.filter(m => m.title !== 'Panel general').map(m => <article key={m.title} className="module-card"><span className="module-icon"><m.icon size={24}/></span><h4>{m.title}</h4><p>{m.desc}</p><button className="text-button" onClick={() => setSelected(m.title)}>Abrir módulo →</button></article>)}</div>
        </>}
        <p className="footer-note">Usuario autenticado: {user.email}</p>
      </section>
    </main>
  </div>;
}
export default function App(){
  const [user,setUser] = useState<User|null>(null);const [profile,setProfile] = useState<Profile|null>(null);const [pending,setPending] = useState(true);const [profileError,setProfileError] = useState('');
  useEffect(()=>onAuthStateChanged(auth,u=>{setUser(u);setProfile(null);setProfileError('');setPending(false);}),[]);
  useEffect(() => {
    if (!user) return;
    if (!db) {
      setProfileError('Falta configurar VITE_FIREBASE_DATABASE_URL en el archivo .env.');
      return;
    }
    return onValue(ref(db, `usuarios/${user.uid}`), snapshot => {
      const data = snapshot.val();
      if (data && ['administrador', 'mozo', 'cocina', 'cajero'].includes(data.rol) && data.activo === true) {
        setProfile({ nombre: String(data.nombre || user.email), rol: data.rol as Role, activo: true });
        setProfileError('');
      } else {
        setProfile(null);
        setProfileError('Tu usuario aún no tiene un perfil activo y válido en Realtime Database (usuarios/' + user.uid + '). Contacta al administrador.');
      }
    }, () => {
      setProfile(null);
      setProfileError('No se pudo consultar el perfil. Revisa las reglas de Realtime Database, la URL de la base de datos y la conexión.');
    });
  }, [user]);
  if(pending)return <div className="loader">Verificando sesión...</div>;
  if(!user)return <Login/>;
  if(!profile)return <div className="blocked"><div className="blocked-card"><span className="logo"><ShieldCheck/></span><h2>Acceso pendiente</h2><p>{profileError||'Cargando perfil...'}</p><button onClick={()=>signOut(auth)}>Cerrar sesión</button></div></div>;
  return <Dashboard user={user} profile={profile}/>;
}
