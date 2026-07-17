import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served from https://kucukkanat.github.io/ieva/ on GitHub Pages, so assets need the
// "/ieva/" base. Override with IEVA_BASE=/ for local root serving if desired.
export default defineConfig({
  root: import.meta.dirname,
  base: process.env.IEVA_BASE ?? "/ieva/",
  plugins: [react()],
  server: { port: 5177 },
});
