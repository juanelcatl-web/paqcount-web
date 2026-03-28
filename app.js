if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.update(); // Esto obliga a buscar la nueva versión del index.html
    }
  });
}
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCgiTXQeics9Opr4HvLcuZ0b3lmBDy3LL0",
  authDomain: "paqcount.firebaseapp.com",
  projectId: "paqcount",
  storageBucket: "paqcount.firebasestorage.app",
  messagingSenderId: "431677742524",
  appId: "1:431677742524:web:885cc9a5814def648e9fb9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence);

let currentUser = null;
let ubicacion = 'ZonaA';
let modo = 'Entrada';
let scanning = false;
let videoStream = null;
let detectLoop = false;

const platform = window.matchMedia('(display-mode: standalone)').matches ? 'PWA' : 'Web';

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    showScreen('scanner');
    actualizarResumen();
    iniciarCamara();
    gtag('event', 'login', { 'method': 'Google', 'platform': platform });
  } else {
    showScreen('login');
    detenerCamara();
  }
});

document.getElementById('btn-google-login').addEventListener('click', () => {
  signInWithPopup(auth, new GoogleAuthProvider());
});

async function onCodigoDetectado(raw) {
  if (scanning) return;
  scanning = true;
  const codigo = raw.trim().toUpperCase();

  // Enviar a Analytics
  gtag('event', 'package_scan', {
    'mode': modo,
    'location': ubicacion,
    'platform': platform
  });

  try {
    await addDoc(collection(db, 'scans'), {
      codigo, ubicacion, modo,
      usuario: currentUser.email,
      timestamp: serverTimestamp(),
      estado: 'Registrado'
    });
    vibrar([50]);
    actualizarResumen();
  } catch (e) { console.error(e); }

  setTimeout(() => { scanning = false; }, 1500);
}

async function iniciarCamara() {
  const video = document.getElementById('video');
  try {
    const detector = new BarcodeDetector({ formats: ['ean_13', 'code_128', 'qr_code'] });
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = videoStream;
    detectLoop = true;
    (function loop() {
      if (detectLoop) {
        if (video.readyState === video.HAVE_ENOUGH_DATA && !scanning) {
          detector.detect(video).then(codes => {
            if (codes.length > 0) onCodigoDetectado(codes[0].rawValue);
          });
        }
        setTimeout(loop, 200);
      }
    })();
    document.getElementById('scan-status').textContent = 'Listo para escanear';
  } catch (e) { document.getElementById('scan-status').textContent = 'Error cámara'; }
}

function detenerCamara() {
  detectLoop = false;
  if (videoStream) videoStream.getTracks().forEach(t => t.stop());
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

async function actualizarResumen() {
  const snap = await getDocs(collection(db, 'scans'));
  let e = 0, s = 0;
  snap.forEach(doc => {
    if (doc.data().modo === 'Entrada') e++; else s++;
  });
  document.getElementById('res-entradas').textContent = e;
  document.getElementById('res-salidas').textContent = s;
  document.getElementById('res-faltantes').textContent = e - s;
}

function vibrar(p) { if ('vibrate' in navigator) navigator.vibrate(p); }

// UI Toggles
document.getElementById('btn-entrada').onclick = () => { modo = 'Entrada'; document.getElementById('btn-entrada').classList.add('modo-active'); document.getElementById('btn-salida').classList.remove('modo-salida-active'); };
document.getElementById('btn-salida').onclick = () => { modo = 'Salida'; document.getElementById('btn-salida').classList.add('modo-salida-active'); document.getElementById('btn-entrada').classList.remove('modo-active'); };
