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

let TODAS = [];
let supa = null;

/* ---------- Formatação ---------- */
const fmtData = (iso) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
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
    areaLogin.innerHTML =
      '<div class="centro"><div class="login-icon">⛔</div>' +
      "<h2>Acesso restrito</h2>" +
      '<p class="form-intro">Sua conta não tem permissão de gestão. Fale com o administrador.</p>' +
      '<button type="button" class="btn btn-secondary" id="btn-sair2" style="margin-top:16px">Sair</button></div>';
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

/* ---------- Login de staff ---------- */
function renderLogin(area) {
  area.innerHTML = `
    <div class="admin-wrap"><div class="form-card">
      <div class="login-panel">
        <div class="login-head">
          <div class="login-icon">🔒</div>
          <h2>Acesso da equipe</h2>
          <p>Entre com seu CPF para acessar o painel de gestão.</p>
        </div>
        <div class="login-step" data-step="cpf">
          <label>CPF</label>
          <input type="text" id="d-cpf" inputmode="numeric" maxlength="11" placeholder="Somente números" />
          <p class="login-msg" id="d-msg-cpf"></p>
          <button type="button" class="btn btn-primary" id="d-enviar">Enviar código</button>
        </div>
        <div class="login-step" data-step="codigo" hidden>
          <p class="login-info" id="d-enviado"></p>
          <label>Código recebido</label>
          <input type="text" id="d-codigo" inputmode="numeric" placeholder="Digite o código" />
          <p class="login-msg" id="d-msg-cod"></p>
          <button type="button" class="btn btn-primary" id="d-entrar">Entrar</button>
        </div>
      </div>
    </div></div>`;

  const cpf = area.querySelector("#d-cpf");
  cpf.addEventListener("input", () => { cpf.value = cpf.value.replace(/\D/g, ""); });

  area.querySelector("#d-enviar").onclick = async () => {
    const msg = area.querySelector("#d-msg-cpf");
    msg.textContent = "";
    if (cpf.value.length !== 11) { msg.textContent = "Digite um CPF válido (11 números)."; return; }
    const btn = area.querySelector("#d-enviar");
    btn.disabled = true;
    try {
      const r = await window.rbcipAuth.solicitarCodigo(cpf.value);
      if (r.ok) {
        area.querySelector("#d-enviado").textContent =
          "Enviamos um código para " + (r.email_mascarado || "seu e-mail") + ".";
        area.querySelector('[data-step="cpf"]').hidden = true;
        area.querySelector('[data-step="codigo"]').hidden = false;
      } else {
        msg.textContent = r.motivo === "cpf_nao_encontrado"
          ? "CPF não encontrado no sistema."
          : "Não foi possível enviar o código.";
      }
    } catch (e) {
      const t = (e && e.message ? e.message : "").toLowerCase();
      msg.textContent = t.includes("seconds") || t.includes("security")
        ? "Aguarde alguns segundos antes de pedir outro código."
        : "Erro ao enviar o código. Tente novamente.";
    } finally { btn.disabled = false; }
  };

  area.querySelector("#d-entrar").onclick = async () => {
    const msg = area.querySelector("#d-msg-cod");
    msg.textContent = "";
    const codigo = area.querySelector("#d-codigo").value.trim();
    if (!codigo) { msg.textContent = "Digite o código recebido."; return; }
    const btn = area.querySelector("#d-entrar");
    btn.disabled = true;
    try {
      const r = await window.rbcipAuth.verificarCodigo(cpf.value, codigo);
      if (r.ok) { await init(); }
      else { msg.textContent = "Código inválido ou expirado."; btn.disabled = false; }
    } catch (_) {
      msg.textContent = "Erro ao validar o código.";
      btn.disabled = false;
    }
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
  aplicarFiltros();
}

/* ---------- Filtros ---------- */
function configurarFiltros() {
  ["f-formulario", "f-status", "f-de", "f-ate"].forEach((id) =>
    document.getElementById(id).addEventListener("change", aplicarFiltros));
  document.getElementById("f-busca").addEventListener("input", aplicarFiltros);
}

function aplicarFiltros() {
  const f = document.getElementById("f-formulario").value;
  const s = document.getElementById("f-status").value;
  const de = document.getElementById("f-de").value;
  const ate = document.getElementById("f-ate").value;
  const q = document.getElementById("f-busca").value.trim().toLowerCase();

  const lista = TODAS.filter((sub) => {
    if (f && sub.formulario !== f) return false;
    if (s && sub.status !== s) return false;
    if (de && sub.criado_em < de) return false;
    if (ate && sub.criado_em > ate + "T23:59:59") return false;
    if (q) {
      const alvo = [sub.nome, sub.cpf, sub.projeto].join(" ").toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    return true;
  });

  renderStats(lista);
  renderTabela(lista);
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

/* ---------- Tabela ---------- */
function renderTabela(lista) {
  const corpo = document.getElementById("corpo-tabela");
  const vazio = document.getElementById("vazio");
  corpo.innerHTML = "";
  vazio.hidden = lista.length > 0;

  lista.forEach((sub) => {
    const tr = document.createElement("tr");
    tr.className = "clicavel";
    tr.innerHTML = `
      <td>${fmtDataCurta(sub.criado_em)}</td>
      <td>${esc(FORM_LABEL[sub.formulario] || sub.formulario)}</td>
      <td>${esc(sub.nome || "—")}</td>
      <td>${esc(sub.cpf || "—")}</td>
      <td>${esc(sub.projeto || "—")}</td>
      <td class="col-valor">${fmtValor(sub.valor)}</td>
      <td><span class="badge ${sub.status}">${STATUS_LABEL[sub.status] || sub.status}</span></td>`;
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
