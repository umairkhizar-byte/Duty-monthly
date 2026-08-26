// ─────────────────────────────────────────────────────────────
// PASTE YOUR OWN FIREBASE CONFIG BELOW.
// Get it from: console.firebase.google.com → your project →
// ⚙️ Project settings → General tab → "Your apps" → Web app (</>) → SDK setup and config
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyA9VU7QfwjzohPZN8F65qq89LTbx_-0faM",
  authDomain: "duty-roster-35cfe.firebaseapp.com",
  projectId: "duty-roster-35cfe",
  storageBucket: "duty-roster-35cfe.firebasestorage.app",
  messagingSenderId: "1025563996252",
  appId: "1:1025563996252:web:9701e27c5f0a7135f1f699"
};

// Do not edit below this line.
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
