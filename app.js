// ── Imports Firebase ─────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "AIzaSyCgiTXQeics9Opr4HvLcuZ0b3lmBDy3LL0",
  authDomain:        "paqcount.firebaseapp.com",
  projectId:         "paqcount",
  storageBucket:     "paqcount.firebasestorage.app",
  messagingSenderId: "431677742524",
  appId:             "1:431677742524:web:885cc9a5814def648e9fb9"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
setPersistence(auth, browserLocalPersistence);

// ── Estado global ────────────────────────────────────────────
let currentUser  = null;
let ubicacion    = 'ZonaA';
let modo         = 'Entrada'; // 'Entrada' | 'Salida'
let scanning     = false;
let appReady     = false;
let videoStream  = null;
let detectLoop   = false;
let pendingScans = JSON.parse(localStorage.getItem('pending_scans') || '[]');

// Sonido duplicado
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function sonarDuplicado() {
  try {
    [220, 180, 150].forEach((freq, i) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.15 + 0.14);
      osc.start(audioCtx.currentTime + i * 0.15);
      osc.stop(audioCtx.currentTime + i * 0.15 + 0.15);
    });
  } catch (e) {}
}

const ZONAS = ['ZonaA','ZonaB','ZonaC','ZonaD','ZonaE'];

// ── Validador ────────────────────────────────────────────────
function validarCodigo(codigo) {
  const c = codigo.trim().toUpperCase();
  if (!c || c.length < 8) return { ok: false, msg: '¡Código inválido! Demasiado corto.' };
  if (/^PAQ-[A-Z0-9]{6,}$/.test(c))  return { ok: true, formato: 'PaqCount' };
  if (/^AND\w{8,12}$/.test(c))        return { ok: true, formato: 'Andreani' };
  if (/^MELI\d{12,16}$/.test(c))      return { ok: true, formato: 'MercadoLibre' };
  if (/^[01]\d{12}$/.test(c))         return { ok: true, formato: 'OCA' };
  if (/^\d{13}$/.test(c))             return { ok: true, formato: 'Correo/EAN13' };
  if (/^\d{12}$/.test(c))             return { ok: true, formato: 'EAN12' };
  if (c.length >= 10)                 return { ok: true, formato: 'Genérico' };
  return { ok: false, msg: '¡Código inválido! Formato no reconocido.' };
}

// ── Auth ─────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    showScreen('scanner');
    await actualizarResumen();
    if (!appReady) { appReady = true; iniciarCamara(); }
    sincronizarPendientes();
  } else {
    appReady = false; detectLoop = false;
    showScreen('login'); detenerCamara();
  }
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-google-login');
  btn.textContent = 'Conectando...'; btn.disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  } catch (e) {
    btn.textContent = 'Continuar con Google'; btn.disabled = false;
    if (e.code !== 'auth/popup-closed-by-user') alert('Error: ' + e.message);
  }
});

// ── Navegación ───────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

document.getElementById('btn-back').addEventListener('click', () => {
  showScreen('scanner');
  actualizarResumen();
});
document.getElementById('btn-historial').addEventListener('click', () => {
  showScreen('historial');
  cargarHistorial('todos');
});
document.getElementById('btn-menu').addEventListener('click', () => {
  if (confirm('¿Cerrar sesión?')) auth.signOut();
});

// ── Toggle Entrada / Salida ───────────────────────────────────
document.getElementById('btn-entrada').addEventListener('click', () => {
  modo = 'Entrada';
  document.getElementById('btn-entrada').className = 'modo-btn modo-active';
  document.getElementById('btn-salida').className = 'modo-btn';
  localStorage.setItem('modo', 'Entrada');
});
document.getElementById('btn-salida').addEventListener('click', () => {
  modo = 'Salida';
  document.getElementById('btn-entrada').className = 'modo-btn';
  document.getElementById('btn-salida').className = 'modo-btn modo-salida-active';
  localStorage.setItem('modo', 'Salida');
});
// Restaurar modo
const lastModo = localStorage.getItem('modo');
if (lastModo === 'Salida') {
  modo = 'Salida';
  document.getElementById('btn-entrada').className = 'modo-btn';
  document.getElementById('btn-salida').className = 'modo-btn modo-salida-active';
}

// ── Selector de ubicación ────────────────────────────────────
const zonaGrid = document.getElementById('zona-grid');
ZONAS.forEach(z => {
  const btn = document.createElement('button');
  btn.className = 'zona-btn' + (z === ubicacion ? ' selected' : '');
  btn.textContent = z;
  btn.addEventListener('click', () => {
    ubicacion = z;
    document.getElementById('btn-ubicacion').textContent = '📍 ' + z;
    document.querySelectorAll('.zona-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('modal-ubicacion').classList.add('hidden');
    localStorage.setItem('last_ubicacion', z);
  });
  zonaGrid.appendChild(btn);
});
document.getElementById('btn-ubicacion').addEventListener('click', () => {
  document.getElementById('modal-ubicacion').classList.remove('hidden');
});
document.getElementById('btn-cerrar-modal').addEventListener('click', () => {
  document.getElementById('modal-ubicacion').classList.add('hidden');
});
const lastUbic = localStorage.getItem('last_ubicacion');
if (lastUbic) {
  ubicacion = lastUbic;
  document.getElementById('btn-ubicacion').textContent = '📍 ' + lastUbic;
}

// ── Resumen Entradas vs Salidas ───────────────────────────────
async function actualizarResumen() {
  try {
    const snap = await getDocs(query(collection(db, 'scans'), where('estado', '==', 'Registrado')));
    const entradas = new Set();
    const salidas  = new Set();
    snap.forEach(doc => {
      const d = doc.data();
      if (d.modo === 'Entrada') entradas.add(d.codigo);
      else if (d.modo === 'Salida') salidas.add(d.codigo);
    });

    // Faltantes: entraron pero no salieron
    const faltantes = [...entradas].filter(c => !salidas.has(c));
    // Sobrantes: salieron pero no entraron
    const sobrantes = [...salidas].filter(c => !entradas.has(c));

    document.getElementById('res-entradas').textContent  = entradas.size;
    document.getElementById('res-salidas').textContent   = salidas.size;
    document.getElementById('res-faltantes').textContent = faltantes.length;
    document.getElementById('res-sobrantes').textContent = sobrantes.length;

    // Guardar para historial
    window._faltantes = faltantes;
    window._sobrantes = sobrantes;
  } catch (e) {
    // offline: usar pendingScans
    const entradas = new Set(pendingScans.filter(s => s.modo === 'Entrada').map(s => s.codigo));
    const salidas  = new Set(pendingScans.filter(s => s.modo === 'Salida').map(s => s.codigo));
    document.getElementById('res-entradas').textContent  = entradas.size;
    document.getElementById('res-salidas').textContent   = salidas.size;
    document.getElementById('res-faltantes').textContent = [...entradas].filter(c => !salidas.has(c)).length;
    document.getElementById('res-sobrantes').textContent = [...salidas].filter(c => !entradas.has(c)).length;
  }
}

// ── Overlay duplicado ─────────────────────────────────────────
function mostrarOverlayDuplicado(codigo) {
  sonarDuplicado();
  vibrar([300, 100, 300, 100, 300]);
  const overlay = document.getElementById('overlay-dup');
  document.getElementById('overlay-dup-codigo').textContent = codigo;
  overlay.classList.remove('hidden');
  let t = 3;
  document.getElementById('overlay-timer').textContent = t;
  const interval = setInterval(() => {
    t--;
    document.getElementById('overlay-timer').textContent = t;
    if (t <= 0) {
      clearInterval(interval);
      overlay.classList.add('hidden');
      scanning = false;
    }
  }, 1000);
}

// ── Cámara + BarcodeDetector ──────────────────────────────────
async function iniciarCamara() {
  const video = document.getElementById('video');
  if (!('BarcodeDetector' in window)) {
    setStatus('⚠️ Usá Chrome 90+ en Android.', 'err');
    mostrarInputManual(); return;
  }
  try {
    const detector = new BarcodeDetector({
      formats: ['ean_13','ean_8','code_128','code_39','qr_code','upc_a','upc_e','codabar']
    });
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = videoStream;
    video.style.display = 'block';
    await video.play();
    setStatus('Apuntar y escanear');
    detectLoop = true;
    async function loop() {
      if (!detectLoop) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA && !scanning) {
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) onCodigoDetectado(codes[0].rawValue);
        } catch (e) {}
      }
      setTimeout(loop, 200);
    }
    loop();
  } catch (e) {
    setStatus('Error cámara: ' + e.message, 'err');
    mostrarInputManual();
  }
}

function detenerCamara() {
  detectLoop = false;
  if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
  const video = document.getElementById('video');
  if (video) video.srcObject = null;
}

function mostrarInputManual() {
  const wrap = document.querySelector('.camera-wrap');
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                height:100%;gap:16px;padding:32px;background:#0A0A14;">
      <div style="font-size:48px;">📷</div>
      <p style="color:#ffffff70;text-align:center;font-size:13px;line-height:1.5;">
        Cámara no disponible.<br>Ingresá el código manualmente:
      </p>
      <input id="input-manual" type="text" placeholder="Ej: 7790895000978"
        style="width:100%;padding:14px;border-radius:12px;border:1px solid #00E5FF44;
               background:#1A1A2E;color:white;font-size:16px;text-align:center;" />
      <button id="btn-manual-ok"
        style="width:100%;padding:14px;border-radius:12px;background:#00E5FF;
               color:#000;font-weight:700;border:none;font-size:16px;cursor:pointer;">
        ✓ Registrar
      </button>
      <button id="btn-reintentar-camara"
        style="width:100%;padding:12px;border-radius:12px;background:transparent;
               color:#00E5FF;font-weight:600;border:1px solid #00E5FF44;
               font-size:14px;cursor:pointer;">
        🔄 Reintentar cámara
      </button>
    </div>
  `;
  document.getElementById('btn-manual-ok').addEventListener('click', () => {
    const val = document.getElementById('input-manual').value.trim();
    if (val) { onCodigoDetectado(val); document.getElementById('input-manual').value = ''; }
  });
  document.getElementById('input-manual').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) { onCodigoDetectado(val); e.target.value = ''; }
    }
  });
  document.getElementById('btn-reintentar-camara').addEventListener('click', async () => {
    wrap.innerHTML = `
      <video id="video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
      <canvas id="canvas" hidden></canvas>
      <div class="scan-frame">
        <div class="corner tl"></div><div class="corner tr"></div>
        <div class="corner bl"></div><div class="corner br"></div>
        <div class="scan-line"></div>
      </div>
      <div id="scan-status" class="scan-status">Iniciando cámara...</div>
    `;
    detectLoop = false; appReady = false;
    await new Promise(r => setTimeout(r, 500));
    appReady = true; iniciarCamara();
  });
}

document.getElementById('btn-torch').addEventListener('click', async () => {
  try {
    if (!videoStream) return;
    const track = videoStream.getVideoTracks()[0];
    const torchOn = track.getSettings().torch;
    await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
    document.getElementById('btn-torch').textContent = !torchOn ? '💡' : '🔦';
  } catch (e) { alert('Linterna no disponible.'); }
});

// ── Procesamiento de escaneo ─────────────────────────────────
async function onCodigoDetectado(raw) {
  scanning = true;

  const validacion = validarCodigo(raw);
  if (!validacion.ok) {
    setStatus('⚠️ ' + validacion.msg, 'err');
    vibrar([100, 50, 100]);
    setTimeout(() => { setStatus('Apuntar y escanear'); scanning = false; }, 2500);
    return;
  }

  const codigo = raw.trim().toUpperCase();

  // Verificar duplicado en mismo modo
  const dupLocal = pendingScans.some(s => s.codigo === codigo && s.modo === modo);
  if (dupLocal) { mostrarOverlayDuplicado(codigo); return; }

  if (navigator.onLine) {
    try {
      const snap = await getDocs(query(
        collection(db, 'scans'),
        where('codigo', '==', codigo),
        where('modo', '==', modo),
        where('estado', '==', 'Registrado')
      ));
      if (!snap.empty) { mostrarOverlayDuplicado(codigo); return; }
    } catch (e) {}
  }

  const scan = {
    codigo,
    ubicacion,
    modo,
    usuario:   currentUser?.email || 'anon',
    estado:    'Registrado',
    formato:   validacion.formato,
    timestamp: new Date().toISOString(),
    synced:    false
  };

  pendingScans.push(scan);
  localStorage.setItem('pending_scans', JSON.stringify(pendingScans));

  if (navigator.onLine) {
    try {
      await addDoc(collection(db, 'scans'), { ...scan, timestamp: serverTimestamp() });
      scan.synced = true;
      pendingScans = pendingScans.filter(s => !(s.codigo === codigo && s.modo === modo));
      localStorage.setItem('pending_scans', JSON.stringify(pendingScans));
    } catch (e) {}
  }

  const emoji = modo === 'Entrada' ? '📥' : '📤';
  setStatus(`${emoji} ${modo}: ${codigo} · ${validacion.formato}`, 'ok');
  vibrar([50]);
  actualizarResumen();
  setTimeout(() => { setStatus('Apuntar y escanear'); scanning = false; }, 2000);
}

// ── Historial + filtros ───────────────────────────────────────
let filtroActivo = 'todos';

document.querySelectorAll('.filtro-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('filtro-active'));
    btn.classList.add('filtro-active');
    filtroActivo = btn.dataset.filtro;
    cargarHistorial(filtroActivo);
  });
});

async function cargarHistorial(filtro = 'todos') {
  const lista = document.getElementById('lista-historial');
  lista.innerHTML = '<p style="color:#ffffff50;padding:20px;text-align:center">Cargando...</p>';

  const faltantes = window._faltantes || [];
  const sobrantes = window._sobrantes || [];

  try {
    const snap = await getDocs(query(collection(db, 'scans'), orderBy('timestamp', 'desc')));
    let items = [];
    snap.forEach(doc => items.push(doc.data()));

    // Agregar pendientes
    pendingScans.forEach(s => {
      if (!items.find(i => i.codigo === s.codigo && i.modo === s.modo)) items.unshift(s);
    });

    // Aplicar filtro
    if (filtro === 'Entrada') items = items.filter(s => s.modo === 'Entrada');
    else if (filtro === 'Salida') items = items.filter(s => s.modo === 'Salida');
    else if (filtro === 'faltantes') items = items.filter(s => faltantes.includes(s.codigo));

    if (items.length === 0) {
      lista.innerHTML = '<p style="color:#ffffff30;padding:40px;text-align:center">Sin escaneos</p>';
      return;
    }

    lista.innerHTML = items.map(s => {
      const esDup      = items.filter(i => i.codigo === s.codigo && i.modo === s.modo).length > 1;
      const esFaltante = faltantes.includes(s.codigo);
      const esSobrante = sobrantes.includes(s.codigo);
      const clase = esDup ? 'dup' : (s.modo === 'Salida' ? 'salida' : 'entrada');
      const icon  = esDup ? '⚠️' : (s.modo === 'Salida' ? '📤' : '📥');
      const badge = esDup ? '<span style="color:#FF5252;font-size:10px;font-weight:700;">DUPLICADO</span>'
                  : esFaltante ? '<span style="color:#FF5252;font-size:10px;">FALTANTE</span>'
                  : esSobrante ? '<span style="color:#FF6D00;font-size:10px;">SOBRANTE</span>'
                  : '';
      return `
        <div class="scan-item ${clase}">
          <div class="icon">${icon}</div>
          <div class="info">
            <div class="code">${s.codigo} ${badge}</div>
            <div class="meta">${formatFecha(s.timestamp)} · ${s.usuario?.split('@')[0]}</div>
          </div>
          <span class="modo-tag ${s.modo?.toLowerCase() || 'entrada'}">${s.modo || 'Entrada'}</span>
          <span class="sync-dot">${s.synced === false ? '🟡' : '✅'}</span>
        </div>
      `;
    }).join('');
  } catch (e) {
    lista.innerHTML = '<p style="color:#ffffff30;padding:40px;text-align:center">Sin conexión</p>';
  }
}

// ── Sync offline ─────────────────────────────────────────────
async function sincronizarPendientes() {
  if (!navigator.onLine || pendingScans.length === 0) return;
  const porSync = [...pendingScans];
  for (const scan of porSync) {
    try {
      await addDoc(collection(db, 'scans'), { ...scan, timestamp: serverTimestamp() });
      pendingScans = pendingScans.filter(s => !(s.codigo === scan.codigo && s.modo === scan.modo));
    } catch (e) { break; }
  }
  localStorage.setItem('pending_scans', JSON.stringify(pendingScans));
  actualizarBadgeOnline();
}

// ── Conectividad ─────────────────────────────────────────────
function actualizarBadgeOnline() {
  const badge  = document.getElementById('badge-online');
  const banner = document.getElementById('banner-offline');
  if (navigator.onLine) {
    badge.className = 'badge badge-online'; badge.textContent = '● Online';
    banner.classList.add('hidden');
  } else {
    badge.className = 'badge badge-offline'; badge.textContent = '● Offline';
    banner.classList.remove('hidden');
  }
}
window.addEventListener('online',  () => { actualizarBadgeOnline(); sincronizarPendientes(); });
window.addEventListener('offline', () => actualizarBadgeOnline());
actualizarBadgeOnline();

// ── Utilidades ───────────────────────────────────────────────
function setStatus(msg, tipo = '') {
  const el = document.getElementById('scan-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'scan-status' + (tipo ? ' ' + tipo : '');
}
function vibrar(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}
function formatFecha(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}