"use strict";

// Rótulos e ordem das categorias (têm de coincidir com tracker/models.py)
const LABELS = {
  delivered: "Entregue",
  returned: "Devolvido",
  out_for_delivery: "Em distribuição",
  awaiting_pickup: "Aguarda levantamento",
  problem: "Problema",
  in_transit: "Em trânsito",
  registered: "Registado",
  unknown: "Desconhecido",
};
// Ordem por "urgência" para ordenação por defeito
const CAT_ORDER = ["returned", "problem", "awaiting_pickup", "out_for_delivery",
                   "in_transit", "registered", "delivered", "unknown"];

let ALL = [];
let activeFilter = "all";
let searchTerm = "";
let sortKey = "status_category";
let sortDir = 1;

async function load() {
  try {
    const res = await fetch("data.json?_=" + Date.now(), { cache: "no-store" });
    const data = await res.json();
    ALL = data.parcels || [];
    document.getElementById("updated").textContent =
      data.generated_at ? "Atualizado: " + fmtDate(data.generated_at) : "Sem dados ainda";
  } catch (e) {
    document.getElementById("updated").textContent = "Erro ao carregar data.json";
    ALL = [];
  }
  render();
}

function counts() {
  const c = { all: ALL.length };
  for (const p of ALL) {
    const cat = p.error ? "error" : (p.status_category || "unknown");
    c[cat] = (c[cat] || 0) + 1;
  }
  return c;
}

function renderKpis() {
  const c = counts();
  const kpis = [
    { l: "Total", n: c.all || 0, cls: "" },
    { l: "Devolvidos", n: c.returned || 0, cls: (c.returned ? "alert" : "") },
    { l: "Entregues", n: c.delivered || 0, cls: "" },
    { l: "Em trânsito", n: (c.in_transit || 0) + (c.out_for_delivery || 0), cls: "" },
    { l: "A levantar", n: c.awaiting_pickup || 0, cls: "" },
    { l: "Problemas/Erros", n: (c.problem || 0) + (c.error || 0), cls: ((c.problem || c.error) ? "alert" : "") },
  ];
  document.getElementById("kpis").innerHTML = kpis.map(k =>
    `<div class="kpi ${k.cls}"><div class="n">${k.n}</div><div class="l">${k.l}</div></div>`
  ).join("");
}

function renderFilters() {
  const c = counts();
  const cats = ["all", ...CAT_ORDER.filter(cat => c[cat])];
  if (c.error) cats.push("error");
  document.getElementById("filters").innerHTML = cats.map(cat => {
    const label = cat === "all" ? "Todos" : (cat === "error" ? "Erros" : LABELS[cat] || cat);
    const n = cat === "all" ? c.all : (c[cat] || 0);
    return `<button data-cat="${cat}" class="${activeFilter === cat ? "active" : ""}">${label} (${n})</button>`;
  }).join("");
}

function filtered() {
  let rows = ALL.slice();
  if (activeFilter !== "all") {
    rows = rows.filter(p => activeFilter === "error"
      ? !!p.error
      : (p.status_category || "unknown") === activeFilter && !p.error);
  }
  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    rows = rows.filter(p =>
      (p.code || "").toLowerCase().includes(t) ||
      (p.description || "").toLowerCase().includes(t) ||
      (p.status_text || "").toLowerCase().includes(t));
  }
  rows.sort((a, b) => {
    let av, bv;
    if (sortKey === "status_category") {
      av = CAT_ORDER.indexOf(a.status_category || "unknown");
      bv = CAT_ORDER.indexOf(b.status_category || "unknown");
    } else {
      av = (a[sortKey] || "").toString().toLowerCase();
      bv = (b[sortKey] || "").toString().toLowerCase();
    }
    return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir;
  });
  return rows;
}

function chip(p) {
  if (p.error) return `<span class="chip error" title="${esc(p.error)}">Erro</span>`;
  const cat = p.status_category || "unknown";
  return `<span class="chip ${cat}">${LABELS[cat] || cat}</span>`;
}

function renderTable() {
  const rows = filtered();
  const tbody = document.getElementById("tbody");
  document.getElementById("empty").hidden = rows.length > 0;

  tbody.innerHTML = rows.map((p, i) => {
    const hist = (p.history || []);
    const last = p.last_event || {};
    const evText = p.error ? "—" : esc(last.status || p.status_text || "—");
    const evWhen = last.datetime ? `<div class="when">${esc(last.datetime)}${last.location ? " · " + esc(last.location) : ""}</div>` : "";
    const histBtn = hist.length > 1
      ? `<button class="hist-toggle" data-i="${i}">Ver histórico (${hist.length})</button>` : "";
    const histBlock = hist.length > 1
      ? `<div class="history" id="hist-${i}" hidden><ol>` +
        hist.map(e => `<li><span class="h-when">${esc(e.datetime || "")}</span> — ${esc(e.status || "")}${e.location ? " <span class='muted'>(" + esc(e.location) + ")</span>" : ""}</li>`).join("") +
        `</ol></div>` : "";
    return `<tr>
      <td class="code">${esc(p.code)}</td>
      <td>${esc(p.description || "") || '<span class="muted">—</span>'}</td>
      <td>${chip(p)}</td>
      <td>${evText}${evWhen}${histBtn}${histBlock}</td>
      <td class="when">${p.last_checked ? fmtDate(p.last_checked) : "—"}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".hist-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const el = document.getElementById("hist-" + btn.dataset.i);
      el.hidden = !el.hidden;
      btn.textContent = el.hidden ? `Ver histórico (${el.querySelectorAll("li").length})` : "Ocultar histórico";
    });
  });
}

function render() {
  renderKpis();
  renderFilters();
  renderTable();
}

function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// Eventos de UI
document.getElementById("search").addEventListener("input", e => {
  searchTerm = e.target.value.trim();
  renderTable();
});
document.getElementById("filters").addEventListener("click", e => {
  const btn = e.target.closest("button[data-cat]");
  if (!btn) return;
  activeFilter = btn.dataset.cat;
  renderFilters();
  renderTable();
});
document.querySelectorAll("th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
    renderTable();
  });
});
document.getElementById("refresh").addEventListener("click", load);

load();
