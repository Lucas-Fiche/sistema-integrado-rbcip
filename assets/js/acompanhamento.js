/* =============================================================
   Dashboard de Acompanhamento — gráficos e estatísticas (staff)
   ============================================================= */

const FORM_LABEL = {
  pagamentos: "Pagamento",
  reembolso: "Reembolso",
  "diarias-colaboradores": "Diárias — Colaboradores",
  "diarias-bolsistas": "Diárias — Bolsistas",
};
const STATUS_LABEL = {
  pendente: "Pendente", em_analise: "Em análise", aprovado: "Aprovado",
  rejeitado: "Rejeitado", pago: "Pago",
};

let TODAS = [];
let supa = null;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtValor = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString("pt-BR");

/* ---------- Acesso ---------- */
async function init() {
  supa = await window.rbcipReady;
  const areaLogin = document.getElementById("area-login");
  const areaDash = document.getElementById("area-dashboard");
  if (!supa) {
    areaLogin.innerHTML = '<div class="centro"><h2>Configuração pendente</h2><p class="form-intro">Supabase não configurado.</p></div>';
    return;
  }
  const sessao = await window.rbcipAuth.sessao();
  if (!sessao) { renderLogin(areaLogin); return; }
  const dados = await window.rbcipAuth.meusDados();
  if (!dados || !dados.is_staff) {
    areaLogin.innerHTML =
      '<div class="centro"><div class="login-icon">⛔</div><h2>Acesso restrito</h2>' +
      '<p class="form-intro">Sua conta não tem permissão de gestão.</p>' +
      '<button type="button" class="btn btn-secondary" id="btn-sair2" style="margin-top:16px">Sair</button></div>';
    document.getElementById("btn-sair2").onclick = () => window.rbcipAuth.sair();
    return;
  }
  areaLogin.innerHTML = "";
  areaDash.hidden = false;
  document.getElementById("quem").textContent = "👤 " + (dados.nome || "Gestão");
  document.getElementById("btn-sair").onclick = () => window.rbcipAuth.sair();
  ["f-formulario", "f-de", "f-ate"].forEach((id) =>
    document.getElementById(id).addEventListener("change", render));
  await carregar();
}

/* ---------- Login (e-mail + senha) ---------- */
function renderLogin(area) {
  area.innerHTML = `
    <div class="admin-wrap"><div class="form-card"><div class="login-panel">
      <div class="login-head"><div class="login-icon">🔒</div><h2>Painel de Acompanhamento</h2><p>Acesso restrito à equipe.</p></div>
      <div class="login-step">
        <label>E-mail</label><input type="email" id="d-email" placeholder="voce@rbcip.org" />
        <label>Senha</label><input type="password" id="d-senha" placeholder="Sua senha" />
        <p class="login-msg" id="d-msg"></p>
        <button type="button" class="btn btn-primary" id="d-entrar">Entrar</button>
      </div>
    </div></div></div>`;
  const email = area.querySelector("#d-email");
  const senha = area.querySelector("#d-senha");
  const msg = area.querySelector("#d-msg");
  async function entrar() {
    msg.textContent = "";
    if (!email.value.trim() || !senha.value) { msg.textContent = "Informe e-mail e senha."; return; }
    const btn = area.querySelector("#d-entrar");
    btn.disabled = true;
    try {
      const { error } = await supa.auth.signInWithPassword({ email: email.value.trim(), password: senha.value });
      if (error) { msg.textContent = "E-mail ou senha inválidos."; btn.disabled = false; return; }
      await init();
    } catch (_) { msg.textContent = "Erro ao entrar."; btn.disabled = false; }
  }
  senha.addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
  area.querySelector("#d-entrar").onclick = entrar;
}

/* ---------- Dados ---------- */
async function carregar() {
  const { data, error } = await supa.from("submissoes").select("*").order("criado_em", { ascending: false });
  TODAS = error ? [] : (data || []);
  if (error) console.error("carregar:", error);
  render();
}

function filtrar() {
  const f = document.getElementById("f-formulario").value;
  const de = document.getElementById("f-de").value;
  const ate = document.getElementById("f-ate").value;
  return TODAS.filter((s) => {
    if (f && s.formulario !== f) return false;
    if (de && s.criado_em < de) return false;
    if (ate && s.criado_em > ate + "T23:59:59") return false;
    return true;
  });
}

/* ---------- Agrupamentos ---------- */
function somaPor(lista, chaveFn) {
  const m = new Map();
  lista.forEach((s) => { const k = chaveFn(s) || "—"; m.set(k, (m.get(k) || 0) + (Number(s.valor) || 0)); });
  return [...m.entries()];
}
function contarPor(lista, chaveFn) {
  const m = new Map();
  lista.forEach((s) => { const k = chaveFn(s) || "—"; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()];
}
function porMes(lista, agregarValor) {
  const m = new Map();
  lista.forEach((s) => {
    const d = new Date(s.criado_em);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    m.set(key, (m.get(key) || 0) + (agregarValor ? Number(s.valor) || 0 : 1));
  });
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => {
    const [y, mm] = k.split("-");
    return [new Date(y, mm - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }), v];
  });
}

/* ---------- Render ---------- */
function barras(titulo, dados, fmt) {
  if (!dados.length) return `<div class="grafico"><h3>${esc(titulo)}</h3><p class="vazio-min">Sem dados.</p></div>`;
  const max = Math.max(...dados.map((d) => d[1])) || 1;
  const linhas = dados.map(([k, v]) =>
    `<div class="barra-row"><span class="barra-lbl" title="${esc(k)}">${esc(k)}</span>` +
    `<span class="barra-track"><span class="barra-fill" style="width:${((v / max) * 100).toFixed(1)}%"></span></span>` +
    `<span class="barra-val">${fmt(v)}</span></div>`).join("");
  return `<div class="grafico"><h3>${esc(titulo)}</h3>${linhas}</div>`;
}

function render() {
  const lista = filtrar();

  // Estatísticas
  const total = lista.length;
  const soma = lista.reduce((a, s) => a + (Number(s.valor) || 0), 0);
  const media = total ? soma / total : 0;
  const cont = (st) => lista.filter((s) => s.status === st).length;
  document.getElementById("stats").innerHTML = [
    `<div class="stat"><div class="rotulo">Solicitações</div><div class="valor">${fmtInt(total)}</div></div>`,
    `<div class="stat tot-valor"><div class="rotulo">Valor total</div><div class="valor">${fmtValor(soma)}</div></div>`,
    `<div class="stat"><div class="rotulo">Valor médio</div><div class="valor">${fmtValor(media)}</div></div>`,
    `<div class="stat"><div class="rotulo">Pendentes</div><div class="valor">${fmtInt(cont("pendente"))}</div></div>`,
    `<div class="stat"><div class="rotulo">Pagas</div><div class="valor">${fmtInt(cont("pago"))}</div></div>`,
  ].join("");

  // Gráficos
  const labForm = (s) => FORM_LABEL[s.formulario] || s.formulario;
  const labStatus = (s) => STATUS_LABEL[s.status] || s.status;
  const topProjetos = somaPor(lista, (s) => s.projeto).filter((d) => d[0] !== "—").sort((a, b) => b[1] - a[1]).slice(0, 10);
  document.getElementById("graficos").innerHTML =
    barras("Solicitações por formulário", contarPor(lista, labForm).sort((a, b) => b[1] - a[1]), fmtInt) +
    barras("Valor por formulário", somaPor(lista, labForm).sort((a, b) => b[1] - a[1]), fmtValor) +
    barras("Solicitações por status", contarPor(lista, labStatus).sort((a, b) => b[1] - a[1]), fmtInt) +
    barras("Solicitações por mês", porMes(lista, false), fmtInt) +
    barras("Valor por mês", porMes(lista, true), fmtValor) +
    barras("Valor por projeto (top 10)", topProjetos, fmtValor);
}

init();
