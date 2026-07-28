const fs = require("fs");
const path = require("path");

const SERVICES_DIR = path.join(__dirname, "..", "data", "services");

const SERVICE_FILES = [
  "shisetsu_nyusho_shien.json",
  "seikatsu_kaigo.json",
  "tanki_nyusho.json",
  "kyodo_seikatsu_engo.json",
];

const COMMON_FILES = {
  additions: "common_additions.json",
  reductions: "common_reductions.json",
};

function loadJson(filename) {
  const filePath = path.join(SERVICES_DIR, filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

let cache = null;

function loadAll() {
  if (cache) return cache;

  const services = SERVICE_FILES.map(loadJson);
  const commonAdditions = loadJson(COMMON_FILES.additions);
  const commonReductions = loadJson(COMMON_FILES.reductions);

  // Attach common additions/reductions to every service's flat list,
  // tagging their origin so the UI can show "共通" badges.
  const enriched = services.map((svc) => {
    const additions = [
      ...svc.additions.map((a) => ({ ...a, serviceId: svc.serviceId, scope: "service" })),
      ...commonAdditions.additions.map((a) => ({ ...a, serviceId: svc.serviceId, scope: "common" })),
    ];
    const reductions = [
      ...(svc.reductions || []).map((r) => ({ ...r, serviceId: svc.serviceId, scope: "service" })),
      ...commonReductions.reductions.map((r) => ({ ...r, serviceId: svc.serviceId, scope: "common" })),
    ];
    return { ...svc, additions, reductions };
  });

  cache = {
    services: enriched,
    commonAdditions,
    commonReductions,
  };
  return cache;
}

function getServiceList() {
  return loadAll().services.map((s) => ({
    serviceId: s.serviceId,
    serviceName: s.serviceName,
    serviceNameKana: s.serviceNameKana,
    overview: s.overview,
    additionCount: s.additions.length,
    reductionCount: s.reductions.length,
  }));
}

function getService(serviceId) {
  return loadAll().services.find((s) => s.serviceId === serviceId) || null;
}

function getAllAdditionsFlat() {
  const { services } = loadAll();
  const seen = new Set();
  const flat = [];
  for (const svc of services) {
    for (const item of svc.additions) {
      const key = item.scope === "common" ? `common:${item.id}` : `${svc.serviceId}:${item.id}`;
      if (item.scope === "common" && seen.has(key)) continue;
      seen.add(key);
      flat.push(item);
    }
  }
  return flat;
}

function getAllReductionsFlat() {
  const { services } = loadAll();
  const seen = new Set();
  const flat = [];
  for (const svc of services) {
    for (const item of svc.reductions) {
      const key = item.scope === "common" ? `common:${item.id}` : `${svc.serviceId}:${item.id}`;
      if (item.scope === "common" && seen.has(key)) continue;
      seen.add(key);
      flat.push(item);
    }
  }
  return flat;
}

function findAdditionById(serviceId, additionId) {
  const svc = getService(serviceId);
  if (!svc) return null;
  return (
    svc.additions.find((a) => a.id === additionId) ||
    svc.reductions.find((r) => r.id === additionId) ||
    null
  );
}

module.exports = {
  loadAll,
  getServiceList,
  getService,
  getAllAdditionsFlat,
  getAllReductionsFlat,
  findAdditionById,
};
