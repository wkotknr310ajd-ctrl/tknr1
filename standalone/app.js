/* ---------------------------------------------------------------------
 * Data merge (port of lib/dataStore.js)
 * DATA is injected before this script: { shisetsu, seikatsu, tanki, kyodo,
 * commonAdditions, commonReductions }
 * ------------------------------------------------------------------- */
const RAW_SERVICES = [DATA.shisetsu, DATA.seikatsu, DATA.tanki, DATA.kyodo];

const SERVICES = RAW_SERVICES.map((svc) => {
  const additions = [
    ...svc.additions.map((a) => ({ ...a, serviceId: svc.serviceId, scope: "service" })),
    ...DATA.commonAdditions.additions.map((a) => ({ ...a, serviceId: svc.serviceId, scope: "common" })),
  ];
  const reductions = [
    ...(svc.reductions || []).map((r) => ({ ...r, serviceId: svc.serviceId, scope: "service" })),
    ...DATA.commonReductions.reductions.map((r) => ({ ...r, serviceId: svc.serviceId, scope: "common" })),
  ];
  return { ...svc, additions, reductions };
});

function getService(serviceId) {
  return SERVICES.find((s) => s.serviceId === serviceId) || null;
}

function findItemById(serviceId, itemId) {
  const svc = getService(serviceId);
  if (!svc) return null;
  return svc.additions.find((a) => a.id === itemId) || svc.reductions.find((r) => r.id === itemId) || null;
}

/* ---------------------------------------------------------------------
 * Search (port of lib/search.js)
 * ------------------------------------------------------------------- */
const SERVICE_ALIASES = {
  shisetsu_nyusho_shien: ["施設入所支援", "施設入所", "入所施設", "入所支援"],
  seikatsu_kaigo: ["生活介護", "デイサービス", "生活介護事業所"],
  tanki_nyusho: ["短期入所", "ショートステイ", "短期"],
  kyodo_seikatsu_engo: ["共同生活援助", "共同生活介護", "グループホーム", "ケアホーム", "GH", "gh"],
};

function detectServiceIds(query) {
  const hits = [];
  for (const [serviceId, aliases] of Object.entries(SERVICE_ALIASES)) {
    if (aliases.some((alias) => query.includes(alias))) hits.push(serviceId);
  }
  return hits;
}

function bigrams(text) {
  const clean = text.replace(/\s+/g, "");
  const grams = new Set();
  for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2));
  return grams;
}

function scoreOverlap(queryGrams, targetGrams) {
  if (queryGrams.size === 0 || targetGrams.size === 0) return 0;
  let overlap = 0;
  for (const g of queryGrams) if (targetGrams.has(g)) overlap++;
  return overlap / queryGrams.size;
}

function coreName(name) {
  return name.split(/[(（]/)[0].trim();
}

function nameMatchBonus(query, name) {
  const core = coreName(name);
  if (core.length >= 4 && (query.includes(core) || core.includes(query))) return 1.5;
  if (query.includes(name) || name.includes(query)) return 1;
  return 0;
}

function buildSearchableText(item) {
  return [
    item.name,
    item.category,
    item.summary,
    item.notes || "",
    ...(item.requirements || []).map((r) => r.text),
    ...(item.commonPitfalls || []),
  ].join("  ");
}

function search(query, { serviceIds = null, limit = 5, includeReductions = true } = {}) {
  const detected = serviceIds || detectServiceIds(query);
  const services = detected.length ? detected.map(getService).filter(Boolean) : SERVICES;
  const queryGrams = bigrams(query);
  const results = [];

  for (const svc of services) {
    for (const item of svc.additions) {
      const score = scoreOverlap(queryGrams, bigrams(buildSearchableText(item))) + nameMatchBonus(query, item.name);
      if (score > 0) results.push({ type: "addition", serviceId: svc.serviceId, serviceName: svc.serviceName, item, score });
    }
    if (includeReductions) {
      for (const item of svc.reductions) {
        const score = scoreOverlap(queryGrams, bigrams(buildSearchableText(item))) + nameMatchBonus(query, item.name);
        if (score > 0) results.push({ type: "reduction", serviceId: svc.serviceId, serviceName: svc.serviceName, item, score });
      }
    }
  }

  const dedupMap = new Map();
  for (const r of results) {
    const key = r.item.scope === "common" && detected.length === 0 ? `common:${r.item.id}` : `${r.serviceId}:${r.item.id}`;
    const existing = dedupMap.get(key);
    if (!existing || existing.score < r.score) dedupMap.set(key, r);
  }

  return Array.from(dedupMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ---------------------------------------------------------------------
 * Eligibility (port of lib/eligibility.js)
 * ------------------------------------------------------------------- */
function evaluate(item, answers = {}) {
  const requirementResults = (item.requirements || []).map((req) => {
    const answer = answers[req.id];
    if (req.type === "boolean") {
      if (typeof answer !== "boolean") return { ...req, status: "unanswered" };
      return { ...req, status: answer ? "met" : "not_met", answer };
    }
    return { ...req, status: answer === undefined || answer === "" ? "unanswered" : "needs_review", answer };
  });

  const booleanResults = requirementResults.filter((r) => r.type === "boolean");
  const hasUnanswered = requirementResults.some((r) => r.status === "unanswered");
  const hasNeedsReview = requirementResults.some((r) => r.status === "needs_review");
  const isOr = Boolean(item.judgmentLogic && item.judgmentLogic.startsWith("OR"));

  let verdict;
  if (isOr && booleanResults.some((r) => r.status === "met")) verdict = "likely_eligible";
  else if (!isOr && booleanResults.some((r) => r.status === "not_met")) verdict = "likely_not_eligible";
  else if (hasUnanswered) verdict = "incomplete";
  else if (isOr) verdict = "likely_not_eligible";
  else verdict = "likely_eligible";
  if (hasNeedsReview && verdict === "likely_eligible") verdict = "likely_eligible_needs_review";

  return { requirementResults, verdict };
}

const VERDICT_LABEL = {
  likely_eligible: "算定できる可能性が高いです",
  likely_eligible_needs_review: "算定できる可能性がありますが、一部要件は個別確認が必要です",
  likely_not_eligible: "現時点の入力では算定要件を満たしていない可能性が高いです",
  incomplete: "すべての要件に回答すると判定できます",
};

const VERDICT_CLASS = {
  likely_eligible: "v-ok",
  likely_eligible_needs_review: "v-ok",
  likely_not_eligible: "v-bad",
  incomplete: "v-incomplete",
};

/* ---------------------------------------------------------------------
 * Answer formatting (port of lib/answerFormatter.js, template-only)
 * ------------------------------------------------------------------- */
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatItemAnswer(match, index) {
  const { item, serviceName, type } = match;
  const kindLabel = type === "reduction" ? "減算" : "加算";
  const lines = [`${index + 1}. 【${serviceName}】${item.name}(${kindLabel} / ${item.category})`, "", item.summary];
  if (item.requirements && item.requirements.length) {
    lines.push("", "算定要件:");
    const typeLabel = { boolean: "○×要件", numeric: "数値要件", choice: "選択要件" };
    for (const r of item.requirements) lines.push(`  ・(${typeLabel[r.type] || r.type}) ${r.text}`);
  }
  if (item.judgmentLogic) lines.push("", `判定の考え方: ${item.judgmentLogic}`);
  if (item.units) lines.push(`単位数の目安: ${item.units}`);
  if (item.notes) lines.push("", `補足: ${item.notes}`);
  if (item.commonPitfalls && item.commonPitfalls.length) {
    lines.push("", "よくある指摘・誤り:");
    for (const p of item.commonPitfalls) lines.push(`  ・${p}`);
  }
  if (item.verifyAgainst) lines.push("", `要確認先: ${item.verifyAgainst}`);
  return lines.join("\n");
}

function formatAnswer(question, matches) {
  if (!matches.length) {
    return [
      `「${question}」に一致する加算・減算情報が見つかりませんでした。`,
      "サービス種類(施設入所支援・生活介護・短期入所・共同生活援助)や加算名を含めて質問し直してみてください。",
      "例:「生活介護の人員配置体制加算の要件は?」「共同生活援助の夜間支援等体制加算とは?」",
    ].join("\n");
  }
  const header = `「${question}」に関連する可能性が高い加算・減算を${matches.length}件見つけました。`;
  const body = matches.map(formatItemAnswer).join("\n\n---\n\n");
  const footer = [
    "",
    "※ 本回答は一般的な制度知識と厚生労働省の報酬改定資料に基づく参考情報です。単位数や適用の可否は事業所の実際の体制・利用者の状態・自治体の運用により異なる場合があります。",
    "実際の請求(国保連への伝送)にあたっては、必ず最新の報酬告示・留意事項通知・Q&A、及び管轄自治体への確認を行ってください。",
  ].join("\n");
  return [header, "", body, footer].join("\n");
}

/* ---------------------------------------------------------------------
 * UI state & rendering
 * ------------------------------------------------------------------- */
const state = {
  activeServiceId: null,
  activeCategories: new Set(),
  nameFilter: "",
  openItemId: null,
};

const serviceTabsEl = document.getElementById("serviceTabs");
const categoryChipsEl = document.getElementById("categoryChips");
const ledgerListEl = document.getElementById("ledgerList");
const ledgerCountEl = document.getElementById("ledgerCount");
const filterInputEl = document.getElementById("filterInput");
const inquiryForm = document.getElementById("inquiryForm");
const inquiryInput = document.getElementById("inquiryInput");
const inquiryLog = document.getElementById("inquiryLog");

function renderServiceTabs() {
  serviceTabsEl.innerHTML = "";
  for (const svc of SERVICES) {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.textContent = svc.serviceName;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(state.activeServiceId === svc.serviceId));
    btn.addEventListener("click", () => {
      state.activeServiceId = state.activeServiceId === svc.serviceId ? null : svc.serviceId;
      state.activeCategories.clear();
      renderServiceTabs();
      renderCategoryChips();
      renderLedgerList();
    });
    serviceTabsEl.appendChild(btn);
  }
}

function currentItems() {
  if (!state.activeServiceId) return [];
  const svc = getService(state.activeServiceId);
  return [
    ...svc.additions.map((a) => ({ item: a, kind: "addition" })),
    ...svc.reductions.map((r) => ({ item: r, kind: "reduction" })),
  ];
}

function renderCategoryChips() {
  categoryChipsEl.innerHTML = "";
  const items = currentItems();
  if (!items.length) return;
  const categories = Array.from(new Set(items.map((x) => x.item.category))).sort();
  for (const cat of categories) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = cat;
    chip.setAttribute("aria-pressed", String(state.activeCategories.has(cat)));
    chip.addEventListener("click", () => {
      if (state.activeCategories.has(cat)) state.activeCategories.delete(cat);
      else state.activeCategories.add(cat);
      renderCategoryChips();
      renderLedgerList();
    });
    categoryChipsEl.appendChild(chip);
  }
}

function requirementControl(req) {
  if (req.type === "boolean") {
    return `<select data-req="${req.id}" data-type="boolean">
      <option value="">未回答</option>
      <option value="true">満たす</option>
      <option value="false">満たさない</option>
    </select>`;
  }
  if (req.type === "choice") {
    const opts = (req.options || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
    return `<select data-req="${req.id}" data-type="choice"><option value="">未選択</option>${opts}</select>`;
  }
  return `<input type="number" data-req="${req.id}" data-type="numeric" placeholder="数値" />`;
}

function renderLedgerCard(entry) {
  const { item, kind } = entry;
  const isOpen = state.openItemId === `${state.activeServiceId}:${item.id}`;
  const card = document.createElement("div");
  card.className = "ledger-card";
  card.dataset.open = String(isOpen);

  const kindPill = kind === "reduction" ? '<span class="pill pill-gensan">減算</span>' : '<span class="pill pill-kasan">加算</span>';
  const scopePill = item.scope === "common" ? '<span class="pill pill-common">共通</span>' : "";

  const reqRows = (item.requirements || [])
    .map((r) => `<div class="req-row" data-reqrow="${r.id}"><span>${escapeHtml(r.text)}</span>${requirementControl(r)}</div>`)
    .join("");

  const pitfalls = item.commonPitfalls && item.commonPitfalls.length
    ? `<div class="field-label">よくある指摘・誤り</div><ul class="pitfalls">${item.commonPitfalls.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
    : "";

  const sourceFiles = item.sourceFiles && item.sourceFiles.length
    ? `<div>${item.sourceFiles.map((f) => `<span class="stamp">原文</span>${escapeHtml(f)}`).join("<br/>")}</div>`
    : "";

  card.innerHTML = `
    <button type="button" class="ledger-card-head">
      <span class="name">${escapeHtml(item.name)}</span>
      <span class="disclosure" aria-hidden="true">›</span>
    </button>
    <div class="ledger-card-meta">
      ${kindPill}${scopePill}<span class="category">${escapeHtml(item.category)}</span>
    </div>
    <div class="ledger-card-body">
      <p class="summary">${escapeHtml(item.summary)}</p>
      ${item.units ? `<div class="field-label">単位数の目安</div><div class="units-box">${escapeHtml(item.units)}</div>` : ""}
      ${reqRows ? `<div class="field-label">算定要件</div><div class="req-list">${reqRows}</div><button type="button" class="judge-btn">判定する</button><div class="verdict"></div>` : ""}
      ${item.notes ? `<div class="notes-block"><b>補足:</b> ${escapeHtml(item.notes)}</div>` : ""}
      ${pitfalls}
      ${item.verifyAgainst || sourceFiles ? `<div class="citation">${item.verifyAgainst ? `<div>要確認先: ${escapeHtml(item.verifyAgainst)}</div>` : ""}${sourceFiles}</div>` : ""}
    </div>
  `;

  card.querySelector(".ledger-card-head").addEventListener("click", () => {
    const key = `${state.activeServiceId}:${item.id}`;
    state.openItemId = state.openItemId === key ? null : key;
    renderLedgerList();
  });

  const judgeBtn = card.querySelector(".judge-btn");
  if (judgeBtn) {
    judgeBtn.addEventListener("click", () => {
      const answers = {};
      card.querySelectorAll("[data-req]").forEach((el) => {
        const { req, type } = el.dataset;
        if (!el.value) return;
        if (type === "boolean") answers[req] = el.value === "true";
        else if (type === "numeric") answers[req] = Number(el.value);
        else answers[req] = el.value;
      });
      const { verdict } = evaluate(item, answers);
      const verdictEl = card.querySelector(".verdict");
      verdictEl.textContent = VERDICT_LABEL[verdict] || verdict;
      verdictEl.className = `verdict show ${VERDICT_CLASS[verdict] || ""}`;
    });
  }

  return card;
}

function renderLedgerList() {
  ledgerListEl.innerHTML = "";
  if (!state.activeServiceId) {
    ledgerListEl.innerHTML = '<p class="ledger-count">上のタブでサービス種類を選ぶと、加算・減算の一覧が表示されます。</p>';
    ledgerCountEl.textContent = "";
    return;
  }
  let items = currentItems();
  if (state.activeCategories.size) items = items.filter((x) => state.activeCategories.has(x.item.category));
  if (state.nameFilter.trim()) {
    const f = state.nameFilter.trim();
    items = items.filter((x) => x.item.name.includes(f) || x.item.summary.includes(f));
  }
  ledgerCountEl.textContent = `${items.length}件`;
  for (const entry of items) ledgerListEl.appendChild(renderLedgerCard(entry));
}

filterInputEl.addEventListener("input", (e) => {
  state.nameFilter = e.target.value;
  renderLedgerList();
});

function openItemInLedger(serviceId, itemId) {
  state.activeServiceId = serviceId;
  state.activeCategories.clear();
  state.openItemId = `${serviceId}:${itemId}`;
  state.nameFilter = "";
  filterInputEl.value = "";
  renderServiceTabs();
  renderCategoryChips();
  renderLedgerList();
  const card = ledgerListEl.querySelector(`[data-open="true"]`);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function appendLogEntry(role, html) {
  const div = document.createElement("div");
  div.className = `log-entry log-${role}`;
  div.innerHTML = html;
  inquiryLog.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  return div;
}

inquiryForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = inquiryInput.value.trim();
  if (!question) return;
  appendLogEntry("user", escapeHtml(question));
  inquiryInput.value = "";

  const mentioned = detectServiceIds(question);
  const serviceIds = mentioned.length ? mentioned : state.activeServiceId ? [state.activeServiceId] : null;
  const matches = search(question, { serviceIds, limit: 4 });
  const answerText = formatAnswer(question, matches);

  const refsHtml = matches.length
    ? `<div class="refs">${matches
        .map((m) => `<button type="button" class="ref-btn" data-service="${m.serviceId}" data-item="${m.item.id}">${escapeHtml(m.serviceName)}: ${escapeHtml(m.item.name)}</button>`)
        .join("")}</div>`
    : "";

  const entry = appendLogEntry("bot", `<div class="answer-body">${escapeHtml(answerText)}</div>${refsHtml}`);
  entry.querySelectorAll(".ref-btn").forEach((btn) => {
    btn.addEventListener("click", () => openItemInLedger(btn.dataset.service, btn.dataset.item));
  });
});

/* ---------------------------------------------------------------------
 * Init
 * ------------------------------------------------------------------- */
renderServiceTabs();
renderCategoryChips();
renderLedgerList();
appendLogEntry(
  "bot",
  `<div class="answer-body">こんにちは。障害福祉サービスの加算・減算について質問してください。</div>
   <div class="example-chips">
     <button type="button" class="ref-btn" data-example="生活介護の人員配置体制加算の要件を教えて">生活介護の人員配置体制加算の要件を教えて</button>
     <button type="button" class="ref-btn" data-example="共同生活援助の夜間支援等体制加算とは?">共同生活援助の夜間支援等体制加算とは?</button>
     <button type="button" class="ref-btn" data-example="処遇改善加算の仕組みを教えて">処遇改善加算の仕組みを教えて</button>
   </div>`
);
inquiryLog.querySelectorAll("[data-example]").forEach((btn) => {
  btn.addEventListener("click", () => {
    inquiryInput.value = btn.dataset.example;
    inquiryForm.requestSubmit();
  });
});
