import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Appen ligger på https://tragisk.github.io/helle-dokumentstudie/
export default defineConfig({
  plugins: [react()],
  base: "/helle-dokumentstudie/",
});
