import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  // Personal-use market data licence: never expose the app beyond this machine.
  server: {
    host: "127.0.0.1",
    strictPort: true,
  },
});
