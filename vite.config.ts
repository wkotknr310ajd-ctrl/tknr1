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
        name: "エギングタイマー",
        short_name: "エギングタイマー",
        description: "沈める・しゃくるなどのフェーズを繰り返すエギング用インターバルタイマー",
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
