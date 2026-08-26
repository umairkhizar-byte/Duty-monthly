// ─────────────────────────────────────────────────────────────
// PASTE YOUR OWN FIREBASE CONFIG BELOW.
// Get it from: console.firebase.google.com → your project →
// ⚙️ Project settings → General tab → "Your apps" → Web app (</>) → SDK setup and config
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

// Do not edit below this line.
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
