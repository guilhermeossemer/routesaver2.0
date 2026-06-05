import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================================================
   CONFIG FIREBASE
========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyCI-ALFDmE8AEGpgZm4clPNOjmhQC48cQk",
  authDomain: "routesaver-e825e.firebaseapp.com",
  projectId: "routesaver-e825e",
  storageBucket: "routesaver-e825e.firebasestorage.app",
  messagingSenderId: "205076725227",
  appId: "1:205076725227:web:dac90146278be50feaedae",
  measurementId: "G-TV9L25D6FE"
};

/* =========================================================
   INIT
========================================================= */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========================================================
   EXPORTS
========================================================= */
export { app, auth, db };