import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { installRuntimeGlobal } from "./playground/runtime-global.ts";
import "./tokens.css";

// Publish the shared ieva runtime before any agent module compiles.
installRuntimeGlobal();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
