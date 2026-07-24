/* =============================================================
   Dashboard de gestão — carregamento, filtros e ações
   ============================================================= */

const STATUS = ["pendente", "em_analise", "aprovado", "rejeitado", "pago"];
const STATUS_LABEL = {
  pendente: "Pendente",
  em_analise: "Em análise",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  pago: "Pago",
};
const FORM_LABEL = {
  pagamentos: "Pagamento",
  reembolso: "Reembolso",
  "diarias-colaboradores": "Diárias — Colaboradores",
  "diarias-bolsistas": "Diárias — Bolsistas",
};

const ABAS = [
  { id: "pagamentos", label: "Pagamento" },
  { id: "reembolso", label: "Reembolso" },
  { id: "diarias-colaboradores", label: "Diárias — Colaboradores" },
  { id: "diarias-bolsistas", label: "Diárias — Bolsistas" },
];

let TODAS = [];
let LISTA = [];
let supa = null;
let ABA = "pagamentos";

/* Colunas específicas de cada formulário */
const badgeStatus = (s) => `<span class="badge ${s}">${STATUS_LABEL[s] || s}</span>`;
function campoDados(sub, chave) {
  const v = sub.dados ? sub.dados[chave] : undefined;
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return v == null || v === "" ? "—" : v;
}

const COL_INI = [
  { h: "Data/Hora", g: (s) => fmtData(s.criado_em) },
  { h: "Nome", g: (s) => s.nome || "—" },
  { h: "CPF", g: (s) => s.cpf || "—" },
];
const COL_VALOR = { h: "Valor", g: (s) => fmtValor(s.valor), cls: "col-valor" };
const COL_STATUS = { h: "Status", g: (s) => badgeStatus(s.status), html: true };
const COL_DIARIAS = [
  ...COL_INI,
  { h: "Projeto", g: (s) => s.projeto || "—" },
  { h: "Origem → Destino", g: (s) => campoDados(s, "Origem (Estado e Município)") + " → " + campoDados(s, "Destino (Estado e Município)") },
  { h: "Período", g: (s) => campoDados(s, "Período Inicial") + " → " + campoDados(s, "Período Final") },
  COL_VALOR,
  COL_STATUS,
];

const COLUNAS = {
  pagamentos: [...COL_INI, { h: "Chave PIX", g: (s) => campoDados(s, "Chave Pix (CPF)") }, COL_VALOR, COL_STATUS],
  reembolso: [...COL_INI, { h: "Categoria", g: (s) => campoDados(s, "Categoria da Despesa") }, COL_VALOR, COL_STATUS],
  "diarias-colaboradores": COL_DIARIAS,
  "diarias-bolsistas": COL_DIARIAS,
};

/* ---------- Formatação ---------- */
const fmtData = (iso) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
const fmtDataCurta = (iso) =>
  new Date(iso).toLocaleDateString("pt-BR");
const fmtValor = (n) =>
  n == null ? "—" : "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- Inicialização / acesso ---------- */
async function init() {
  supa = await window.rbcipReady;
  const areaLogin = document.getElementById("area-login");
  const areaDash = document.getElementById("area-dashboard");

  if (!supa) {
    areaLogin.innerHTML =
      '<div class="centro"><h2>Configuração pendente</h2>' +
      '<p class="form-intro">O Supabase não está configurado (assets/js/config.js).</p></div>';
    return;
  }

  const sessao = await window.rbcipAuth.sessao();
  if (!sessao) {
    renderLogin(areaLogin);
    return;
  }

  const dados = await window.rbcipAuth.meusDados();
  if (!dados || !dados.is_staff) {
    const { data: u } = await supa.auth.getUser();
    const uid = (u && u.user && u.user.id) || "—";
    const mail = (u && u.user && u.user.email) || "—";
    const lido = dados ? "sim (is_staff=" + dados.is_staff + ")" : "não (RLS não retornou registro)";
    areaLogin.innerHTML =
      '<div class="centro"><div class="login-icon">⛔</div>' +
      "<h2>Acesso restrito</h2>" +
      '<p class="form-intro">Sua conta não tem permissão de gestão.</p>' +
      '<div style="text-align:left;font-size:.8rem;color:var(--muted);background:#f7fafc;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin:14px 0">' +
      "<b>Diagnóstico</b><br>Logado como: " + mail + "<br>uid: " + uid + "<br>Registro lido: " + lido + "</div>" +
      '<button type="button" class="btn btn-secondary" id="btn-sair2">Sair</button></div>';
    document.getElementById("btn-sair2").onclick = () => window.rbcipAuth.sair();
    return;
  }

  // Staff autenticado: mostra o dashboard
  areaLogin.innerHTML = "";
  areaDash.hidden = false;
  document.getElementById("quem").textContent = "👤 " + (dados.nome || "Gestão");
  document.getElementById("btn-sair").onclick = () => window.rbcipAuth.sair();
  configurarFiltros();
  configurarModal();
  await carregar();
}

/* ---------- Login de staff (e-mail + senha) ---------- */
function renderLogin(area) {
  area.innerHTML = `
    <div class="admin-wrap"><div class="form-card">
      <div class="login-panel">
        <div class="login-head">
          <div class="login-icon">🔒</div>
          <h2>Painel de Gestão</h2>
          <p>Acesso restrito à equipe.</p>
        </div>
        <div class="login-step">
          <label>E-mail</label>
          <input type="email" id="d-email" placeholder="voce@rbcip.org" />
          <label>Senha</label>
          <input type="password" id="d-senha" placeholder="Sua senha" />
          <p class="login-msg" id="d-msg"></p>
          <button type="button" class="btn btn-primary" id="d-entrar">Entrar</button>
          <button type="button" class="link-voltar" id="d-esqueci">Esqueci / definir minha senha</button>
          <p class="login-info" id="d-info"></p>
        </div>
      </div>
    </div></div>`;

  const email = area.querySelector("#d-email");
  const senha = area.querySelector("#d-senha");
  const msg = area.querySelector("#d-msg");
  const info = area.querySelector("#d-info");

  async function entrar() {
    msg.textContent = ""; info.textContent = "";
    if (!email.value.trim() || !senha.value) {
      msg.textContent = "Informe e-mail e senha."; return;
    }
    const btn = area.querySelector("#d-entrar");
    btn.disabled = true;
    try {
      const { error } = await supa.auth.signInWithPassword({
        email: email.value.trim(),
        password: senha.value,
      });
      if (error) {
        msg.textContent = "E-mail ou senha inválidos.";
        btn.disabled = false;
        return;
      }
      await init();
    } catch (_) {
      msg.textContent = "Erro ao entrar. Tente novamente.";
      btn.disabled = false;
    }
  }

  senha.addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
  area.querySelector("#d-entrar").onclick = entrar;

  area.querySelector("#d-esqueci").onclick = async () => {
    msg.textContent = ""; info.textContent = "";
    if (!email.value.trim()) { msg.textContent = "Digite seu e-mail para receber o link."; return; }
    const redirect = new URL("redefinir.html", location.href).href;
    const { error } = await supa.auth.resetPasswordForEmail(email.value.trim(), {
      redirectTo: redirect,
    });
    if (error) { msg.textContent = "Não foi possível enviar o link."; return; }
    info.textContent = "Se este e-mail tiver acesso, enviamos um link para definir a senha.";
  };
}

/* ---------- Carregamento dos dados ---------- */
async function carregar() {
  const { data, error } = await supa
    .from("submissoes")
    .select("*")
    .order("criado_em", { ascending: false });
  if (error) { console.error("carregar submissoes:", error); TODAS = []; }
  else { TODAS = data || []; }
  renderTabs();
  aplicarFiltros();
}

/* ---------- Abas por formulário ---------- */
function renderTabs() {
  const cont = document.getElementById("tabs");
  cont.innerHTML = ABAS.map((a) => {
    const n = TODAS.filter((s) => s.formulario === a.id).length;
    return `<button type="button" class="tab ${a.id === ABA ? "ativa" : ""}" data-aba="${a.id}">${a.label}<span class="cont">${n}</span></button>`;
  }).join("");
  cont.querySelectorAll(".tab").forEach((b) => {
    b.onclick = () => { ABA = b.dataset.aba; renderTabs(); aplicarFiltros(); };
  });
}

/* ---------- Filtros ---------- */
function configurarFiltros() {
  ["f-status", "f-de", "f-ate"].forEach((id) =>
    document.getElementById(id).addEventListener("change", aplicarFiltros));
  document.getElementById("f-busca").addEventListener("input", aplicarFiltros);
  document.getElementById("btn-export").addEventListener("click", exportarCSV);
}

function aplicarFiltros() {
  const s = document.getElementById("f-status").value;
  const de = document.getElementById("f-de").value;
  const ate = document.getElementById("f-ate").value;
  const q = document.getElementById("f-busca").value.trim().toLowerCase();

  const lista = TODAS.filter((sub) => {
    if (sub.formulario !== ABA) return false;
    if (s && sub.status !== s) return false;
    if (de && sub.criado_em < de) return false;
    if (ate && sub.criado_em > ate + "T23:59:59") return false;
    if (q) {
      const alvo = [sub.nome, sub.cpf, sub.projeto].join(" ").toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    return true;
  });

  LISTA = lista;
  renderStats(lista);
  renderCabecalho();
  renderTabela(lista);
}

/* ---------- Gráficos ---------- */
function graficoPorMes(lista) {
  const m = new Map();
  lista.forEach((s) => {
    const d = new Date(s.criado_em);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    m.set(key, (m.get(key) || 0) + (Number(s.valor) || 0));
  });
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => {
      const [y, mm] = k.split("-");
      const lbl = new Date(y, mm - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
      return [lbl, v];
    });
}

function graficoPorChave(lista, chave) {
  const m = new Map();
  lista.forEach((s) => {
    const k = s[chave] || "—";
    m.set(k, (m.get(k) || 0) + (Number(s.valor) || 0));
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function barras(titulo, dados) {
  if (!dados.length) {
    return `<div class="grafico"><h3>${esc(titulo)}</h3><p class="vazio-min">Sem dados para exibir.</p></div>`;
  }
  const max = Math.max(...dados.map((d) => d[1])) || 1;
  const linhas = dados
    .map(([k, v]) =>
      `<div class="barra-row"><span class="barra-lbl" title="${esc(k)}">${esc(k)}</span>` +
      `<span class="barra-track"><span class="barra-fill" style="width:${((v / max) * 100).toFixed(1)}%"></span></span>` +
      `<span class="barra-val">${fmtValor(v)}</span></div>`)
    .join("");
  return `<div class="grafico"><h3>${esc(titulo)}</h3>${linhas}</div>`;
}

function renderGraficos(lista) {
  const el = document.getElementById("graficos");
  el.innerHTML =
    barras("Valor por mês", graficoPorMes(lista)) +
    barras("Valor por projeto", graficoPorChave(lista, "projeto"));
}

/* ---------- Exportar CSV ---------- */
function exportarCSV() {
  const cols = COLUNAS[ABA] || [];
  const cab = cols.map((c) => c.h);
  const linhas = LISTA.map((sub) =>
    cols.map((c) => {
      if (c.h === "Status") return STATUS_LABEL[sub.status] || sub.status;
      return String(c.g(sub)).replace(/<[^>]+>/g, "");
    }));
  const escCSV = (v) => {
    v = String(v == null ? "" : v);
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const csv = [cab, ...linhas].map((r) => r.map(escCSV).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ABA + "-" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Resumo ---------- */
function renderStats(lista) {
  const total = lista.length;
  const soma = lista.reduce((a, s) => a + (Number(s.valor) || 0), 0);
  const porStatus = {};
  STATUS.forEach((s) => (porStatus[s] = 0));
  lista.forEach((s) => { if (porStatus[s.status] != null) porStatus[s.status]++; });

  const cards = [
    `<div class="stat"><div class="rotulo">Total</div><div class="valor">${total}</div></div>`,
    `<div class="stat tot-valor"><div class="rotulo">Valor total</div><div class="valor">${fmtValor(soma)}</div></div>`,
    `<div class="stat"><div class="rotulo">Pendentes</div><div class="valor">${porStatus.pendente}</div></div>`,
    `<div class="stat"><div class="rotulo">Aprovados</div><div class="valor">${porStatus.aprovado}</div></div>`,
    `<div class="stat"><div class="rotulo">Pagos</div><div class="valor">${porStatus.pago}</div></div>`,
  ];
  document.getElementById("stats").innerHTML = cards.join("");
}

/* ---------- Cabeçalho e tabela (colunas por formulário) ---------- */
function renderCabecalho() {
  const cols = COLUNAS[ABA] || [];
  document.getElementById("cabecalho").innerHTML =
    "<tr>" + cols.map((c) => `<th class="${c.cls || ""}">${esc(c.h)}</th>`).join("") + "</tr>";
}

function renderTabela(lista) {
  const corpo = document.getElementById("corpo-tabela");
  const vazio = document.getElementById("vazio");
  const cols = COLUNAS[ABA] || [];
  corpo.innerHTML = "";
  vazio.hidden = lista.length > 0;

  lista.forEach((sub) => {
    const tr = document.createElement("tr");
    tr.className = "clicavel";
    tr.innerHTML = cols
      .map((c) => {
        const val = c.g(sub);
        return `<td class="${c.cls || ""}">${c.html ? val : esc(val)}</td>`;
      })
      .join("");
    tr.onclick = () => abrirDetalhe(sub);
    corpo.appendChild(tr);
  });
}

/* ---------- Modal de detalhe ---------- */
function configurarModal() {
  const bg = document.getElementById("modal-bg");
  document.getElementById("modal-fechar").onclick = () => bg.classList.remove("aberto");
  bg.addEventListener("click", (e) => { if (e.target === bg) bg.classList.remove("aberto"); });
}

function abrirDetalhe(sub) {
  const body = document.getElementById("modal-body");
  document.getElementById("modal-titulo").textContent =
    (FORM_LABEL[sub.formulario] || sub.formulario) + " · " + fmtDataCurta(sub.criado_em);

  const linhas = [
    ["Enviado em", fmtData(sub.criado_em)],
    ["Status atual", STATUS_LABEL[sub.status] || sub.status],
  ];
  const dados = sub.dados || {};
  Object.keys(dados).forEach((k) => {
    let v = dados[k];
    if (Array.isArray(v)) v = v.join(", ");
    linhas.push([k, v]);
  });

  body.innerHTML = linhas
    .map(([k, v]) => `<div class="det-linha"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`)
    .join("");

  // Botões de status
  const acoes = document.getElementById("acoes-status");
  acoes.innerHTML = STATUS
    .map((s) => `<button type="button" class="btn-status ${s === sub.status ? "ativo" : ""}" data-status="${s}">${STATUS_LABEL[s]}</button>`)
    .join("");
  acoes.querySelectorAll(".btn-status").forEach((b) => {
    b.onclick = () => mudarStatus(sub, b.dataset.status);
  });

  document.getElementById("modal-bg").classList.add("aberto");
}

async function mudarStatus(sub, novo) {
  if (novo === sub.status) return;
  const acoes = document.getElementById("acoes-status");
  acoes.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const { error } = await supa.from("submissoes").update({ status: novo }).eq("id", sub.id);
  if (error) {
    console.error("mudarStatus:", error);
    alert("Não foi possível atualizar o status.");
    acoes.querySelectorAll("button").forEach((b) => (b.disabled = false));
    return;
  }
  sub.status = novo;
  const item = TODAS.find((s) => s.id === sub.id);
  if (item) item.status = novo;
  document.getElementById("modal-bg").classList.remove("aberto");
  aplicarFiltros();
}

init();
