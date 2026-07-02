import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./views/App.tsx";
import "./styles.css";

function adoptTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get("token") || params.get("auth") || "").trim();
  if (!token) return;
  try {
    window.localStorage.setItem("hermesConsoleToken", token);
  } catch {
    // Local storage can be unavailable; the auth prompt still accepts manual entry.
  }
  params.delete("token");
  params.delete("auth");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

adoptTokenFromUrl();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
