import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Project pages on GitHub Pages are served from https://<user>.github.io/<repo>/,
// so the production build needs that path as its base. Local dev keeps root ("/").
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/tknr1/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "秒刻みタイマー",
        short_name: "秒刻みタイマー",
        description: "1秒ごとに小さい音、10秒ごとに大きい音が鳴るタイマー",
        start_url: ".",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"]
      }
    })
  ]
}));
