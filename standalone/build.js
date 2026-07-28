// Builds public/standalone.html: a single self-contained HTML file with the
// service/addition/reduction knowledge base embedded, so it can run entirely
// client-side (no server, no build step) - e.g. for publishing as a static
// page or Artifact. Run with: node standalone/build.js
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");

function readJson(f) {
  return fs.readFileSync(path.join(REPO, "data", "services", f), "utf-8").trim();
}

const dataJs = `const DATA = {
  shisetsu: ${readJson("shisetsu_nyusho_shien.json")},
  seikatsu: ${readJson("seikatsu_kaigo.json")},
  tanki: ${readJson("tanki_nyusho.json")},
  kyodo: ${readJson("kyodo_seikatsu_engo.json")},
  commonAdditions: ${readJson("common_additions.json")},
  commonReductions: ${readJson("common_reductions.json")}
};`;

const style = fs.readFileSync(path.join(__dirname, "style.css"), "utf-8");
const markup = fs.readFileSync(path.join(__dirname, "markup.html"), "utf-8");
const appJs = fs.readFileSync(path.join(__dirname, "app.js"), "utf-8");

const html = `<title>障害福祉サービス 加算・減算台帳</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
${style}
</style>
${markup}
<script>
${dataJs}

${appJs}
</script>
`;

const outPath = path.join(REPO, "public", "standalone.html");
fs.writeFileSync(outPath, html, "utf-8");
console.log("built", outPath, html.length, "bytes");
