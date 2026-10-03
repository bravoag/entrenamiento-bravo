'use strict';
const VERSION = 'v8';
/* Entrenamiento Bravo — app sin dependencias. Datos en app/data/*.json, progreso en localStorage.
   Para la sincronización (Paso 5) solo hay que cambiar el objeto Store. */

// ---------- Utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fechaStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const aFecha = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const hoy = () => fechaStr(new Date());
const sumaDias = (s, n) => { const d = aFecha(s); d.setDate(d.getDate() + n); return fechaStr(d); };
const lunes = s => sumaDias(s, -((aFecha(s).getDay() + 6) % 7));
const semanaISO = s => {
  const d = aFecha(s); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7);
};
const fechaLarga = s => aFecha(s).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
const fechaCorta = s => aFecha(s).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
const ytUrl = (id, seg) => `https://www.youtube.com/watch?v=${id}${seg ? '&t=' + seg + 's' : ''}`;
const mmss = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
const aSeg = t => t.split(':').reduce((a, x) => a * 60 + (+x || 0), 0);
const ytMini = id => `https://img.youtube.com/vi/${id}/mqdefault.jpg`;

const PERSONAS = {
  natalia: { nombre: 'Naty', completo: 'Natalia', inicial: 'N', color: 'var(--natalia)' },
  adrian: { nombre: 'Adrián', completo: 'Adrián', inicial: 'A', color: 'var(--adrian)' }
};
const OTRO = p => (p === 'natalia' ? 'adrian' : 'natalia');

// ---------- Almacenamiento (local) ----------
const Store = {
  perfil() { try { return localStorage.getItem('eb.perfil'); } catch { return null; } },
  setPerfil(p) { try { localStorage.setItem('eb.perfil', p); } catch { /* sin almacenamiento */ } },
  cargar(p) {
    try { const d = JSON.parse(localStorage.getItem('eb.datos.' + p)); if (d && d.sesiones) return d; } catch { /* vacío */ }
    return { inicio: hoy(), sesiones: {} };
  },
  guardar(p, d) { try { localStorage.setItem('eb.datos.' + p, JSON.stringify(d)); } catch { /* sin almacenamiento */ } Sync.pedir(p); },
  cargarOtro(p) { try { const d = JSON.parse(localStorage.getItem('eb.otro.' + p)); if (d && d.sesiones) return d; } catch { /* vacío */ } return { inicio: hoy(), sesiones: {} }; },
  guardarOtro(p, d) { try { localStorage.setItem('eb.otro.' + p, JSON.stringify(d)); } catch { /* sin almacenamiento */ } }
};

// ---------- Sincronización con GitHub (repo privado de datos) ----------
// Cada persona escribe solo su archivo (natalia.json / adrian.json): no hay conflictos entre celulares.
const b64 = {
  a(str) { const u = new TextEncoder().encode(str); let r = ''; for (let i = 0; i < u.length; i += 8192) r += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(r); },
  de(x) { const bin = atob(x.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
};
const tocar = s => { s.ts = Date.now(); return s; };
const nHechos = s => Object.keys((s && s.hechos) || {}).length;
// Une dos copias: por fecha gana la sesión modificada más recientemente.
function unir(a, b) {
  const r = { inicio: [a.inicio, b.inicio].filter(Boolean).sort()[0] || hoy(), sesiones: {} };
  new Set([...Object.keys(a.sesiones), ...Object.keys(b.sesiones)]).forEach(f => {
    const x = a.sesiones[f], y = b.sesiones[f];
    if (!x || !y) { r.sesiones[f] = x || y; return; }
    r.sesiones[f] = (x.ts || 0) !== (y.ts || 0) ? ((x.ts || 0) > (y.ts || 0) ? x : y) : (nHechos(x) >= nHechos(y) ? x : y);
  });
  return r;
}
const Sync = {
  repo: 'bravoag/entrenamiento-bravo-datos',
  estado: { ok: null, error: '', ocupado: false },
  _t: 0, _ultimo: 0,
  token() { try { return localStorage.getItem('eb.token'); } catch { return null; } },
  setToken(t) { try { t ? localStorage.setItem('eb.token', t) : localStorage.removeItem('eb.token'); } catch { /* sin almacenamiento */ } },
  ultima() { try { return +localStorage.getItem('eb.sync.ok') || 0; } catch { return 0; } },
  api(ruta, op = {}) {
    return fetch(`https://api.github.com/repos/${this.repo}${ruta}`, {
      ...op, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + this.token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(op.body ? { 'Content-Type': 'application/json' } : {}) }
    });
  },
  errorTexto(r) {
    if (r.status === 401) return 'El token no es válido o venció.';
    if (r.status === 403 || r.status === 404) return 'El token no tiene acceso al repo de datos.';
    return 'GitHub respondió ' + r.status + '.';
  },
  async leer(persona) {
    const r = await this.api(`/contents/${persona}.json`);
    if (r.status === 404) {
      // 404 puede ser archivo nuevo o token sin acceso: se distingue consultando el repo.
      const repo = await this.api('');
      if (!repo.ok) throw new Error(this.errorTexto(repo));
      return { datos: null, sha: null };
    }
    if (!r.ok) throw new Error(this.errorTexto(r));
    const j = await r.json();
    return { datos: JSON.parse(b64.de(j.content)), sha: j.sha };
  },
  // Trae la copia remota, la une con la local y la sube si cambió. Devuelve true si cambió lo local.
  async subir(persona, intento = 0) {
    if (!this.token() || !persona) return false;
    this.estado.ocupado = true;
    try {
      const local = Store.cargar(persona);
      const rem = await this.leer(persona);
      const unido = rem.datos ? unir(local, rem.datos) : local;
      const cambioLocal = JSON.stringify(unido) !== JSON.stringify(local);
      if (!rem.datos || JSON.stringify(unido) !== JSON.stringify(rem.datos)) {
        const r = await this.api(`/contents/${persona}.json`, { method: 'PUT', body: JSON.stringify({ message: `Datos de ${persona}`, content: b64.a(JSON.stringify(unido)), ...(rem.sha ? { sha: rem.sha } : {}) }) });
        if ((r.status === 409 || r.status === 422) && intento < 1) { this.estado.ocupado = false; return this.subir(persona, intento + 1); }
        if (!r.ok) throw new Error(r.status === 422 ? 'El repo de datos está vacío: agrega un README en GitHub y reintenta.' : this.errorTexto(r));
      }
      if (cambioLocal) { try { localStorage.setItem('eb.datos.' + persona, JSON.stringify(unido)); } catch { /* sin almacenamiento */ } }
      this.estado.ok = true; this.estado.error = '';
      try { localStorage.setItem('eb.sync.ok', String(Date.now())); } catch { /* sin almacenamiento */ }
      return cambioLocal;
    } catch (e) {
      this.estado.ok = false;
      this.estado.error = e instanceof TypeError ? 'Sin conexión. Se enviará cuando vuelva internet.' : e.message;
      return false;
    } finally { this.estado.ocupado = false; }
  },
  async bajarOtro(persona) {
    if (!this.token()) return;
    try { const r = await this.leer(persona); if (r.datos) Store.guardarOtro(persona, r.datos); } catch { /* se muestra lo último guardado */ }
  },
  pedir(persona) {
    if (!this.token()) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => this.todo(persona), 1500);
  },
  async todo(persona) {
    if (!this.token() || this.estado.ocupado) return;
    this._ultimo = Date.now();
    const cambio = await this.subir(persona);
    await this.bajarOtro(OTRO(persona));
    if (cambio) E.datos = Store.cargar(persona);
    refrescar();
  },
  auto() { if (Date.now() - this._ultimo > 30000) this.todo(E.persona); }
};
function refrescar() {
  if (!E.persona || (location.hash || '').startsWith('#/ej/')) return;
  window.__noScroll = true; render(); window.__noScroll = false;
}

// ---------- Estado ----------
let D = { ej: {}, plan: null };
const E = { persona: null, datos: null, dia: null, verPlan: 'ambos', toastT: 0 };

// ---------- Lógica del plan ----------
const semanaPlan = (datos, fecha) => Math.round((aFecha(lunes(fecha)) - aFecha(lunes(datos.inicio))) / (7 * 864e5)) + 1;
const enAdaptacion = semana => semana <= D.plan.adaptacion.semanas;
const primeroBici = fecha => (semanaISO(fecha) % 2 === 1 ? D.plan.rotacionBici.impar : D.plan.rotacionBici.par);

function sustituir(id, persona, semana) {
  const s = enAdaptacion(semana) && D.plan.adaptacion.sustituciones[persona];
  return (s && s[id]) || id;
}

function prescribir(id, persona, semana, rondas) {
  const p = { ...D.ej[id].prescripcion[persona] };
  if (enAdaptacion(semana) && p.unidad !== 'min') {
    p.series = Math.min(p.series, D.plan.adaptacion.series);
    if (p.liga) p.liga = Math.min(p.liga, D.plan.adaptacion.ligaMax);
  }
  if (rondas) p.series = rondas;
  return p;
}

function textoPresc(p, ej) {
  if (ej.tipo === 'bici' || p.unidad === 'min') return `${p.min} min`;
  const rango = p.min === p.max ? p.min : `${p.min}-${p.max}`;
  let t = `${p.series} × ${rango}${p.unidad === 'seg' ? ' s' : ''}`;
  if (p.porLado) t += ' por lado';
  if (p.liga) t += ` · liga ${p.liga} ${ej.ligaTipo || ''}`;
  return t.trim();
}

const nombreDia = (d, persona) => (d.nombrePersona && d.nombrePersona[persona]) || d.nombre;

// Devuelve los bloques de la sesión de un día para una persona.
function armarSesion(persona, n, fecha, semana) {
  const dia = D.plan.dias.find(d => d.dia === n);
  const rondas = dia.a && dia.a.circuito ? dia.a.circuito.rondas : 0;
  const items = (ids, r) => ids.map(id => sustituir(id, persona, semana))
    .filter(id => D.ej[id] && D.ej[id].prescripcion[persona]).map(id => ({ id, rondas: r || 0 }));
  if (dia.tipo === 'bici') {
    const [f0, f1, f2, f3] = dia.franjas;
    const yoPrimero = primeroBici(fecha) === persona;
    const libre = { titulo: 'Tu tiempo libre', nota: `${PERSONAS[OTRO(persona)].nombre} usa la bici.`, items: items(dia.libre[persona]) };
    const bici = { titulo: 'Bici', nota: 'Ajusta el sillín antes de empezar.', items: items(['bici']) };
    return [
      { titulo: 'Calentamiento', min: f0.min, items: items([...f0.juntos, ...(f0[persona] || [])]) },
      { ...(yoPrimero ? bici : libre), min: f1.min },
      { ...(yoPrimero ? libre : bici), min: f2.min },
      { titulo: 'Vuelta a la calma', min: f3.min, items: items(f3.juntos) }
    ];
  }
  const b = dia.b;
  return [
    { titulo: 'Calentamiento', min: '0-5', items: items([...dia.calentamiento.juntos, ...(dia.calentamiento[persona] || [])]) },
    { titulo: 'Piernas y glúteo', min: '5-15', nota: rondas ? `Circuito: ${rondas} rondas` : '', items: items(dia.a.juntos, rondas) },
    { titulo: persona === 'natalia' ? 'Pie y estabilidad' : 'Tren superior', min: '15-25', opcional: !!b.opcional, items: items(b[persona]) },
    { titulo: 'Core y calma', min: '25-30', items: items(dia.c.juntos) }
  ];
}

// ---------- Progreso, rachas e insignias ----------
const terminadas = datos => Object.entries(datos.sesiones).filter(([, s]) => s.terminada).map(([f]) => f).sort();
function sesionesPorSemana(datos) {
  const m = {};
  terminadas(datos).forEach(f => { const l = lunes(f); m[l] = (m[l] || 0) + 1; });
  return m;
}
function racha(datos, fecha) {
  const m = sesionesPorSemana(datos), min = D.plan.minimoSemana;
  let l = lunes(fecha), n = 0;
  if ((m[l] || 0) >= min) n++;
  l = sumaDias(l, -7);
  while ((m[l] || 0) >= min) { n++; l = sumaDias(l, -7); }
  return n;
}
function mejorRacha(datos) {
  const m = sesionesPorSemana(datos), min = D.plan.minimoSemana;
  const sem = Object.keys(m).filter(l => m[l] >= min).sort();
  let mejor = 0, act = 0, prev = null;
  sem.forEach(l => { act = prev && sumaDias(prev, 7) === l ? act + 1 : 1; mejor = Math.max(mejor, act); prev = l; });
  return mejor;
}
const hechosTodos = datos => Object.entries(datos.sesiones).flatMap(([f, s]) => Object.entries(s.hechos || {}).map(([id, r]) => ({ f, id, r })));
const diasCon = (datos, test) => new Set(hechosTodos(datos).filter(h => test(h.id)).map(h => h.f)).size;
const maxSerie = (datos, id) => Math.max(0, ...hechosTodos(datos).filter(h => h.id === id).flatMap(h => (h.r.series || []).map(s => +s.v || 0)));
const maxLiga = datos => Math.max(0, ...hechosTodos(datos).filter(h => D.ej[h.id] && D.ej[h.id].ligaTipo).flatMap(h => (h.r.series || []).map(s => +s.liga || 0)));

const INSIGNIAS = [
  { g: 'Constancia', n: 'Primer paso', d: 'Termina tu primera sesión', meta: 1, ic: '1', val: d => terminadas(d).length },
  { g: 'Constancia', n: 'Semana completa', d: '3 sesiones en una semana', meta: 1, ic: '3', val: d => mejorRacha(d) },
  { g: 'Constancia', n: 'Racha de 2', d: '2 semanas seguidas con 3 sesiones', meta: 2, ic: '2', val: d => mejorRacha(d) },
  { g: 'Constancia', n: 'Racha de 4', d: '4 semanas seguidas con 3 sesiones', meta: 4, ic: '4', val: d => mejorRacha(d) },
  { g: 'Constancia', n: 'Racha de 8', d: '8 semanas seguidas con 3 sesiones', meta: 8, ic: '8', val: d => mejorRacha(d) },
  { g: 'Fuerza', n: 'Plancha de 60', d: 'Aguanta 60 segundos en plancha', meta: 60, ic: '60', val: d => maxSerie(d, 'c-plancha') },
  { g: 'Fuerza', n: 'Liga media', d: 'Entrena con liga nivel 2', meta: 2, ic: 'L2', val: d => maxLiga(d) },
  { g: 'Fuerza', n: 'Liga alta', d: 'Entrena con liga nivel 3', meta: 3, ic: 'L3', val: d => maxLiga(d) },
  { g: 'Pie y arco', who: 'natalia', n: 'Primer pie corto', d: 'Haz el ejercicio de pie corto', meta: 1, ic: '1', val: d => diasCon(d, id => id === 'bn-pie-corto') },
  { g: 'Pie y arco', who: 'natalia', n: 'Pie firme', d: '10 sesiones con pie corto', meta: 10, ic: '10', val: d => diasCon(d, id => id === 'bn-pie-corto') },
  { g: 'Pie y arco', who: 'natalia', n: 'Arco de acero', d: '30 sesiones de rutina de pie', meta: 30, ic: '30', val: d => diasCon(d, id => id.startsWith('bn-')) },
  { g: 'Codo y antebrazo', who: 'adrian', n: 'Codo cuidado', d: '10 sesiones con trabajo de antebrazo', meta: 10, ic: '10', val: d => diasCon(d, id => id === 'cal-muneca-excentrica') },
  { g: 'Codo y antebrazo', who: 'adrian', n: 'Codo de acero', d: '30 sesiones con trabajo de antebrazo', meta: 30, ic: '30', val: d => diasCon(d, id => id === 'cal-muneca-excentrica') }
];
const insigniasDe = (persona, datos) => INSIGNIAS.filter(i => !i.who || i.who === persona).map(i => ({ ...i, v: i.val(datos), ganada: i.val(datos) >= i.meta }));

// ---------- Sesión de hoy ----------
function sesionHoy(crear) {
  const f = hoy();
  if (!E.datos.sesiones[f] && crear) E.datos.sesiones[f] = { dia: E.dia, hechos: {}, terminada: false };
  return E.datos.sesiones[f];
}
function diaSugerido() {
  const s = sesionHoy(false);
  if (s) return s.dia;
  const ult = terminadas(E.datos).pop();
  return ult ? (E.datos.sesiones[ult].dia % D.plan.dias.length) + 1 : 1;
}
function ultimoRegistro(id, antesDe) {
  const fechas = Object.keys(E.datos.sesiones).filter(f => f < antesDe && E.datos.sesiones[f].hechos && E.datos.sesiones[f].hechos[id]).sort();
  const f = fechas.pop();
  return f ? E.datos.sesiones[f].hechos[id] : null;
}

// ---------- Interfaz común ----------
function toast(msg, malo) {
  const t = $('#toast');
  t.textContent = msg; t.className = malo ? 'malo' : ''; t.hidden = false;
  clearTimeout(E.toastT); E.toastT = setTimeout(() => { t.hidden = true; }, 3800);
}
function topBar(titulo, sub) {
  const P = PERSONAS[E.persona];
  return `<header class="top"><div class="quien"><span class="eyebrow">${esc(sub || '')}</span><h1>${esc(titulo)}</h1></div>
    <a class="avatar no-imprimir" href="#/perfil" aria-label="Cambiar de perfil (${esc(P.nombre)})">${P.inicial}</a></header>`;
}
const volver = (href, txt) => `<a class="volver no-imprimir" href="${href}">‹ ${esc(txt)}</a>`;

// ---------- Vistas ----------
function vistaPerfil() {
  return `<header class="top"><div class="quien"><span class="eyebrow">Entrenamiento</span><h1>Bravo</h1></div></header>
    <p class="tenue">¿Quién entrena hoy?</p>
    <div class="perfiles">${Object.entries(PERSONAS).map(([k, p]) => `
      <button class="perfil-card" style="--c:${p.color}" data-perfil="${k}"><span class="display">${esc(p.completo)}</span><span class="tenue">${k === 'natalia' ? 'Pies firmes, piernas fuertes' : 'Fuerza y menos barriga'}</span></button>`).join('')}
    </div>`;
}

function anillo(bloques, hechos) {
  const R = 54, C = 2 * Math.PI * R, gap = 6, n = bloques.length;
  const seg = C / n - gap;
  let total = 0, listos = 0, arcos = '';
  bloques.forEach((b, i) => {
    const req = b.opcional ? [] : b.items;
    const ok = req.filter(it => hechos[it.id]).length;
    total += req.length; listos += ok;
    const frac = req.length ? ok / req.length : 0;
    const rot = `rotate(${(i * 360) / n - 90} 60 60)`;
    arcos += `<circle class="fondo" cx="60" cy="60" r="${R}" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="${seg} ${C}" transform="${rot}"/>`;
    if (frac > 0) arcos += `<circle class="relleno" cx="60" cy="60" r="${R}" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="${seg * frac} ${C}" transform="${rot}"/>`;
  });
  return { total, listos, svg: `<div class="anillo"><svg viewBox="0 0 120 120" aria-hidden="true">${arcos}</svg><div class="centro"><b>${listos}/${total}</b><small>hechos</small></div></div>` };
}

function vistaHoy() {
  const P = PERSONAS[E.persona], f = hoy(), semana = semanaPlan(E.datos, f);
  const s = sesionHoy(false);
  if (E.dia == null) E.dia = diaSugerido();
  const bloques = armarSesion(E.persona, E.dia, f, semana);
  const hechos = s ? s.hechos : {};
  const bloqueado = s && Object.keys(hechos).length > 0;
  const a = anillo(bloques, hechos);
  const dias = D.plan.dias.map(d => `<button class="dia${d.dia === E.dia ? ' sel' : ''}" data-dia="${d.dia}" ${bloqueado && d.dia !== E.dia ? 'disabled style="opacity:.4"' : ''}><b>${d.dia}</b><small>Día</small></button>`).join('');
  const diaPlan = D.plan.dias.find(d => d.dia === E.dia);
  const sem = sesionesPorSemana(E.datos)[lunes(f)] || 0;
  const lista = bloques.map(b => `
    <div class="bloque"><h2>${esc(b.titulo)}</h2><span class="eyebrow">${esc(b.min)} min${b.opcional ? ' · opcional' : ''}</span></div>
    ${b.nota ? `<p class="nota-bloque">${esc(b.nota)}</p>` : ''}
    ${b.items.map(it => {
      const ej = D.ej[it.id], p = prescribir(it.id, E.persona, semana, it.rondas), h = hechos[it.id];
      return `<a class="ej${h ? ' hecho' : ''}" href="#/ej/${it.id}">
        <span class="miniatura" style="background-image:url('${ytMini(ej.video.id)}')"></span>
        <span><span class="nombre">${esc(ej.nombre)}</span><div class="meta">${esc(textoPresc(p, ej))}${h && h.dolor != null ? ` · dolor ${h.dolor}` : ''}</div></span>
        <span class="estado" aria-label="${h ? 'Hecho' : 'Pendiente'}"></span></a>`;
    }).join('')}`).join('');
  const puedeTerminar = a.listos > 0 && !(s && s.terminada);
  return `${topBar('Hola, ' + P.nombre, fechaLarga(f))}
    <section class="hero">${a.svg}<div class="datos">
      <span class="chip on">Semana ${semana} · ${enAdaptacion(semana) ? 'Adaptación' : 'Progresión'}</span>
      <span class="chip lima">Racha ${racha(E.datos, f)} sem</span>
      <span class="chip">Esta semana ${sem}/${D.plan.minimoSemana}</span></div></section>
    <div class="dias" role="group" aria-label="Día del plan">${dias}</div>
    <h2 class="acento" style="font-size:30px">${esc(nombreDia(diaPlan, E.persona))}</h2>
    ${lista}
    <div class="barra-fin">
      <button class="btn" id="terminar" ${puedeTerminar ? '' : 'disabled'}>${s && s.terminada ? 'Sesión terminada' : 'Terminar sesión'}</button>
      ${!a.listos ? '<p class="tenue" style="text-align:center;margin:0">Toca un ejercicio para verlo y registrarlo.</p>' : ''}
    </div>`;
}

function vistaFicha(id) {
  const ej = D.ej[id];
  if (!ej) return `${volver('#/hoy', 'Hoy')}<p class="vacio">Ese ejercicio no existe.</p>`;
  const f = hoy(), semana = semanaPlan(E.datos, f);
  if (E.dia == null) E.dia = diaSugerido();
  const ctx = armarSesion(E.persona, E.dia, f, semana).flatMap(b => b.items).find(it => it.id === id);
  const p = prescribir(id, E.persona, semana, ctx ? ctx.rondas : 0);
  const s = sesionHoy(false), prev = s && s.hechos[id];
  const ult = ultimoRegistro(id, f);
  const base = prev || ult;
  const capLiga = enAdaptacion(semana) ? D.plan.adaptacion.ligaMax : 3;
  const notaPers = ej.notas[E.persona];
  const mom = ej.video.momentos || [];
  const alt = (ej.video.alt || []).map(a => `<a href="${ytUrl(a.id)}" target="_blank" rel="noopener">${esc(a.canal)}</a>`).join(' · ');

  let registro;
  if (ej.tipo === 'bici') {
    const min = prev ? prev.min : (ult ? ult.min : p.min), res = prev ? prev.res : (ult ? ult.res : 3);
    registro = `<div class="serie"><span></span><div class="campos">${stepper('min', min, 'minutos')}</div></div>
      <div class="serie"><span></span><div class="campos">${stepper('res', res, 'resistencia (1-10)')}</div></div>`;
  } else if (p.unidad === 'min') {
    registro = `<p class="tenue" style="margin:0">Duración sugerida: ${p.min} min. Márcalo como hecho al terminar.</p>`;
  } else {
    registro = Array.from({ length: p.series }, (_, i) => {
      const bs = base && base.series && base.series[i];
      const v = bs ? bs.v : p.min;
      const lg = ej.ligaTipo ? Math.min(bs && bs.liga ? bs.liga : (p.liga || 1), capLiga) : null;
      return `<div class="serie"><span class="n">${i + 1}</span><div class="campos">
        ${stepper('v', v, (p.unidad === 'seg' ? 'seg' : 'reps') + (p.porLado ? ' por lado' : ''), i)}
        ${lg ? `<div class="ligas" data-serie="${i}" role="group" aria-label="Liga">${[1, 2, 3].map(n => `<button type="button" class="liga${n === lg ? ' sel' : ''}" data-liga="${n}" ${n > capLiga ? 'disabled style="opacity:.3"' : ''}>${n}</button>`).join('')}</div>` : ''}
      </div></div>`;
    }).join('');
  }

  // Sugerencia de progresión: tope de repeticiones en todas las series con dolor <= 2
  let sugerencia = '';
  if (ult && !enAdaptacion(semana) && ej.tipo === 'fuerza' && p.unidad !== 'min' && ult.series
      && ult.series.every(x => +x.v >= p.max) && (ult.dolor == null || ult.dolor <= 2)) {
    const lg = Math.max(0, ...ult.series.map(x => +x.liga || 0));
    sugerencia = `<div class="tarjeta sugerencia"><h3>Hora de subir</h3><p style="margin:0">La última vez llegaste al tope con poco dolor. ${ej.ligaTipo && lg && lg < 3 ? `Prueba la liga ${lg + 1}.` : 'Prueba una variante más difícil o más repeticiones.'}</p></div>`;
  }

  return `${volver('#/hoy', 'Hoy')}
    <h1 style="margin:6px 0 4px">${esc(ej.nombre)}</h1>
    <p class="tenue" style="margin:0 0 6px">${esc(textoPresc(p, ej))}</p>
    <a class="video" href="${ytUrl(ej.video.id, mom[0] && aSeg(mom[0].desde))}" target="_blank" rel="noopener" style="background-image:url('${ytMini(ej.video.id)}')" aria-label="Ver video en YouTube"><span class="play"></span><span class="canal">${esc(ej.video.canal)}${ej.video.dur ? ' · ' + mmss(ej.video.dur) : ''}${mom[0] ? ' · empieza en ' + esc(mom[0].desde) : ''}</span></a>
    ${mom.length ? `<div class="tarjeta momentos"><h3>Ve directo a</h3>${mom.map(m => `<a class="momento" href="${ytUrl(ej.video.id, aSeg(m.desde))}" target="_blank" rel="noopener"><b>${esc(m.desde)}${m.hasta ? ' – ' + esc(m.hasta) : ''}</b><span>${esc(m.texto)}</span></a>`).join('')}</div>` : ''}
    ${alt ? `<p class="alt-video">Otras opciones: ${alt}</p>` : ''}
    ${sugerencia}
    ${notaPers ? `<div class="tarjeta aviso"><h3>Para ti</h3><p style="margin:0">${esc(notaPers)}</p></div>` : ''}
    <div class="tarjeta"><h3>Cómo hacerlo</h3><ol>${ej.pasos.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>
    <div class="tarjeta"><h3>Errores comunes</h3><ul>${ej.errores.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <form id="registro" data-id="${id}">
      <div class="tarjeta"><h3>Tu registro</h3>${registro}
        <div class="dolor"><div class="lectura"><span class="eyebrow">Dolor (0 = nada, 10 = máximo)</span><b id="dolor-v">${prev && prev.dolor != null ? prev.dolor : 0}</b></div>
        <input type="range" id="dolor" min="0" max="10" step="1" value="${prev && prev.dolor != null ? prev.dolor : 0}" aria-label="Dolor de 0 a 10"></div></div>
      <button class="btn" type="submit">${prev ? 'Actualizar registro' : 'Guardar registro'}</button>
      ${prev ? '<button class="btn sec" type="button" id="quitar" style="margin-top:10px">Quitar registro</button>' : ''}
    </form>`;
}

function stepper(nombre, valor, unidad, i) {
  const idx = i == null ? '' : ` data-i="${i}"`;
  return `<div class="num"><button type="button" data-paso="-1" aria-label="Menos">−</button>
    <input type="number" inputmode="numeric" min="0" max="999" value="${valor}" data-campo="${nombre}"${idx} aria-label="${esc(unidad)}">
    <button type="button" data-paso="1" aria-label="Más">+</button></div><span class="unidad">${esc(unidad)}</span>`;
}

function vistaPlan() {
  const ver = E.verPlan, personas = ver === 'ambos' ? ['natalia', 'adrian'] : [ver];
  const l0 = lunes(E.datos.inicio);
  const semanas = [1, 2, 3, 4].map(k => {
    const lun = sumaDias(l0, 7 * (k - 1));
    const dias = D.plan.dias.map(d => `
      <div class="dia-plan"><h3>Día ${d.dia} · ${esc(ver === 'ambos' ? d.nombre : nombreDia(d, ver))}${D.plan.obligatorios.includes(d.dia) ? '<small>Obligatorio</small>' : ''}</h3>
        ${personas.map(pe => `<div class="persona ${pe === 'natalia' ? 'n' : 'a'}"><b>${PERSONAS[pe].completo}</b><ul>
          ${armarSesion(pe, d.dia, lun, k).map(b => b.items.map((it, j) => {
            const ej = D.ej[it.id], p = prescribir(it.id, pe, k, it.rondas);
            return `<li>${j === 0 ? `<i>${esc(b.titulo)} (${esc(b.min)}): </i>` : ''}${esc(ej.nombre)} — ${esc(textoPresc(p, ej))} <a href="${ytUrl(ej.video.id)}">video</a></li>`;
          }).join('')).join('')}</ul></div>`).join('')}
      </div>`).join('');
    return `<section class="semana"><h2>Semana ${k}<span class="eyebrow">${enAdaptacion(k) ? 'Adaptación' : 'Progresión'}</span></h2>
      <span class="eyebrow">Desde ${fechaCorta(lun)} · primero en la bici (día 3): ${PERSONAS[primeroBici(lun)].completo}</span>${dias}</section>`;
  }).join('');
  const sel = [['ambos', 'Ambos'], ['natalia', 'Naty'], ['adrian', 'Adrián']]
    .map(([k, t]) => `<button class="chip${k === ver ? ' on' : ''}" data-ver="${k}">${t}</button>`).join('');
  return `${topBar('Plan del mes', 'Entrenamiento Bravo')}
    <div class="selector no-imprimir">${sel}</div>
    <button class="btn no-imprimir" id="imprimir" style="margin-bottom:18px">Imprimir o guardar PDF</button>
    <div class="solo-imprimir"><h1>Plan de entrenamiento familiar — 4 semanas</h1>
      <p>Sesiones de 30 min, 5 días (mínimo 3 por semana), en casa con ligas (corta y larga), pesas de 4 lb y mat. Semanas 1-2: adaptación (2 series, liga 1). Desde la semana 3: 3 series; se sube de liga o variante al llegar al tope de repeticiones con técnica correcta y dolor ≤ 2. Si el dolor llega a 3, se regresa de nivel o se cambia el ejercicio.</p></div>
    ${semanas}`;
}

function vistaInsignias() {
  const lista = insigniasDe(E.persona, E.datos);
  const grupos = [...new Set(lista.map(i => i.g))];
  const ganadas = lista.filter(i => i.ganada).length;
  return `${topBar('Insignias', `${ganadas} de ${lista.length}`)}
    ${grupos.map(g => `<div class="grupo-ins"><h2>${esc(g)}</h2></div><div class="grid-ins">
      ${lista.filter(i => i.g === g).map(i => `<div class="ins${i.ganada ? ' ganada' : ''}"><div class="hex">${esc(i.ic)}</div><h3>${esc(i.n)}</h3>
        <p>${esc(i.d)}${i.ganada ? '' : ` · ${Math.min(i.v, i.meta)}/${i.meta}`}</p></div>`).join('')}</div>`).join('')}`;
}

function resumenPersona(persona, datos) {
  const f = hoy(), lun = lunes(f), ter = new Set(terminadas(datos));
  const puntos = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((t, i) => {
    const d = sumaDias(lun, i);
    return `<div class="punto${d === f ? ' hoy' : ''}${ter.has(d) ? ' hizo' : ''}"><i></i>${t}</div>`;
  }).join('');
  return { racha: racha(datos, f), semana: sesionesPorSemana(datos)[lun] || 0, puntos, total: ter.size };
}

function vistaProgreso() {
  const P = PERSONAS[E.persona], r = resumenPersona(E.persona, E.datos);
  const hist = terminadas(E.datos).reverse().slice(0, 10).map(f => {
    const s = E.datos.sesiones[f], hs = Object.values(s.hechos || {});
    const dolores = hs.map(h => h.dolor).filter(x => x != null);
    const dia = D.plan.dias.find(d => d.dia === s.dia);
    return `<div class="hist-fila"><div><b>${esc(fechaCorta(f))}</b><div class="tenue">Día ${s.dia}${dia ? ' · ' + esc(nombreDia(dia, E.persona)) : ''}</div></div>
      <div style="text-align:right;white-space:nowrap">${hs.length} ejercicios<div class="tenue">dolor máx. ${dolores.length ? Math.max(...dolores) : '—'}</div></div></div>`;
  }).join('');
  const o = OTRO(E.persona), PO = PERSONAS[o], dO = Store.cargarOtro(o), rO = resumenPersona(o, dO);
  return `${topBar('Progreso', P.nombre)}
    <section class="racha"><b>${r.racha}</b><span>${r.racha === 1 ? 'semana de racha' : 'semanas de racha'}</span>
      <div class="semana-puntos">${r.puntos}</div>
      <span class="tenue" style="font:600 15px var(--cuerpo);text-transform:none;letter-spacing:0">${r.semana} de ${D.plan.minimoSemana} sesiones esta semana</span></section>
    <h2 style="margin-bottom:10px">Últimas sesiones</h2>
    ${hist ? `<div class="hist">${hist}</div>` : '<p class="vacio">Todavía no hay sesiones terminadas. Termina una desde Hoy.</p>'}
    <section class="otro" style="--otro-c:${PO.color}"><h3>${esc(PO.completo)}</h3>
      ${rO.total ? `<div class="semana-puntos">${rO.puntos}</div><p style="margin:6px 0 0">Racha de <b>${rO.racha}</b> ${rO.racha === 1 ? 'semana' : 'semanas'} · ${rO.semana} de ${D.plan.minimoSemana} sesiones esta semana</p>`
        : `<p class="tenue" style="margin:0">Aún no hay datos de ${esc(PO.nombre)} en este celular. Aparecerán aquí cuando la app esté sincronizada.</p>`}
    </section>
    ${tarjetaSync()}
    <p class="tenue" style="text-align:center;font-size:13px;margin-top:22px">Versión ${VERSION}</p>`;
}

function tarjetaSync() {
  const t = Sync.token(), st = Sync.estado, u = Sync.ultima();
  if (!t) return `<section class="tarjeta no-imprimir" style="margin-top:22px"><h3>Sincronización</h3>
    <p class="tenue" style="margin-top:0">Conecta este celular para compartir el progreso. Pega aquí el token de GitHub (solo se guarda en este celular).</p>
    <input class="campo" id="tok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…" aria-label="Token de GitHub">
    <button class="btn" id="conectar" style="margin-top:12px">Conectar</button></section>`;
  const cuando = u ? new Date(u).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'todavía no';
  return `<section class="tarjeta no-imprimir" style="margin-top:22px"><h3>Sincronización</h3>
    <p style="margin:0 0 4px">${st.ok === false ? `<span style="color:var(--alerta)">${esc(st.error)}</span>` : 'Conectado.'}</p>
    <p class="tenue" style="margin:0 0 12px">Última vez: ${esc(cuando)}</p>
    <button class="btn" id="sync-ahora">Sincronizar ahora</button>
    <button class="btn sec" id="quitar-token" style="margin-top:10px">Quitar token de este celular</button></section>`;
}

// ---------- Enrutador ----------
function render() {
  const app = $('#app'), nav = $('#nav');
  const ruta = (location.hash || '#/hoy').slice(2).split('/');
  if (!E.persona || ruta[0] === 'perfil') {
    nav.hidden = true; document.documentElement.removeAttribute('data-persona');
    app.innerHTML = vistaPerfil(); window.scrollTo(0, 0); return;
  }
  document.documentElement.dataset.persona = E.persona;
  nav.hidden = false;
  const vistas = { hoy: vistaHoy, plan: vistaPlan, insignias: vistaInsignias, progreso: vistaProgreso, ej: () => vistaFicha(ruta[1]) };
  const activa = vistas[ruta[0]] ? ruta[0] : 'hoy';
  app.innerHTML = vistas[activa]();
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('activo', a.dataset.ruta === (activa === 'ej' ? 'hoy' : activa)));
  if (!(window.__noScroll)) window.scrollTo(0, 0);
}

function elegirPerfil(p) {
  E.persona = p; Store.setPerfil(p); E.datos = Store.cargar(p); E.dia = null;
  if (!E.datos.inicio) E.datos.inicio = hoy();
  Store.guardar(p, E.datos);
  location.hash = '#/hoy'; render();
}

function guardarRegistro(form) {
  const id = form.dataset.id, ej = D.ej[id];
  const reg = { dolor: +$('#dolor').value };
  if (ej.tipo === 'bici') {
    reg.min = +form.querySelector('[data-campo=min]').value;
    reg.res = +form.querySelector('[data-campo=res]').value;
  } else {
    reg.series = [...form.querySelectorAll('[data-campo=v]')].map(inp => {
      const lg = form.querySelector(`.ligas[data-serie="${inp.dataset.i}"] .liga.sel`);
      return { v: +inp.value || 0, liga: lg ? +lg.dataset.liga : null };
    });
  }
  const s = sesionHoy(true);
  if (!Object.keys(s.hechos).length) s.dia = E.dia;
  s.hechos[id] = reg; tocar(s);
  Store.guardar(E.persona, E.datos);
  toast(reg.dolor >= 3 ? `Registrado. Dolor ${reg.dolor}: baja de nivel o cambia este ejercicio.` : 'Registro guardado.', reg.dolor >= 3);
  location.hash = '#/hoy';
}

function terminarSesion() {
  const antes = new Set(insigniasDe(E.persona, E.datos).filter(i => i.ganada).map(i => i.n));
  const s = sesionHoy(false);
  if (!s || !Object.keys(s.hechos).length) return;
  s.terminada = true; tocar(s);
  Store.guardar(E.persona, E.datos);
  const nuevas = insigniasDe(E.persona, E.datos).filter(i => i.ganada && !antes.has(i.n));
  const r = racha(E.datos, hoy());
  toast(nuevas.length ? `¡Insignia nueva: ${nuevas.map(i => i.n).join(', ')}!` : `Sesión terminada. Racha: ${r} ${r === 1 ? 'semana' : 'semanas'}.`);
  render();
}

// ---------- Eventos ----------
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.perfil) return elegirPerfil(t.dataset.perfil);
  if (t.dataset.dia) { E.dia = +t.dataset.dia; window.__noScroll = true; render(); window.__noScroll = false; return; }
  if (t.dataset.ver) { E.verPlan = t.dataset.ver; window.__noScroll = true; render(); window.__noScroll = false; return; }
  if (t.id === 'terminar') return terminarSesion();
  if (t.id === 'imprimir') return window.print();
  if (t.id === 'conectar') return conectar();
  if (t.id === 'sync-ahora') { toast('Sincronizando…'); return Sync.todo(E.persona).then(() => toast(Sync.estado.ok ? 'Sincronizado.' : Sync.estado.error, !Sync.estado.ok)); }
  if (t.id === 'quitar-token') { Sync.setToken(null); Sync.estado.ok = null; toast('Token quitado de este celular.'); return refrescar(); }
  if (t.id === 'quitar') {
    const s = sesionHoy(false), id = $('#registro').dataset.id;
    if (s) { delete s.hechos[id]; tocar(s); Store.guardar(E.persona, E.datos); }
    toast('Registro quitado.'); location.hash = '#/hoy'; return;
  }
  if (t.dataset.paso) {
    const inp = t.parentElement.querySelector('input');
    inp.value = Math.max(0, (+inp.value || 0) + +t.dataset.paso); return;
  }
  if (t.dataset.liga) {
    t.parentElement.querySelectorAll('.liga').forEach(b => b.classList.toggle('sel', b === t)); return;
  }
});
document.addEventListener('input', e => { if (e.target.id === 'dolor') $('#dolor-v').textContent = e.target.value; });
document.addEventListener('submit', e => { if (e.target.id === 'registro') { e.preventDefault(); guardarRegistro(e.target); } });
window.addEventListener('hashchange', render);
window.addEventListener('online', () => Sync.auto());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.auto(); });

async function conectar() {
  const v = ($('#tok').value || '').trim();
  if (!v) return toast('Pega primero el token.', true);
  Sync.setToken(v);
  toast('Conectando…');
  try {
    const r = await Sync.api('');
    if (!r.ok) throw new Error(Sync.errorTexto(r));
  } catch (e) {
    Sync.setToken(null);
    return toast(e instanceof TypeError ? 'Sin conexión.' : e.message, true);
  }
  await Sync.todo(E.persona);
  toast(Sync.estado.ok ? 'Conectado y sincronizado.' : Sync.estado.error, !Sync.estado.ok);
}

// ---------- Inicio ----------
async function iniciar() {
  try {
    const [ej, plan] = await Promise.all(['data/ejercicios.json', 'data/plan.json'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
    D.ej = Object.fromEntries(ej.ejercicios.map(x => [x.id, x]));
    D.plan = plan;
  } catch (err) {
    $('#app').innerHTML = '<p class="vacio">No se pudo cargar el plan. Revisa la conexión y vuelve a abrir la app.</p>';
    return;
  }
  const p = Store.perfil();
  if (PERSONAS[p]) { E.persona = p; E.datos = Store.cargar(p); }
  render();
  if (E.persona) Sync.todo(E.persona);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
iniciar();
