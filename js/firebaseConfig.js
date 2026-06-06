// 1) Crea tu proyecto en Firebase.
// 2) Activa Authentication > Email/Password.
// 3) Crea Cloud Firestore.
// 4) Pega aquí tu configuración real.
// Mientras apiKey siga como "TU_API_KEY", la app abre en modo demo local con localStorage.

export const firebaseConfig = {
  apiKey: "AIzaSyACJ_tXf8znOlNC2bT3OlxTlpm-i2FkOl8",
  authDomain: "mapa-de-experiencias.firebaseapp.com",
  projectId: "mapa-de-experiencias",
  storageBucket: "mapa-de-experiencias.firebasestorage.app",
  messagingSenderId: "131491272175",
  appId: "1:131491272175:web:4b4a3d1efa8b3b0695121a"
};

export const ADMIN_EMAILS = [
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com"
];

export const USE_DEMO_WHEN_UNCONFIGURED = true;
