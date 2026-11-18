/* =============================================================
   Dashboard de Acompanhamento — indicadores, gráficos e filtros (staff)

   Regras de dados (revisadas):
   - "Valor solicitado" NÃO soma as rejeitadas: pedido rejeitado nunca
     vira pagamento, e somá-lo inflava o total.
   - Datas são lidas no fuso de Brasília. criado_em vem em UTC; comparar
     o texto direto fazia um pedido das 22h de 17/11 contar como 18/11.
   - Todos os filtros valem para TODOS os números e gráficos da página.

   Cores (validadas com o verificador de paleta — daltonismo, contraste):
   - formulários: cor fixa por formulário, nunca muda com filtro;
   - situação: escala ordinal de um só azul (pendente → pago), porque é
     uma sequência; rejeitado em cinza, fora do fluxo.
   ============================================================= */

const FORMS = [
  { id: "pagamentos", nome: "Pagamento", sigla: "PAG", cor: "#1a6da3" },
  { id: "reembolso", nome: "Reembolso", sigla: "REE", cor: "#eb6834" },
  { id: "diarias-colaboradores", nome: "Diárias para Colaboradores", sigla: "DC", cor: "#1baf7a" },
  { id: "diarias-bolsistas", nome: "Diárias para Bolsistas", sigla: "DB", cor: "#6250d6" },
];
const FORM = Object.fromEntries(FORMS.map((f) => [f.id, f]));
// tinta = cor do texto impresso DENTRO da faixa (escolhida por contraste APCA)
const SITUACOES = [
  { id: "pendente", nome: "Pendente", cor: "#7fb3d5", tinta: "#0b1a26" },
  { id: "em_analise", nome: "Em análise", cor: "#4b8fbf", tinta: "#ffffff" },
  { id: "aprovado", nome: "Aprovado", cor: "#1a6da3", tinta: "#ffffff" },
  { id: "pago", nome: "Pago", cor: "#0e4569", tinta: "#ffffff" },
  { id: "rejeitado", nome: "Rejeitado", cor: "#b4bdc6", tinta: "#0b1a26" },
];
const SIT = Object.fromEntries(SITUACOES.map((s) => [s.id, s]));
const ABERTAS = new Set(["pendente", "em_analise", "aprovado"]);
const COR_UNICA = "#1a6da3"; // gráficos de uma série só
const PRAZO_REEMBOLSO = 5;   // dias úteis — prometido no formulário de reembolso

const UF = {
  "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amazonas": "AM", "Bahia": "BA", "Ceará": "CE",
  "Distrito Federal": "DF", "Espírito Santo": "ES", "Goiás": "GO", "Maranhão": "MA", "Mato Grosso": "MT",
  "Mato Grosso do Sul": "MS", "Minas Gerais": "MG", "Pará": "PA", "Paraíba": "PB", "Paraná": "PR",
  "Pernambuco": "PE", "Piauí": "PI", "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN",
  "Rio Grande do Sul": "RS", "Rondônia": "RO", "Roraima": "RR", "Santa Catarina": "SC",
  "São Paulo": "SP", "Sergipe": "SE", "Tocantins": "TO",
};

let TODAS = [];
let LOGS = new Map();      // submissao_id → [{ para, dia }] em ordem
let LOGS_OK = false;
let supa = null;

/* ---------- formatação ---------- */
const fmtInt = (n) => Number(n || 0).toLocaleString("pt-BR");
const fmtBRL = (cent) => (cent / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Eixos: compacto e limpo (R$ 0 · R$ 5 mil · R$ 1,2 mi)
function fmtBRLEixo(cent) {
  const v = cent / 100;
  if (v >= 1e6) return "R$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
  if (v >= 1e3) return "R$ " + (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
  return "R$ " + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
const fmtPct = (x) => (x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "%";
const plural = (n, um, varios) => `${fmtInt(n)} ${n === 1 ? um : varios}`;

/* ---------- datas (sempre no fuso de Brasília) ---------- */
const TZ = "America/Sao_Paulo";
const _fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const diaLocal = (d) => _fmtDia.format(new Date(d));            // "2026-11-18"
const utc = (dia) => { const [y, m, d] = dia.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const deUTC = (t) => new Date(t).toISOString().slice(0, 10);
const somaDias = (dia, n) => deUTC(utc(dia) + n * 86400000);
const difDias = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const diaSemana = (dia) => new Date(utc(dia)).getUTCDay();      // 0 = domingo
const fmtData = (dia) => { const [y, m, d] = dia.split("-"); return `${d}/${m}/${y}`; };
const fmtDiaMes = (dia) => { const [, m, d] = dia.split("-"); return `${d}/${m}`; };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
// Dias úteis de a até b: conta os dias de semana DEPOIS de a, até b inclusive
function diasUteis(a, b) {
  let n = 0;
  for (let d = somaDias(a, 1); d <= b; d = somaDias(d, 1)) { const w = diaSemana(d); if (w !== 0 && w !== 6) n++; }
  return n;
}
const hoje = () => diaLocal(new Date());

/* ---------- DOM seguro (texto sempre via textContent) ---------- */
function el(tag, attrs, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return e;
}
const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
  return e;
}

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
  ligarFiltros();
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
function preparar(s) {
  const dados = s.dados || {};
  return {
    ...s,
    _dia: diaLocal(s.criado_em),
    _cent: Math.round((Number(s.valor) || 0) * 100),
    _cpf: String(s.cpf || dados["CPF"] || "").replace(/\D/g, ""),
    _recibo: s.recibo_numero != null ? `${(FORM[s.formulario] || {}).sigla || "REC"}-${s.recibo_numero}/${s.recibo_ano}` : "—",
  };
}

async function carregar() {
  const dash = document.getElementById("ac-conteudo");
  if (TODAS.length) dash.classList.add("ac-recarregando"); // mantém o quadro anterior, esmaecido
  const [subs, logs] = await Promise.all([
    supa.from("submissoes").select("*").order("criado_em", { ascending: false }),
    supa.from("submissoes_log").select("submissao_id,para,criado_em").order("criado_em", { ascending: true }),
  ]);
  if (subs.error) console.error("carregar submissões:", subs.error);
  TODAS = subs.error ? [] : (subs.data || []).map(preparar);
  LOGS = new Map();
  LOGS_OK = !logs.error;
  if (logs.error) console.error("carregar histórico:", logs.error);
  for (const l of logs.data || []) {
    if (!LOGS.has(l.submissao_id)) LOGS.set(l.submissao_id, []);
    LOGS.get(l.submissao_id).push({ para: l.para, dia: diaLocal(l.criado_em) });
  }
  popularProjetos();
  dash.classList.remove("ac-recarregando");
  render();
}

/* ---------- Filtros ---------- */
const $ = (id) => document.getElementById(id);

function ligarFiltros() {
  const re = () => render();
  ["f-periodo", "f-formulario", "f-status", "f-projeto", "f-de", "f-ate"].forEach((id) => $(id).addEventListener("change", re));
  let t;
  $("f-busca").addEventListener("input", () => { clearTimeout(t); t = setTimeout(re, 200); });
  $("f-periodo").addEventListener("change", () => {
    const custom = $("f-periodo").value === "custom";
    document.querySelectorAll(".ac-campo-datas").forEach((c) => { c.hidden = !custom; });
  });
  $("f-limpar").addEventListener("click", () => {
    $("f-periodo").value = "tudo";
    ["f-formulario", "f-status", "f-projeto", "f-busca", "f-de", "f-ate"].forEach((id) => { $(id).value = ""; });
    document.querySelectorAll(".ac-campo-datas").forEach((c) => { c.hidden = true; });
    render();
  });
  $("f-atualizar").addEventListener("click", carregar);
}

function popularProjetos() {
  const sel = $("f-projeto");
  const atual = sel.value;
  const projetos = [...new Set(TODAS.map((s) => s.projeto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  sel.replaceChildren(el("option", { value: "" }, "Todos"), ...projetos.map((p) => el("option", { value: p }, p)));
  if (projetos.includes(atual)) sel.value = atual;
}

// Intervalo do período escolhido (datas inclusivas) e o período anterior
// de mesma duração, para as comparações.
function intervalo() {
  const p = $("f-periodo").value;
  const h = hoje();
  let de = null, ate = null;
  if (p === "7" || p === "30" || p === "90") { ate = h; de = somaDias(h, -(Number(p) - 1)); }
  else if (p === "mes") { de = h.slice(0, 8) + "01"; ate = h; }
  else if (p === "mes-anterior") { ate = somaDias(h.slice(0, 8) + "01", -1); de = ate.slice(0, 8) + "01"; }
  else if (p === "ano") { de = h.slice(0, 5) + "01-01"; ate = h; }
  else if (p === "custom") { de = $("f-de").value || null; ate = $("f-ate").value || null; }
  if (de && ate && de > ate) [de, ate] = [ate, de];
  let anterior = null;
  if (de && ate) {
    const n = difDias(de, ate) + 1;
    anterior = { de: somaDias(de, -n), ate: somaDias(de, -1) };
  }
  return { de, ate, anterior };
}

function aplicaFiltros(lista, de, ate) {
  const f = $("f-formulario").value, st = $("f-status").value, pj = $("f-projeto").value;
  const semAcento = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const busca = semAcento($("f-busca").value.trim());
  const buscaCpf = busca.replace(/\D/g, "");
  return lista.filter((s) => {
    if (de && s._dia < de) return false;
    if (ate && s._dia > ate) return false;
    if (f && s.formulario !== f) return false;
    if (st === "abertas" ? !ABERTAS.has(s.status) : st && s.status !== st) return false;
    if (pj && s.projeto !== pj) return false;
    if (busca) {
      const nome = semAcento(s.nome);
      if (!nome.includes(busca) && !(buscaCpf.length >= 3 && s._cpf.includes(buscaCpf))) return false;
    }
    return true;
  });
}

/* ---------- Dica (hover e foco de teclado) ---------- */
const DICAS = new WeakMap();
let dicaEl = null;
function dica(alvo, titulo, linhas) {
  alvo.classList.add("ac-mark");
  alvo.setAttribute("tabindex", "0");
  DICAS.set(alvo, { titulo, linhas });
  // Marca gráfica sem texto visível (coluna, bloco) ganha nome acessível
  // com o mesmo conteúdo da dica; linhas com texto já se leem sozinhas.
  if (!alvo.textContent.trim()) {
    alvo.setAttribute("role", "img");
    alvo.setAttribute("aria-label", [titulo, ...linhas.map((l) => `${l.valor} ${l.rotulo}`.trim())].join(". "));
  }
}
function mostrarDica(alvo, x, y) {
  const d = DICAS.get(alvo);
  if (!d) return;
  dicaEl.replaceChildren(
    el("div", { class: "ac-dica__titulo" }, d.titulo),
    ...d.linhas.map((l) => el("div", { class: "ac-dica__linha" },
      l.cor ? el("span", { class: "ac-dica__chave", style: `background:${l.cor}` }) : null,
      el("strong", {}, l.valor), el("span", {}, l.rotulo))),
  );
  dicaEl.hidden = false;
  const r = dicaEl.getBoundingClientRect();
  const px = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
  const py = y - r.height - 12 < 8 ? y + 18 : y - r.height - 12;
  dicaEl.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
}
function esconderDica() { if (dicaEl) dicaEl.hidden = true; }
function ligarDicas() {
  dicaEl = el("div", { class: "ac-dica", role: "tooltip", hidden: true });
  document.body.append(dicaEl);
  const raiz = $("ac-conteudo");
  raiz.addEventListener("pointermove", (e) => {
    const a = e.target.closest(".ac-mark");
    if (a) mostrarDica(a, e.clientX, e.clientY); else esconderDica();
  });
  raiz.addEventListener("pointerleave", esconderDica);
  raiz.addEventListener("focusin", (e) => {
    const a = e.target.closest(".ac-mark");
    if (!a) return;
    const r = a.getBoundingClientRect();
    mostrarDica(a, r.left + r.width / 2, r.top);
  });
  raiz.addEventListener("focusout", esconderDica);
  window.addEventListener("scroll", esconderDica, { passive: true });
}

/* ---------- Cartão (título, legenda, gráfico e versão em tabela) ---------- */
const EM_TABELA = new Set(); // cartões que a pessoa deixou em "Ver tabela"
function cartao(grade, { titulo, sub, span = 6, id }) {
  const btn = el("button", { type: "button", class: "ac-btn-tabela", "aria-pressed": "false" }, "Ver tabela");
  const corpo = el("div", { class: "ac-corpo" });
  const tabelaBox = el("div", { class: "ac-tabela-box", hidden: true });
  const legenda = el("div", { class: "ac-legenda" });
  const card = el("article", { class: `ac-card ac-span-${span}`, id },
    el("header", { class: "ac-card__cab" },
      el("div", {}, el("h2", {}, titulo), sub ? el("p", {}, sub) : null),
      btn),
    legenda, corpo, tabelaBox);
  const modo = (ver) => {
    tabelaBox.hidden = !ver;
    corpo.hidden = ver;
    legenda.hidden = ver;
    btn.textContent = ver ? "Ver gráfico" : "Ver tabela";
    btn.setAttribute("aria-pressed", String(ver));
    if (ver) EM_TABELA.add(titulo); else EM_TABELA.delete(titulo);
  };
  btn.addEventListener("click", () => modo(tabelaBox.hidden));
  if (EM_TABELA.has(titulo)) modo(true);
  grade.append(card);
  return {
    card, corpo, legenda,
    tabela(cab, linhas, numericas = []) { tabelaBox.replaceChildren(tabela(cab, linhas, numericas)); },
    semTabela() { btn.remove(); },
  };
}

function tabela(cab, linhas, numericas = []) {
  const num = new Set(numericas);
  // Com 4+ colunas, a tabela vira lista empilhada no cartão estreito (CSS);
  // data-rotulo leva o nome da coluna para cada célula.
  return el("div", { class: "ac-tabela-wrap" }, el("table", { class: `ac-tabela${cab.length >= 4 ? " ac-tabela--empilha" : ""}` },
    el("thead", {}, el("tr", {}, cab.map((c, i) => el("th", { scope: "col", class: num.has(i) ? "num" : null }, c)))),
    el("tbody", {}, linhas.length
      ? linhas.map((l) => el("tr", {}, l.map((c, i) => el("td", { class: num.has(i) ? "num" : null, "data-rotulo": cab[i] }, c))))
      : el("tr", {}, el("td", { colspan: cab.length, class: "ac-vazio" }, "Sem dados no recorte."))),
  ));
}

function legendaItens(box, itens) {
  box.replaceChildren(...itens.map((i) => el("span", { class: "ac-legenda__item" },
    el("span", { class: "ac-legenda__cor", style: `background:${i.cor}` }), i.nome)));
}

const vazio = (corpo, texto = "Sem dados no recorte selecionado.") => corpo.replaceChildren(el("p", { class: "ac-vazio" }, texto));

/* ---------- Barras ranqueadas (horizontais) ---------- */
function barrasRanqueadas(corpo, itens, fmt) {
  if (!itens.length) return vazio(corpo);
  const max = Math.max(...itens.map((i) => i.valor)) || 1;
  corpo.replaceChildren(el("div", { class: "ac-ranking" }, itens.map((i) => {
    const linha = el("div", { class: "ac-ranking__linha" },
      el("span", { class: "ac-ranking__nome", title: i.nome }, i.nome),
      el("span", { class: "ac-ranking__trilho" },
        el("span", { class: "ac-ranking__barra", style: `width:${Math.max(0.6, (i.valor / max) * 100).toFixed(2)}%;background:${i.cor || COR_UNICA}` })),
      el("span", { class: "ac-ranking__valor" }, fmt(i.valor), i.extra ? el("small", {}, i.extra) : null));
    dica(linha, i.nome, i.dica || [{ valor: fmt(i.valor), rotulo: "" }]);
    return linha;
  })));
}

/* ---------- Colunas (empilhadas ou simples) no eixo do tempo ---------- */
function escalaLimpa(max, n = 4) {
  if (max <= 0) return { topo: 1, passo: 1 };
  const bruto = max / n;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto);
  return { topo: passo * Math.ceil(max / passo), passo };
}
function larguraTexto(txt, px = 11.5) {
  const c = larguraTexto.c || (larguraTexto.c = document.createElement("canvas").getContext("2d"));
  c.font = `${px}px "Segoe UI", system-ui, sans-serif`;
  return c.measureText(txt).width;
}

function colunas(corpo, grupos, { series, fmtEixo, fmtValor, rotuloTotal = "Total" }) {
  const total = grupos.reduce((a, g) => a + g.total, 0);
  if (!total) return vazio(corpo);
  const W = Math.max(280, corpo.clientWidth || 600);
  const altPlot = 210;
  const { topo, passo } = escalaLimpa(Math.max(...grupos.map((g) => g.total)));
  const ticks = [];
  for (let v = 0; v <= topo + 1e-9; v += passo) ticks.push(v);
  const esq = Math.ceil(Math.max(...ticks.map((t) => larguraTexto(fmtEixo(t))))) + 10;
  const M = { t: 18, r: 6, b: 26, l: esq };
  const larg = W - M.l - M.r;
  const banda = larg / grupos.length;
  const col = Math.max(3, Math.min(24, banda * 0.62));
  const y = (v) => M.t + altPlot - (v / topo) * altPlot;
  const H = M.t + altPlot + M.b;

  const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "ac-svg", role: "img",
    "aria-label": `Gráfico de colunas com ${grupos.length} períodos. Use "Ver tabela" para os valores.` });
  for (const t of ticks) {
    svg.append(svgEl("line", { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), class: t === 0 ? "ac-eixo" : "ac-grade-linha" }));
    const tx = svgEl("text", { x: M.l - 8, y: y(t) + 4, "text-anchor": "end", class: "ac-tick" });
    tx.textContent = fmtEixo(t);
    svg.append(tx);
  }
  // Rótulos do eixo X sem colidir: mostra um a cada "salto"
  const largRot = Math.max(...grupos.map((g) => larguraTexto(g.rotulo, 11)));
  const salto = Math.max(1, Math.ceil((largRot + 10) / banda));
  const maior = grupos.reduce((m, g, i) => (g.total > grupos[m].total ? i : m), 0);

  grupos.forEach((g, i) => {
    const cx = M.l + banda * i + banda / 2;
    const gEl = svgEl("g", { class: "ac-col" });
    let base = y(0);
    const partes = series.map((s) => ({ s, v: g.partes[s.id] || 0 })).filter((p) => p.v > 0);
    partes.forEach((p, k) => {
      const h = (p.v / topo) * altPlot;
      const ultimo = k === partes.length - 1;
      const hDesenho = ultimo ? h : Math.max(0, h - 2); // 2px de respiro entre segmentos
      const x0 = cx - col / 2, y0 = base - h;
      if (ultimo) {
        const r = Math.min(4, hDesenho, col / 2); // ponta arredondada, base reta
        gEl.append(svgEl("path", { fill: p.s.cor,
          d: `M${x0},${base} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + col - r} Q${x0 + col},${y0} ${x0 + col},${y0 + r} V${base} Z` }));
      } else if (hDesenho > 0) {
        gEl.append(svgEl("rect", { x: x0, y: base - h + 2, width: col, height: hDesenho, fill: p.s.cor }));
      }
      base -= h;
    });
    // Alvo do hover: a faixa inteira do período, não só a coluna
    const alvo = svgEl("rect", { x: M.l + banda * i, y: M.t, width: banda, height: altPlot, fill: "transparent" });
    gEl.append(alvo);
    dica(gEl, g.titulo, [
      ...series.map((s) => ({ cor: series.length > 1 ? s.cor : null, valor: fmtValor(g.partes[s.id] || 0), rotulo: s.nome })),
      ...(series.length > 1 ? [{ valor: fmtValor(g.total), rotulo: rotuloTotal }] : []),
    ]);
    svg.append(gEl);
    if (i % salto === 0) {
      const lx = svgEl("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "ac-tick" });
      lx.textContent = g.rotulo;
      svg.append(lx);
    }
  });
  // Rótulo direto só no pico (seletivo, nunca em todas as colunas)
  if (grupos[maior].total > 0) {
    const g = grupos[maior];
    const cx = M.l + banda * maior + banda / 2;
    const t = svgEl("text", { x: Math.min(Math.max(cx, M.l + 30), W - 30), y: y(g.total) - 6, "text-anchor": "middle", class: "ac-rotulo-pico" });
    t.textContent = fmtValor(g.total);
    svg.append(t);
  }
  corpo.replaceChildren(svg);
}

/* ---------- Barra segmentada (uma parte de um todo) ---------- */
function barraSegmentada(corpo, partes, fmtValor) {
  const total = partes.reduce((a, p) => a + p.qtd, 0);
  if (!total) return vazio(corpo);
  const barra = el("div", { class: "ac-seg", role: "img", "aria-label": "Distribuição por situação. Detalhes na lista abaixo." });
  for (const p of partes) {
    if (!p.qtd) continue;
    const share = p.qtd / total;
    const bloco = el("span", { class: "ac-seg__bloco", style: `flex:${p.qtd} 1 0;background:${p.cor};color:${p.tinta}` });
    const txt = fmtPct(share);
    bloco.dataset.rotulo = txt;
    dica(bloco, p.nome, [{ cor: p.cor, valor: plural(p.qtd, "solicitação", "solicitações"), rotulo: fmtPct(share) }, { valor: fmtValor(p.cent), rotulo: "valor" }]);
    barra.append(bloco);
  }
  const lista = el("ul", { class: "ac-seg-lista" }, partes.map((p) =>
    el("li", {},
      el("span", { class: "ac-legenda__cor", style: `background:${p.cor}` }),
      el("span", { class: "ac-seg-lista__nome" }, p.nome),
      el("span", { class: "ac-seg-lista__qtd" }, fmtInt(p.qtd)),
      el("span", { class: "ac-seg-lista__valor" }, fmtValor(p.cent)))));
  corpo.replaceChildren(barra, lista);
  // Percentual dentro do bloco só quando cabe com folga (sem cortar texto)
  requestAnimationFrame(() => barra.querySelectorAll(".ac-seg__bloco").forEach((b) => {
    if (b.clientWidth >= larguraTexto(b.dataset.rotulo, 12) + 14) b.textContent = b.dataset.rotulo;
  }));
}

/* ---------- Medidor (uma proporção contra o limite) ---------- */
function medidor(pct, rotulo) {
  const estado = pct >= 0.9 ? { cls: "bom", txt: "Dentro do esperado", icone: "✓" }
    : pct >= 0.7 ? { cls: "atencao", txt: "Atenção", icone: "!" }
    : { cls: "critico", txt: "Abaixo do esperado", icone: "!" };
  return el("div", { class: `ac-medidor ac-medidor--${estado.cls}` },
    el("div", { class: "ac-medidor__topo" },
      el("span", { class: "ac-medidor__valor" }, fmtPct(pct)),
      el("span", { class: "ac-medidor__estado" }, el("span", { class: "ac-medidor__icone", "aria-hidden": "true" }, estado.icone), estado.txt)),
    el("div", { class: "ac-medidor__trilho", role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct * 100)), "aria-label": rotulo },
      el("span", { style: `width:${(pct * 100).toFixed(1)}%` })),
    el("p", { class: "ac-medidor__rotulo" }, rotulo));
}

/* ---------- Períodos do eixo do tempo (dia, semana ou mês, pela duração) ---------- */
function periodos(de, ate) {
  const n = difDias(de, ate) + 1;
  const out = [];
  if (n <= 31) {
    for (let d = de; d <= ate; d = somaDias(d, 1)) out.push({ chave: d, de: d, ate: d, rotulo: fmtDiaMes(d), titulo: fmtData(d) });
    return { tipo: "dia", lista: out };
  }
  if (n <= 182) {
    let ini = somaDias(de, -((diaSemana(de) + 6) % 7)); // segunda-feira
    for (; ini <= ate; ini = somaDias(ini, 7)) {
      const fim = somaDias(ini, 6);
      out.push({ chave: ini, de: ini, ate: fim, rotulo: fmtDiaMes(ini), titulo: `Semana de ${fmtDiaMes(ini)} a ${fmtData(fim)}` });
    }
    return { tipo: "semana", lista: out };
  }
  let m = de.slice(0, 7);
  while (m <= ate.slice(0, 7)) {
    const [y, mm] = m.split("-").map(Number);
    const fim = somaDias(`${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}-01`, -1);
    out.push({ chave: m, de: `${m}-01`, ate: fim, rotulo: `${MESES[mm - 1]}/${String(y).slice(2)}`, titulo: `${MESES[mm - 1]} de ${y}` });
    m = `${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}`;
  }
  return { tipo: "mês", lista: out };
}
function agrupaPorPeriodo(lista, pers, valorDe) {
  return pers.map((p) => {
    const partes = {};
    let total = 0;
    for (const s of lista) {
      if (s._dia < p.de || s._dia > p.ate) continue;
      const v = valorDe(s);
      partes[s.formulario] = (partes[s.formulario] || 0) + v;
      total += v;
    }
    return { ...p, partes, total };
  });
}

/* ---------- Leituras específicas ---------- */
function cidade(txt) {
  const m = String(txt || "").match(/^(.+?),\s*(.+)$/);
  if (!m) return String(txt || "").trim();
  return `${m[2].trim()}/${UF[m[1].trim()] || m[1].trim()}`;
}
function pernoites(s) {
  const d = s.dados || {};
  const a = d["Período Inicial"], b = d["Período Final"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a || "") || !/^\d{4}-\d{2}-\d{2}$/.test(b || "")) return null;
  const n = difDias(a, b);
  return n >= 0 ? n : null;
}
function categorias(s) {
  const c = (s.dados || {})["Categoria da Despesa"];
  return (Array.isArray(c) ? c : c ? [c] : []).map((x) => (String(x).startsWith("Outro") ? "Outro" : String(x)));
}
const mascaraCpf = (cpf) => (cpf.length === 11 ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : "—");
// Top N + "Outros" (nunca mais cores/linhas que o leitor consegue comparar)
function topComOutros(pares, n) {
  const ord = pares.sort((a, b) => b[1] - a[1]);
  if (ord.length <= n) return ord;
  const resto = ord.slice(n - 1).reduce((a, p) => a + p[1], 0);
  return [...ord.slice(0, n - 1), [`Outros (${ord.length - n + 1})`, resto]];
}
function primeiroLog(s, condicao) {
  const l = (LOGS.get(s.id) || []).find(condicao);
  return l ? l.dia : null;
}

/* ---------- Render ---------- */
function render() {
  esconderDica();
  const { de, ate, anterior } = intervalo();
  const lista = aplicaFiltros(TODAS, de, ate);
  const ant = anterior ? aplicaFiltros(TODAS, anterior.de, anterior.ate) : null;
  const validas = lista.filter((s) => s.status !== "rejeitado");
  const soma = (l) => l.reduce((a, s) => a + s._cent, 0);

  // Recorte em palavras
  const desde = TODAS.length ? TODAS.reduce((m, s) => (s._dia < m ? s._dia : m), TODAS[0]._dia) : null;
  $("ac-recorte").textContent = [
    plural(lista.length, "solicitação", "solicitações"),
    de && ate ? `${fmtData(de)} a ${fmtData(ate)}` : de ? `desde ${fmtData(de)}` : ate ? `até ${fmtData(ate)}` : desde ? `todo o período (desde ${fmtData(desde)})` : "todo o período",
    anterior ? `comparação com ${fmtData(anterior.de)} a ${fmtData(anterior.ate)}` : null,
  ].filter(Boolean).join(" · ");

  renderKpis(lista, validas, ant, soma);
  renderAlertas(lista);

  const grade = $("ac-grade");
  grade.replaceChildren();
  renderEvolucao(grade, lista, validas, de, ate);
  renderSituacao(grade, lista);
  renderFormularios(grade, lista, validas);
  renderVolume(grade, lista, de, ate);
  renderPrazos(grade, lista);
  renderFila(grade, lista);
  renderDestinos(grade, validas);
  renderProjetos(grade, validas);
  renderCategorias(grade, validas);
  renderBeneficiarios(grade, validas);
  renderDuplicidades(grade, validas);
}

function variacao(atual, anterior) {
  if (anterior == null) return null;
  if (!anterior) return atual ? { txt: "sem base no período anterior", cls: "neutra" } : null;
  const r = (atual - anterior) / anterior;
  if (Math.abs(r) < 0.005) return { txt: "= igual ao período anterior", cls: "neutra" };
  return { txt: `${r > 0 ? "▲" : "▼"} ${fmtPct(Math.abs(r))} vs. período anterior`, cls: "neutra" };
}

function renderKpis(lista, validas, ant, soma) {
  const porSit = (l, id) => l.filter((s) => s.status === id);
  const antValidas = ant ? ant.filter((s) => s.status !== "rejeitado") : null;
  const solicitado = soma(validas);
  const pago = soma(porSit(lista, "pago"));
  const aPagar = porSit(lista, "aprovado");
  const emAberto = lista.filter((s) => s.status === "pendente" || s.status === "em_analise");
  const rejeitadas = porSit(lista, "rejeitado");
  const tiles = [
    { cls: "ac-kpi--heroi", rotulo: "Valor solicitado", valor: fmtBRL(solicitado),
      sub: [`Ticket médio ${fmtBRL(validas.length ? Math.round(solicitado / validas.length) : 0)}`,
        rejeitadas.length ? `Não inclui ${plural(rejeitadas.length, "rejeitada", "rejeitadas")} (${fmtBRL(soma(rejeitadas))})` : "Nenhuma rejeitada no recorte"],
      delta: variacao(solicitado, antValidas ? soma(antValidas) : null) },
    { rotulo: "Solicitações", valor: fmtInt(lista.length),
      sub: `${plural(rejeitadas.length, "rejeitada", "rejeitadas")} · ${fmtInt(lista.filter((s) => s.por_terceiro).length)} por terceiros`,
      delta: variacao(lista.length, ant ? ant.length : null) },
    { rotulo: "Pago", valor: fmtBRL(pago), sub: solicitado ? `${fmtPct(pago / solicitado)} do solicitado` : "—",
      delta: variacao(pago, ant ? soma(porSit(ant, "pago")) : null) },
    { rotulo: "A pagar (aprovado)", valor: fmtBRL(soma(aPagar)), sub: plural(aPagar.length, "solicitação", "solicitações") },
    { rotulo: "Em análise ou pendente", valor: fmtBRL(soma(emAberto)), sub: plural(emAberto.length, "solicitação", "solicitações") },
  ];
  $("ac-kpis").replaceChildren(...tiles.map((t) => el("div", { class: `ac-kpi ${t.cls || ""}` },
    el("span", { class: "ac-kpi__rotulo" }, t.rotulo),
    el("span", { class: "ac-kpi__valor" }, t.valor),
    [].concat(t.sub).map((s) => el("span", { class: "ac-kpi__sub" }, s)),
    t.delta ? el("span", { class: `ac-kpi__delta ac-kpi__delta--${t.delta.cls}` }, t.delta.txt) : null)));
}

function renderAlertas(lista) {
  const naoEnviados = lista.filter((s) => !s.recibo_enviado_em).length;
  const box = $("ac-alertas");
  box.replaceChildren();
  if (naoEnviados) {
    box.append(el("p", { class: "ac-alerta" },
      el("span", { class: "ac-alerta__icone", "aria-hidden": "true" }, "!"),
      el("span", {}, el("b", {}, `${plural(naoEnviados, "recibo não enviado", "recibos não enviados")} por e-mail`),
        " neste recorte. Enquanto o e-mail não chega, o pagamento não é processado. "),
      el("a", { href: "index.html" }, "Ver na Gestão")));
  }
}

// Início do eixo do tempo: o filtro, ou a solicitação mais antiga do recorte
const inicioDe = (lista, de) => de || (lista.length ? lista.reduce((m, s) => (s._dia < m ? s._dia : m), lista[0]._dia) : hoje());

function renderEvolucao(grade, lista, validas, de, ate) {
  const { tipo, lista: pers } = periodos(inicioDe(lista, de), ate || hoje());
  const c = cartao(grade, { titulo: "Evolução do valor solicitado", span: 8,
    sub: `Por ${tipo}, empilhado por formulário · sem as rejeitadas` });
  const grupos = agrupaPorPeriodo(validas, pers, (s) => s._cent);
  const presentes = FORMS.filter((f) => validas.some((s) => s.formulario === f.id));
  legendaItens(c.legenda, presentes);
  colunas(c.corpo, grupos, { series: presentes, fmtEixo: fmtBRLEixo, fmtValor: fmtBRL });
  c.tabela(["Período", ...presentes.map((f) => f.nome), "Total"],
    grupos.filter((g) => g.total).map((g) => [g.titulo, ...presentes.map((f) => fmtBRL(g.partes[f.id] || 0)), fmtBRL(g.total)]),
    presentes.map((_, i) => i + 1).concat(presentes.length + 1));
}

function renderSituacao(grade, lista) {
  const c = cartao(grade, { titulo: "Situação das solicitações", sub: "Quantidade e valor em cada etapa", span: 4 });
  const partes = SITUACOES.map((s) => {
    const l = lista.filter((x) => x.status === s.id);
    return { ...s, qtd: l.length, cent: l.reduce((a, x) => a + x._cent, 0) };
  });
  barraSegmentada(c.corpo, partes, fmtBRL);
  const total = lista.length || 1;
  c.tabela(["Situação", "Solicitações", "%", "Valor"], partes.map((p) => [p.nome, fmtInt(p.qtd), fmtPct(p.qtd / total), fmtBRL(p.cent)]), [1, 2, 3]);
}

function renderFormularios(grade, lista, validas) {
  const c = cartao(grade, { titulo: "Por formulário", sub: "Valor solicitado (sem as rejeitadas)", span: 6 });
  const itens = FORMS.map((f) => {
    const l = validas.filter((s) => s.formulario === f.id);
    const cent = l.reduce((a, s) => a + s._cent, 0);
    return { f, nome: f.nome, valor: cent, cor: f.cor, qtd: l.length,
      extra: `${plural(l.length, "solicitação", "solicitações")}`,
      dica: [{ cor: f.cor, valor: fmtBRL(cent), rotulo: "valor solicitado" }, { valor: fmtInt(l.length), rotulo: "solicitações" },
        { valor: fmtBRL(l.length ? Math.round(cent / l.length) : 0), rotulo: "ticket médio" }] };
  }).filter((i) => i.qtd).sort((a, b) => b.valor - a.valor);
  barrasRanqueadas(c.corpo, itens, fmtBRL);
  c.tabela(["Formulário", "Solicitações", "Valor solicitado", "Ticket médio"],
    itens.map((i) => [i.nome, fmtInt(i.qtd), fmtBRL(i.valor), fmtBRL(i.qtd ? Math.round(i.valor / i.qtd) : 0)]), [1, 2, 3]);
}

function renderVolume(grade, lista, de, ate) {
  const { tipo, lista: pers } = periodos(inicioDe(lista, de), ate || hoje());
  const c = cartao(grade, { titulo: "Solicitações recebidas", span: 6, sub: `Quantidade por ${tipo}, todas as situações` });
  const grupos = agrupaPorPeriodo(lista, pers, () => 1).map((g) => ({ ...g, partes: { todas: g.total } }));
  colunas(c.corpo, grupos, { series: [{ id: "todas", nome: "solicitações", cor: COR_UNICA }], fmtEixo: fmtInt, fmtValor: fmtInt });
  c.tabela(["Período", "Solicitações"], grupos.filter((g) => g.total).map((g) => [g.titulo, fmtInt(g.total)]), [1]);
}

function renderPrazos(grade, lista) {
  const c = cartao(grade, { titulo: "Prazos", sub: "Dias úteis contados da data de envio · feriados não descontados", span: 6 });
  if (!LOGS_OK) return vazio(c.corpo, "Histórico de situações indisponível — não é possível medir prazos.");
  const h = hoje();
  // Prazo do reembolso: pagos em até 5 dias úteis
  const reemb = lista.filter((s) => s.formulario === "reembolso");
  const pagos = reemb.map((s) => ({ s, dia: primeiroLog(s, (l) => l.para === "pago") })).filter((x) => x.dia);
  const noPrazo = pagos.filter((x) => diasUteis(x.s._dia, x.dia) <= PRAZO_REEMBOLSO).length;
  const atrasadosAbertos = reemb.filter((s) => ABERTAS.has(s.status) && diasUteis(s._dia, h) > PRAZO_REEMBOLSO);
  const blocos = [];
  if (pagos.length) {
    blocos.push(medidor(noPrazo / pagos.length,
      `Reembolsos pagos em até ${PRAZO_REEMBOLSO} dias úteis: ${fmtInt(noPrazo)} de ${fmtInt(pagos.length)}`));
  } else {
    blocos.push(el("p", { class: "ac-vazio" }, "Nenhum reembolso pago com histórico registrado neste recorte."));
  }
  if (atrasadosAbertos.length) {
    blocos.push(el("p", { class: "ac-aviso-prazo" }, el("span", { class: "ac-alerta__icone", "aria-hidden": "true" }, "!"),
      `${plural(atrasadosAbertos.length, "reembolso em aberto já passou", "reembolsos em aberto já passaram")} de ${PRAZO_REEMBOLSO} dias úteis.`));
  }
  // Tempo médio até o pagamento, por formulário
  const tempos = FORMS.map((f) => {
    const t = lista.filter((s) => s.formulario === f.id)
      .map((s) => { const d = primeiroLog(s, (l) => l.para === "pago"); return d ? diasUteis(s._dia, d) : null; })
      .filter((x) => x != null);
    return { f, n: t.length, media: t.length ? t.reduce((a, x) => a + x, 0) / t.length : null };
  }).filter((x) => x.n);
  const fmtDias = (v) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${v === 1 ? "dia útil" : "dias úteis"}`;
  const sub = el("div", { class: "ac-prazos-tempo" }, el("h3", {}, "Tempo médio até o pagamento"));
  const box = el("div");
  sub.append(box);
  blocos.push(sub);
  c.corpo.replaceChildren(...blocos);
  barrasRanqueadas(box, tempos.map((t) => ({ nome: t.f.nome, valor: t.media, cor: t.f.cor, extra: `${plural(t.n, "pago", "pagos")}`,
    dica: [{ cor: t.f.cor, valor: fmtDias(t.media), rotulo: "em média" }, { valor: fmtInt(t.n), rotulo: "solicitações pagas com histórico" }] }))
    .sort((a, b) => b.valor - a.valor), fmtDias);
  if (!tempos.length) vazio(box, "Nenhum pagamento com histórico registrado neste recorte.");
  c.tabela(["Formulário", "Pagas com histórico", "Tempo médio até o pagamento"],
    tempos.map((t) => [t.f.nome, fmtInt(t.n), fmtDias(t.media)]), [1, 2]);
}

function renderFila(grade, lista) {
  const abertas = lista.filter((s) => ABERTAS.has(s.status)).sort((a, b) => (a._dia < b._dia ? -1 : a._dia > b._dia ? 1 : 0));
  const c = cartao(grade, { titulo: "Em aberto há mais tempo", sub: `${plural(abertas.length, "solicitação ainda não paga nem rejeitada", "solicitações ainda não pagas nem rejeitadas")} · Dias = dias úteis desde o envio`, span: 6 });
  c.semTabela();
  const h = hoje();
  const linhas = abertas.slice(0, 8).map((s) => [
    el("span", { class: "ac-celula-dupla" }, el("b", {}, s._recibo), el("small", {}, (FORM[s.formulario] || {}).nome || s.formulario)),
    el("span", { class: "ac-celula-dupla ac-celula-dupla--quebra" }, s.nome || "—", el("small", {}, (SIT[s.status] || {}).nome || s.status)),
    fmtBRL(s._cent), fmtInt(diasUteis(s._dia, h))]);
  c.corpo.replaceChildren(abertas.length ? tabela(["Recibo", "Beneficiário", "Valor", "Dias"], linhas, [2, 3])
    : el("p", { class: "ac-vazio ac-vazio--bom" }, "Nenhuma solicitação em aberto neste recorte."));
}

function renderDestinos(grade, validas) {
  const diarias = validas.filter((s) => s.formulario.startsWith("diarias"));
  const noites = diarias.map(pernoites).filter((n) => n != null);
  const totNoites = noites.reduce((a, n) => a + n, 0);
  const centComNoites = diarias.filter((s) => (pernoites(s) || 0) > 0).reduce((a, s) => a + s._cent, 0);
  const c = cartao(grade, { titulo: "Destinos das diárias", span: 4,
    sub: diarias.length ? `${plural(diarias.length, "viagem", "viagens")} · ${plural(totNoites, "pernoite", "pernoites")}` +
      (totNoites ? ` · média de ${fmtBRL(Math.round(centComNoites / totNoites))} por pernoite` : "") : "Viagens das solicitações de diárias" });
  const cont = new Map();
  for (const s of diarias) { const d = cidade((s.dados || {})["Destino (Estado e Município)"]); if (d) cont.set(d, (cont.get(d) || 0) + 1); }
  const itens = topComOutros([...cont.entries()], 7).map(([nome, v]) => ({ nome, valor: v, dica: [{ valor: plural(v, "viagem", "viagens"), rotulo: "" }] }));
  barrasRanqueadas(c.corpo, itens, fmtInt);
  c.tabela(["Destino", "Viagens"], itens.map((i) => [i.nome, fmtInt(i.valor)]), [1]);
}

function renderProjetos(grade, validas) {
  const c = cartao(grade, { titulo: "Valor por projeto", sub: "Só as diárias informam o projeto", span: 4 });
  const m = new Map();
  for (const s of validas) if (s.projeto) m.set(s.projeto, (m.get(s.projeto) || 0) + s._cent);
  const itens = topComOutros([...m.entries()], 7).map(([nome, v]) => ({ nome, valor: v }));
  barrasRanqueadas(c.corpo, itens, fmtBRL);
  c.tabela(["Projeto", "Valor solicitado"], itens.map((i) => [i.nome, fmtBRL(i.valor)]), [1]);
}

function renderCategorias(grade, validas) {
  const c = cartao(grade, { titulo: "Categorias de reembolso", sub: "Um reembolso pode marcar mais de uma categoria", span: 4, id: "c-categorias" });
  const m = new Map();
  for (const s of validas) if (s.formulario === "reembolso") for (const cat of categorias(s)) m.set(cat, (m.get(cat) || 0) + 1);
  const itens = topComOutros([...m.entries()], 7).map(([nome, v]) => ({ nome, valor: v, dica: [{ valor: plural(v, "reembolso", "reembolsos"), rotulo: "" }] }));
  barrasRanqueadas(c.corpo, itens, fmtInt);
  c.tabela(["Categoria", "Reembolsos"], itens.map((i) => [i.nome, fmtInt(i.valor)]), [1]);
}

function renderBeneficiarios(grade, validas) {
  const c = cartao(grade, { titulo: "Maiores beneficiários", sub: "Valor solicitado no recorte, sem as rejeitadas · CPF parcialmente oculto", span: 6 });
  c.semTabela();
  const m = new Map();
  for (const s of validas) {
    const k = s._cpf || "nome:" + String(s.nome || "").toLowerCase();
    const a = m.get(k) || { nome: s.nome || "—", cpf: s._cpf, qtd: 0, cent: 0, dia: "" };
    a.qtd++; a.cent += s._cent;
    if (s._dia > a.dia) { a.dia = s._dia; a.nome = s.nome || a.nome; }
    m.set(k, a);
  }
  const top = [...m.values()].sort((a, b) => b.cent - a.cent).slice(0, 10);
  c.corpo.replaceChildren(tabela(["Beneficiário", "CPF", "Solicitações", "Valor"],
    top.map((b) => [b.nome, mascaraCpf(b.cpf), fmtInt(b.qtd), fmtBRL(b.cent)]), [2, 3]));
}

function renderDuplicidades(grade, validas) {
  // Mesmo CPF, mesmo formulário e mesmo valor, enviados com até 30 dias de diferença
  const grupos = new Map();
  for (const s of validas) {
    if (!s._cpf || !s._cent) continue;
    const k = `${s._cpf}|${s.formulario}|${s._cent}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(s);
  }
  const casos = [];
  for (const l of grupos.values()) {
    if (l.length < 2) continue;
    l.sort((a, b) => (a._dia < b._dia ? -1 : 1));
    let atual = [l[0]];
    for (let i = 1; i < l.length; i++) {
      if (difDias(atual[atual.length - 1]._dia, l[i]._dia) <= 30) atual.push(l[i]);
      else { if (atual.length > 1) casos.push(atual); atual = [l[i]]; }
    }
    if (atual.length > 1) casos.push(atual);
  }
  casos.sort((a, b) => (a[a.length - 1]._dia < b[b.length - 1]._dia ? 1 : -1));
  const c = cartao(grade, { titulo: "Possíveis duplicidades", span: 6,
    sub: "Mesmo CPF, formulário e valor, com até 30 dias de diferença · confira antes de pagar" });
  c.semTabela();
  c.corpo.replaceChildren(casos.length
    ? tabela(["Beneficiário", "Formulário", "Valor", "Recibos", "Enviados em"],
      casos.map((cs) => [cs[0].nome || "—", (FORM[cs[0].formulario] || {}).nome || cs[0].formulario, fmtBRL(cs[0]._cent),
        cs.map((s) => s._recibo).join(", "), cs.map((s) => fmtData(s._dia)).join(", ")]), [2])
    : el("p", { class: "ac-vazio ac-vazio--bom" }, "Nenhuma possível duplicidade neste recorte."));
  const badge = c.card.querySelector("h2");
  if (casos.length) badge.append(el("span", { class: "ac-contador" }, fmtInt(casos.length)));
}

/* ---------- Redesenha os gráficos quando a largura muda ---------- */
let largAnterior = 0, tRedim;
function ligarRedimensionar() {
  if (!window.ResizeObserver) return;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w === largAnterior) return;
    largAnterior = w;
    clearTimeout(tRedim);
    tRedim = setTimeout(() => { if (TODAS.length) render(); }, 120);
  }).observe($("ac-grade"));
}

ligarDicas();
ligarRedimensionar();
init();
