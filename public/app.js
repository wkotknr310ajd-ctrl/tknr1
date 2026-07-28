const state = {
  services: [],
  currentService: null,
};

const serviceSelect = document.getElementById("serviceSelect");
const chatServiceScope = document.getElementById("chatServiceScope");
const additionList = document.getElementById("additionList");
const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

const modal = document.getElementById("checkModal");
const closeModalBtn = document.getElementById("closeModal");
const checkTitle = document.getElementById("checkTitle");
const checkSummary = document.getElementById("checkSummary");
const checkForm = document.getElementById("checkForm");
const checkResult = document.getElementById("checkResult");

async function init() {
  const res = await fetch("/api/services");
  const data = await res.json();
  state.services = data.services;

  for (const svc of state.services) {
    const opt1 = document.createElement("option");
    opt1.value = svc.serviceId;
    opt1.textContent = svc.serviceName;
    serviceSelect.appendChild(opt1);

    const opt2 = opt1.cloneNode(true);
    chatServiceScope.appendChild(opt2);
  }
}

serviceSelect.addEventListener("change", async () => {
  const serviceId = serviceSelect.value;
  if (!serviceId) {
    additionList.innerHTML = '<p class="hint">サービス種類を選択すると一覧が表示されます。</p>';
    return;
  }
  const res = await fetch(`/api/services/${serviceId}`);
  const svc = await res.json();
  state.currentService = svc;
  renderAdditionList(svc);
});

function renderAdditionList(svc) {
  additionList.innerHTML = "";
  const items = [
    ...svc.additions.map((a) => ({ ...a, kind: "addition" })),
    ...svc.reductions.map((r) => ({ ...r, kind: "reduction" })),
  ];
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "addition-card";
    card.innerHTML = `
      <div class="name">${item.name}</div>
      <div class="meta">
        <span class="badge ${item.kind === "reduction" ? "reduction" : ""}">${item.kind === "reduction" ? "減算" : "加算"}</span>
        <span>${item.category}</span>
        ${item.scope === "common" ? '<span class="badge">共通</span>' : ""}
      </div>
    `;
    card.addEventListener("click", () => openCheckModal(svc.serviceId, item));
    additionList.appendChild(card);
  }
}

function openCheckModal(serviceId, item) {
  checkTitle.textContent = item.name;
  checkSummary.textContent = item.summary;
  checkForm.innerHTML = "";
  checkResult.textContent = "";
  checkResult.className = "check-result";

  (item.requirements || []).forEach((req) => {
    const row = document.createElement("div");
    row.className = "req-row";
    let control = "";
    if (req.type === "boolean") {
      control = `<select data-req="${req.id}" data-type="boolean">
        <option value="">未回答</option>
        <option value="true">満たす</option>
        <option value="false">満たさない</option>
      </select>`;
    } else if (req.type === "choice") {
      const opts = (req.options || []).map((o) => `<option value="${o}">${o}</option>`).join("");
      control = `<select data-req="${req.id}" data-type="choice"><option value="">未選択</option>${opts}</select>`;
    } else {
      control = `<input type="number" data-req="${req.id}" data-type="numeric" placeholder="数値" style="width:90px" />`;
    }
    row.innerHTML = `<span>${req.text}</span>${control}`;
    checkForm.appendChild(row);
  });

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "check-form-submit";
  submitBtn.textContent = "判定する";
  checkForm.appendChild(submitBtn);

  checkForm.onsubmit = async (e) => {
    e.preventDefault();
    const answers = {};
    checkForm.querySelectorAll("[data-req]").forEach((el) => {
      const { req, type } = el.dataset;
      if (!el.value) return;
      if (type === "boolean") answers[req] = el.value === "true";
      else if (type === "numeric") answers[req] = Number(el.value);
      else answers[req] = el.value;
    });

    const res = await fetch(`/api/eligibility/${serviceId}/${item.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const result = await res.json();
    renderCheckResult(result);
  };

  modal.classList.remove("hidden");
}

const VERDICT_LABEL = {
  likely_eligible: "算定できる可能性が高いです",
  likely_eligible_needs_review: "算定できる可能性がありますが、一部要件は個別確認が必要です",
  likely_not_eligible: "現時点の入力では算定要件を満たしていない可能性が高いです",
  incomplete: "すべての要件に回答すると判定できます",
};

function renderCheckResult(result) {
  if (!result.found) {
    checkResult.textContent = "判定に必要なデータが見つかりませんでした。";
    checkResult.className = "check-result not-eligible";
    return;
  }
  const label = VERDICT_LABEL[result.verdict] || result.verdict;
  const cls =
    result.verdict === "likely_eligible" || result.verdict === "likely_eligible_needs_review"
      ? "eligible"
      : result.verdict === "incomplete"
      ? "incomplete"
      : "not-eligible";
  checkResult.className = `check-result ${cls}`;
  checkResult.textContent = `${label}\n\n${result.disclaimer}`;
}

closeModalBtn.addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden");
});

function appendMessage(role, html) {
  const div = document.createElement("div");
  div.className = `msg msg-${role === "user" ? "user" : "bot"}`;
  div.innerHTML = html;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  appendMessage("user", `<p>${escapeHtml(message)}</p>`);
  chatInput.value = "";
  const submitBtn = chatForm.querySelector("button");
  submitBtn.disabled = true;

  const thinking = appendMessage("bot", "<p>回答を作成しています…</p>");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, serviceId: chatServiceScope.value || undefined }),
    });
    const data = await res.json();
    thinking.innerHTML = `<p>${escapeHtml(data.answer).replace(/\n/g, "<br/>")}</p>`;
    if (data.matches && data.matches.length) {
      const metaLine = data.matches.map((m) => `${m.serviceName}:${m.name}`).join(" / ");
      const meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = `参照した項目: ${metaLine}${data.source === "llm-grounded" ? " (AI生成)" : " (テンプレート回答)"}`;
      thinking.appendChild(meta);
    }
    if (data.sourceExcerpts && data.sourceExcerpts.length) {
      const srcMeta = document.createElement("div");
      srcMeta.className = "msg-meta";
      srcMeta.textContent = `原文出典: ${data.sourceExcerpts.map((s) => s.file).join(" / ")}`;
      thinking.appendChild(srcMeta);
    }
  } catch (err) {
    thinking.innerHTML = `<p>エラーが発生しました: ${escapeHtml(err.message)}</p>`;
  } finally {
    submitBtn.disabled = false;
  }
});

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();
