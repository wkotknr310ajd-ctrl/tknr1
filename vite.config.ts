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
        name: "名刺スキャナー",
        short_name: "名刺スキャナー",
        description: "名刺をカメラで読み取り、Googleドライブに保存してLINEで共有できるアプリ",
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
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        // tesseract.js loads its worker/wasm/traineddata from a CDN at runtime;
        // let those be network-first instead of trying to precache them.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\//,
            handler: "CacheFirst",
            options: {
              cacheName: "tesseract-assets",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      }
    })
  ]
}));
