import { auth } from "./firebase-config.js";

import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const persistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Não foi possível ativar a sessão persistente:", error);
});

function showAuthModal(title, message) {
  const modal = document.createElement("div");
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.background = "rgba(0,0,0,0.6)";
  modal.style.display = "flex";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.zIndex = "9999";

  const content = document.createElement("div");
  content.style.background = "#0f172a";
  content.style.padding = "24px";
  content.style.borderRadius = "16px";
  content.style.maxWidth = "320px";
  content.style.width = "90%";
  content.style.textAlign = "center";
  content.style.color = "white";
  content.style.boxShadow = "0 20px 50px rgba(0,0,0,0.4)";

  const heading = document.createElement("h3");
  heading.style.marginBottom = "10px";
  heading.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.style.marginBottom = "20px";
  paragraph.style.color = "#cbd5e1";
  paragraph.textContent = message;

  const button = document.createElement("button");
  button.type = "button";
  button.style.background = "#3b82f6";
  button.style.border = "none";
  button.style.padding = "10px 16px";
  button.style.borderRadius = "10px";
  button.style.color = "white";
  button.style.fontWeight = "bold";
  button.style.cursor = "pointer";
  button.textContent = "OK";
  button.onclick = () => modal.remove();

  content.append(heading, paragraph, button);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

function goToDashboard() {
  const base = window.location.origin + window.location.pathname;

  if (base.includes("/public/pages/")) {
    window.location.href = "./dashboard.html";
  } else {
    window.location.href = "./public/pages/dashboard.html";
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    goToDashboard();
    return;
  }

  document.body.classList.remove("auth-checking");
});

const registerForm = document.getElementById("register-form");

if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("register-email")?.value;
    const password = document.getElementById("register-password")?.value;

    try {
      await persistenceReady;
      await createUserWithEmailAndPassword(auth, email, password);
      goToDashboard();
    } catch (error) {
      console.error(error);
      showAuthModal("Erro", "Erro ao cadastrar: " + error.message);
    }
  });
}

const loginForm = document.getElementById("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("login-email")?.value;
    const password = document.getElementById("login-password")?.value;

    try {
      await persistenceReady;
      await signInWithEmailAndPassword(auth, email, password);
      goToDashboard();
    } catch (error) {
      console.error(error);
      showAuthModal("Erro no login", error.message);
    }
  });
}
