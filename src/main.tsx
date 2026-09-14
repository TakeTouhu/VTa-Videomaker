import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isTauri, setBackend } from "@/services/backend";
import { webBackend } from "@/services/webBackend";

async function bootstrap() {
  if (isTauri()) {
    // Loaded lazily so the browser dev server never pulls in Tauri IPC.
    const { tauriBackend } = await import("@/services/tauriBackend");
    setBackend(tauriBackend);
  } else {
    setBackend(webBackend);
  }

  const root = document.getElementById("root");
  if (!root) throw new Error("#root is missing from index.html");

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
