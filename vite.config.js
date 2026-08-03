import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// __GH_TOKEN__ is replaced at build time with the value of the VITE_GH_TOKEN
// environment variable (set it in Vercel → Project → Settings → Environment
// Variables, then redeploy). If unset, it becomes "" and GitHub writes are
// simply skipped — the app still runs fully.
export default defineConfig({
  plugins: [react()],
  define: {
    __GH_TOKEN__: JSON.stringify(process.env.VITE_GH_TOKEN || ""),
  },
});
