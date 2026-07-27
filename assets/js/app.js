/* =============================================================
   Máscaras, validação em tempo real e envio dos formulários
   ============================================================= */

const UFS = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);

/* ---------- Máscaras de entrada ---------- */
function maskDigits(el) {
  el.addEventListener("input", () => { el.value = el.value.replace(/\D/g, ""); });
}
function maskAlphaNum(el) {
  el.addEventListener("input", () => { el.value = el.value.replace(/[^A-Za-z0-9]/g, ""); });
}
function maskMoney(el) {
  el.addEventListener("input", () => {
    let v = el.value.replace(/\D/g, "");
    if (!v) { el.value = ""; return; }
    v = (parseInt(v, 10) / 100).toFixed(2);
    el.value = v.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  });
}
// CPF formatado em tempo real: 000.000.000-00
function formatarCpf(entrada) {
  const v = (entrada || "").replace(/\D/g, "").slice(0, 11);
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`;
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`;
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`;
  return v;
}
function maskCpf(el) {
  el.addEventListener("input", () => { el.value = formatarCpf(el.value); });
}

/* ---------- Validação ---------- */
function setError(field, msg) {
  field.classList.add("invalid");
  field.classList.remove("valido");
  const err = field.querySelector(".error");
  if (err && msg) err.textContent = msg;
}
function setValido(field) {
  field.classList.remove("invalid");
  field.classList.add("valido");
}
function clearEstado(field) { field.classList.remove("invalid", "valido"); }

function cpfValido(cpf) {
  cpf = cpf.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let d1 = 11 - (soma % 11); if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  let d2 = 11 - (soma % 11); if (d2 >= 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
}

// Valida UM campo; marca invalid/valido e retorna true/false.
function validarCampo(field, form) {
  const controls = field.querySelectorAll("input, textarea, select");
  if (!controls.length) return true;
  const first = controls[0];
  const type = first.getAttribute("type");
  const tipoCampo = field.dataset.validate;

  // Grupos de checkbox/radio obrigatórios
  if (type === "checkbox" || type === "radio") {
    if (field.dataset.required === "true") {
      const algum = [...controls].some((c) => (c.type === "checkbox" || c.type === "radio") && c.checked);
      if (!algum) { setError(field, "Selecione ao menos uma opção."); return false; }
    }
    clearEstado(field);
    return true;
  }

  const value = (first.value || "").trim();
  if (first.required && !value) { setError(field, "Este campo é obrigatório."); return false; }
  if (!value) { clearEstado(field); return true; } // opcional e vazio

  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    setError(field, "Informe um e-mail válido."); return false;
  }
  if (tipoCampo === "cpf" && !cpfValido(value)) {
    setError(field, "CPF inválido. Verifique os números digitados."); return false;
  }
  if (tipoCampo === "money") {
    if (!/^\d{1,3}(\.\d{3})*,\d{2}$/.test(value)) { setError(field, "Informe um valor válido. Ex.: 1.234,56"); return false; }
    if (Number(value.replace(/\./g, "").replace(",", ".")) <= 0) { setError(field, "O valor deve ser maior que zero."); return false; }
  }
  if (tipoCampo === "orgao-uf") {
    const m = value.match(/^([A-Za-zÀ-ÿ]{2,})\/([A-Za-z]{2})$/);
    if (!m) { setError(field, "Use o formato SSP/DF."); return false; }
    if (!UFS.has(m[2].toUpperCase())) { setError(field, "UF inválida (use a sigla do estado, ex.: DF, SP, MG)."); return false; }
  }
  if (first.name === "periodo_final") {
    const ini = form.querySelector('[name="periodo_inicial"]');
    if (ini && ini.value && value < ini.value) {
      setError(field, "A data final não pode ser anterior à data inicial."); return false;
    }
  }
  setValido(field);
  return true;
}

function validarFormulario(form) {
  let primeiroErro = null;
  form.querySelectorAll(".field").forEach((field) => {
    if (!validarCampo(field, form) && !primeiroErro) primeiroErro = field;
  });
  if (primeiroErro) primeiroErro.scrollIntoView({ behavior: "smooth", block: "center" });
  return !primeiroErro;
}

/* ---------- Coleta ---------- */
function coletarDados(form) {
  const dados = {};
  form.querySelectorAll(".field").forEach((field) => {
    const label = field.dataset.label ||
      (field.querySelector("label")?.textContent || "").replace("*", "").trim();
    const controls = field.querySelectorAll("input, textarea, select");
    if (!controls.length) return;
    const type = controls[0].getAttribute("type");

    if (type === "checkbox") {
      const marcados = [...controls]
        .filter((c) => c.type === "checkbox" && c.checked)
        .map((c) => {
          if (c.dataset.other === "true") {
            const outro = field.querySelector(".other-input");
            return outro && outro.value.trim() ? "Outro: " + outro.value.trim() : "Outro";
          }
          return c.value;
        });
      if (marcados.length) dados[label] = marcados;
    } else if (type === "radio") {
      const sel = [...controls].find((c) => c.checked);
      if (sel) dados[label] = sel.value;
    } else if (type === "file") {
      if (controls[0].files.length) dados[label] = controls[0].files[0].name;
    } else {
      const v = (controls[0].value || "").trim();
      if (v) dados[label] = v;
    }
  });
  return dados;
}

function ativarFormulario(config) {
  const form = document.getElementById("form");
  if (!form) return;

  // Honeypot anti-spam: campo escondido que só robôs preenchem, + tempo mínimo
  const honeypot = document.createElement("input");
  honeypot.type = "text";
  honeypot.name = "website";
  honeypot.tabIndex = -1;
  honeypot.autocomplete = "off";
  honeypot.setAttribute("aria-hidden", "true");
  honeypot.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
  form.appendChild(honeypot);
  const carregadoEm = Date.now();

  // Máscaras
  form.querySelectorAll("[data-mask='digits']").forEach(maskDigits);
  form.querySelectorAll("[data-mask='alnum']").forEach(maskAlphaNum);
  form.querySelectorAll("[data-mask='money']").forEach(maskMoney);
  form.querySelectorAll("[data-mask='cpf']").forEach(maskCpf);

  // Campos "Outro:" — habilita a caixa de texto ao marcar
  form.querySelectorAll("[data-other='true']").forEach((chk) => {
    const wrap = chk.closest(".field");
    const outro = wrap?.querySelector(".other-input");
    if (outro) {
      const sync = () => { outro.disabled = !chk.checked; if (!chk.checked) outro.value = ""; };
      chk.addEventListener("change", sync);
      sync();
    }
  });

  // Validação em tempo real: valida ao sair do campo; limpa erro ao corrigir
  form.querySelectorAll(".field").forEach((field) => {
    field.querySelectorAll("input, textarea, select").forEach((ctrl) => {
      ctrl.addEventListener("blur", () => validarCampo(field, form));
      const revalida = () => { if (field.classList.contains("invalid")) validarCampo(field, form); };
      ctrl.addEventListener("input", revalida);
      ctrl.addEventListener("change", revalida);
    });
  });
  // Data final revalida quando a inicial muda
  const iniInput = form.querySelector('[name="periodo_inicial"]');
  const fimInput = form.querySelector('[name="periodo_final"]');
  if (iniInput && fimInput) {
    iniInput.addEventListener("change", () => {
      if (fimInput.value) validarCampo(fimInput.closest(".field"), form);
    });
  }

  // Chave Pix = CPF automático (+ aviso se ficarem diferentes)
  const cpfInput = form.querySelector('[name="cpf"]');
  const pixInput = form.querySelector('[name="chave_pix"]');
  if (cpfInput && pixInput) {
    let pixManual = false, sincronizando = false;
    const atualizarAviso = () => {
      const field = pixInput.closest(".field");
      const cpfDig = cpfInput.value.replace(/\D/g, "");
      const pixDig = pixInput.value.replace(/\D/g, "");
      let aviso = field.querySelector(".aviso");
      if (cpfDig && pixDig && cpfDig !== pixDig) {
        if (!aviso) { aviso = document.createElement("p"); aviso.className = "aviso"; field.appendChild(aviso); }
        aviso.textContent = "Atenção: a chave PIX está diferente do CPF. Confirme se há justificativa aprovada.";
      } else if (aviso) { aviso.remove(); }
    };
    pixInput.addEventListener("input", () => { if (!sincronizando) pixManual = true; atualizarAviso(); });
    cpfInput.addEventListener("input", () => {
      if (!pixManual) { sincronizando = true; pixInput.value = cpfInput.value; sincronizando = false; }
      atualizarAviso();
    });
  }

  // Prévia + validação do comprovante (imagem)
  form.querySelectorAll('input[type="file"]').forEach((inp) => {
    const field = inp.closest(".field");
    inp.addEventListener("change", () => {
      const antiga = field.querySelector(".file-preview");
      if (antiga) antiga.remove();
      clearEstado(field);
      const f = inp.files && inp.files[0];
      if (!f) return;
      const ehImagem = f.type.startsWith("image/");
      const ehPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!ehImagem && !ehPdf) {
        setError(field, "Envie uma imagem (JPG ou PNG) ou um arquivo PDF.");
        inp.value = ""; return;
      }
      if (f.size > 8 * 1024 * 1024) { setError(field, "Arquivo muito grande (máx. 8 MB). Reduza e tente novamente."); inp.value = ""; return; }
      const prev = document.createElement("div");
      prev.className = "file-preview";
      const span = document.createElement("span");
      span.textContent = `${f.name} · ${(f.size / 1048576).toFixed(2)} MB`;
      if (ehImagem) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(f);
        img.alt = "Prévia do comprovante";
        prev.append(img, span);
      } else {
        const icone = document.createElement("span");
        icone.className = "file-icone";
        icone.textContent = "📄";
        prev.append(icone, span);
      }
      field.appendChild(prev);
      setValido(field);
    });
  });

  /* ----- Rascunho automático (não perde o preenchimento) ----- */
  const draftKey = "rbcip_draft_" + config.id;
  function restaurarDraft() {
    let d;
    try { d = JSON.parse(localStorage.getItem(draftKey) || "null"); } catch (_) { d = null; }
    if (!d) return;
    Object.entries(d).forEach(([name, val]) => {
      form.querySelectorAll(`[name="${CSS.escape(name)}"]`).forEach((el) => {
        if (el.type === "checkbox" || el.type === "radio") {
          if (Array.isArray(val) && val.includes(el.value || "on")) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); }
        } else { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); }
      });
    });
  }
  let draftTimer;
  function salvarDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const d = {};
      form.querySelectorAll("input, textarea, select").forEach((c) => {
        if (c.type === "file" || !c.name) return;
        if (c.type === "checkbox" || c.type === "radio") {
          if (c.checked) (d[c.name] = d[c.name] || []).push(c.value || "on");
        } else if (c.value) d[c.name] = c.value;
      });
      try { localStorage.setItem(draftKey, JSON.stringify(d)); } catch (_) { /* indisponível */ }
    }, 400);
  }
  form.addEventListener("input", salvarDraft);
  form.addEventListener("change", salvarDraft);
  restaurarDraft();

  /* ----- Persistência / envio ----- */
  function salvarLocal(registro) {
    try {
      const chave = "rbcip_" + config.id;
      const hist = JSON.parse(localStorage.getItem(chave) || "[]");
      hist.push(registro);
      localStorage.setItem(chave, JSON.stringify(hist));
    } catch (_) { /* localStorage indisponível */ }
  }

  function mostrarSucesso(registro) {
    try { localStorage.removeItem(draftKey); } catch (_) { /* ok */ }
    const sucesso = document.getElementById("sucesso");
    if (sucesso) {
      form.style.display = "none";
      // Elementos que não fazem sentido na tela de "Solicitação registrada":
      // o aviso de campo obrigatório e a barra "Voltar aos formulários"
      // (o próprio card de sucesso já tem o botão "Voltar ao início").
      const note = document.querySelector(".required-note");
      if (note) note.style.display = "none";
      const topbar = document.querySelector(".topbar");
      if (topbar) topbar.style.display = "none";
      sucesso.classList.add("show");
      sucesso.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const baixar = document.getElementById("baixar");
    if (baixar) baixar.onclick = () => gerarComprovante(registro);
  }

  // ---- Comprovante legível (para o solicitante imprimir ou salvar em PDF) ----
  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtDataHora(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " às " +
      d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  function protocolo(iso) {
    const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
    return "RBCIP-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function gerarComprovante(registro) {
    const dados = registro.dados || {};
    const logo = new URL("../assets/img/logo.png", location.href).href;
    // Número oficial do recibo (gerado no banco) quando disponível; senão,
    // uma referência baseada na data de envio (modo local / sem banco).
    // Sigla por formulário torna o número único entre formulários (PAG-12/2026).
    const SIGLAS = { pagamentos: "PAG", reembolso: "REE", "diarias-colaboradores": "DC", "diarias-bolsistas": "DB" };
    const temRecibo = registro.recibo && registro.recibo.numero != null;
    const rotuloNum = temRecibo ? "Número do recibo" : "Protocolo";
    const proto = temRecibo
      ? (SIGLAS[config.id] || "REC") + "-" + registro.recibo.numero + "/" + registro.recibo.ano
      : protocolo(registro.enviadoEm);
    const linhas = Object.keys(dados).map((k) => {
      if (k === "website") return "";
      let v = dados[k];
      if (Array.isArray(v)) v = v.join(", ");
      if (v == null || v === "") return "";
      if (/comprovante|anexo|arquivo/i.test(k) && typeof v === "string" && v.indexOf("/") >= 0) {
        v = "Arquivo enviado com sucesso";
      }
      return '<tr><td class="k">' + escHtml(k) + '</td><td class="v">' + escHtml(v) + "</td></tr>";
    }).filter(Boolean).join("");

    const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>Comprovante — " + escHtml(registro.formulario) + "</title><style>" +
      "*{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#1c2b3a;" +
      "font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".folha{max-width:720px;margin:24px auto;background:#fff;border:1px solid #e3e8ee;border-radius:12px;overflow:hidden}" +
      ".topo{background:#17324d;color:#fff;padding:22px 28px;display:flex;align-items:center;gap:16px}" +
      ".topo img{height:52px}.topo .t{flex:1}.topo h1{margin:0;font-size:18px}" +
      ".topo p{margin:3px 0 0;font-size:13px;color:#c19a3e}" +
      ".corpo{padding:24px 28px}.selo{display:inline-block;background:#e8f5ec;color:#1c7a3f;" +
      "font-weight:bold;font-size:13px;padding:6px 12px;border-radius:20px;margin-bottom:18px}" +
      ".meta{display:flex;flex-wrap:wrap;gap:14px 32px;margin-bottom:20px;font-size:13px}" +
      ".meta b{display:block;color:#5a6b7b;font-weight:normal;margin-bottom:2px}" +
      ".meta span{font-weight:bold;font-size:14px}" +
      "table{width:100%;border-collapse:collapse}" +
      "td{padding:9px 0;border-bottom:1px solid #eef1f4;font-size:14px;vertical-align:top}" +
      "td.k{color:#5a6b7b;width:42%;padding-right:14px}td.v{font-weight:bold}" +
      ".rodape{padding:16px 28px;background:#fafbfc;border-top:1px solid #e3e8ee;font-size:12px;color:#8a97a4}" +
      ".acoes{max-width:720px;margin:0 auto 40px;display:flex;gap:10px;justify-content:center}" +
      ".acoes button{font:inherit;font-weight:bold;padding:11px 20px;border-radius:8px;border:none;cursor:pointer}" +
      ".b1{background:#17324d;color:#fff}.b2{background:#fff;color:#17324d;border:1px solid #cdd6df}" +
      "@media print{body{background:#fff}.folha{border:none;margin:0;max-width:none}.no-print{display:none}}" +
      "</style></head><body>" +
      '<div class="folha"><div class="topo">' +
      '<img src="' + logo + '" alt="RBCIP" onerror="this.style.display=\'none\'">' +
      '<div class="t"><h1>Comprovante de Solicitação</h1><p>' + escHtml(registro.formulario) + "</p></div></div>" +
      '<div class="corpo"><span class="selo">✓ Solicitação registrada</span>' +
      '<div class="meta"><div><b>' + rotuloNum + "</b><span>" + escHtml(proto) + "</span></div>" +
      "<div><b>Data de envio</b><span>" + escHtml(fmtDataHora(registro.enviadoEm)) + "</span></div></div>" +
      "<table>" + linhas + "</table></div>" +
      '<div class="rodape">Este comprovante confirma o registro da sua solicitação no Sistema de Solicitações - RBCIP. ' +
      "Guarde o número de protocolo para eventuais consultas.</div></div>" +
      '<div class="acoes no-print"><button class="b1" onclick="window.print()">Imprimir / Salvar em PDF</button>' +
      '<button class="b2" onclick="window.close()">Fechar</button></div>' +
      "</body></html>";

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); return; }
    // Bloqueador de pop-up: baixa o comprovante como arquivo abrível no navegador
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comprovante-" + config.id + "-" + proto.replace(/\//g, "-") + ".html";
    a.click();
    URL.revokeObjectURL(url);
  }

  function mostrarErro(msg, detalhe) {
    let box = document.getElementById("erro-envio");
    if (!box) {
      box = document.createElement("div");
      box.id = "erro-envio";
      box.className = "callout callout-error";
      form.parentNode.insertBefore(box, form);
    }
    box.innerHTML =
      '<span class="i">⚠️</span><span>' + msg +
      (detalhe ? '<br><small style="opacity:.85">Detalhe técnico: ' + detalhe + "</small>" : "") +
      "</span>";
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---- Preenchimento para outra pessoa (ex.: secretaria por um prestador) ----
  const chkTerceiro = document.getElementById("por-terceiro");
  const boxQuem = document.getElementById("quem-preenche");
  const qpLogado = document.getElementById("qp-logado");
  const qpCampos = document.getElementById("qp-campos");

  async function configurarTerceiro() {
    if (!chkTerceiro || !boxQuem) return;
    chkTerceiro.addEventListener("change", async () => {
      boxQuem.hidden = !chkTerceiro.checked;
      if (!chkTerceiro.checked) {
        // Voltou a preencher para si: restaura os próprios dados
        if (typeof rbcipAutofill === "function") await rbcipAutofill(form);
        return;
      }
      // Limpa a Seção 1 para receber os dados do terceiro
      ["nome", "email", "cpf", "rg", "orgao_uf", "chave_pix"].forEach((n) => {
        const el = form.querySelector(`[name="${n}"]`);
        if (el && el.tagName !== "SELECT") {
          el.value = "";
          clearEstado(el.closest(".field") || el);
        }
      });
      // Quem está preenchendo: com login usamos a conta (não dá para forjar);
      // sem login (Pagamento é público), a pessoa se identifica.
      let eu = null;
      if (window.rbcipAuth && window.rbcipAuth.meusDados) {
        try { eu = await window.rbcipAuth.meusDados(); } catch (_) { eu = null; }
      }
      if (eu && (eu.nome || eu.email)) {
        // Logado: os dados vêm da conta (não precisa digitar nem dá para forjar)
        qpLogado.innerHTML = "Preenchido por <b>" + escHtml(eu.nome || "—") + "</b>" +
          (eu.email ? " · " + escHtml(eu.email) : "") +
          "<br /><small>Registrado automaticamente pela sua conta.</small>";
        qpLogado.hidden = false;
        qpCampos.hidden = true;
      } else {
        qpLogado.hidden = true;
        qpCampos.hidden = false;
      }
    });
  }
  configurarTerceiro();

  // Dados de autoria enviados ao banco (o vínculo com a conta é resolvido
  // no servidor; aqui só vai o que a pessoa declarou quando não há login).
  function dadosTerceiro() {
    if (!chkTerceiro || !chkTerceiro.checked) return { por_terceiro: false };
    const nome = document.getElementById("qp-nome");
    const email = document.getElementById("qp-email");
    return {
      por_terceiro: true,
      preenchido_por_nome: nome && !qpCampos.hidden ? nome.value.trim() : "",
      preenchido_por_email: email && !qpCampos.hidden ? email.value.trim() : "",
    };
  }

  // Quando não há login, exigir a identificação de quem preencheu
  function validarTerceiro() {
    const erro = document.getElementById("qp-erro");
    if (!chkTerceiro || !chkTerceiro.checked || !qpCampos || qpCampos.hidden) return true;
    const d = dadosTerceiro();
    if (!d.preenchido_por_nome || !d.preenchido_por_email) {
      if (erro) erro.textContent = "Informe seu nome e e-mail para identificar quem preencheu.";
      boxQuem.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.preenchido_por_email)) {
      if (erro) erro.textContent = "Informe um e-mail válido.";
      return false;
    }
    if (erro) erro.textContent = "";
    return true;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erroAntigo = document.getElementById("erro-envio");
    if (erroAntigo) erroAntigo.remove();
    if (!validarFormulario(form)) return;
    if (!validarTerceiro()) return;

    const dados = coletarDados(form);
    const registro = { formulario: config.titulo, formId: config.id, enviadoEm: new Date().toISOString(), dados };

    // Anti-spam: honeypot preenchido -> finge sucesso sem enviar (não alerta o bot)
    if (honeypot.value) { mostrarSucesso(registro); return; }
    // Envio rápido demais -> provável robô; pede para tentar de novo
    if (Date.now() - carregadoEm < 1500) {
      mostrarErro("Por segurança, aguarde um instante e envie novamente.");
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const textoBtn = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }

    try {
      if (window.rbcipReady) await window.rbcipReady;
      if (window.rbcipDB && window.rbcipDB.configurado) {
        if (window.rbcipDB.uploadArquivo) {
          for (const inp of form.querySelectorAll('input[type="file"]')) {
            if (inp.files && inp.files[0]) {
              const campo = inp.closest(".field");
              const label = (campo && campo.dataset.label) || "Anexo";
              try { dados[label] = await window.rbcipDB.uploadArquivo(inp.files[0]); }
              catch (e) { console.error("upload do anexo falhou:", e); }
            }
          }
        }
        const res = await window.rbcipDB.salvarSubmissao({
          formulario: config.id, dados, ...dadosTerceiro(),
        });
        if (res && res.reciboNumero != null) registro.recibo = { numero: res.reciboNumero, ano: res.reciboAno };
        salvarLocal(registro);
      } else {
        salvarLocal(registro);
      }
      mostrarSucesso(registro);
    } catch (err) {
      console.error(err);
      const e = err || {};
      const detalhe = [e.message, e.details, e.hint, e.code].filter(Boolean).join(" · ");
      mostrarErro(
        "Não foi possível enviar sua solicitação agora. Verifique sua conexão e tente novamente. " +
        "Se o problema persistir, entre em contato com o suporte.",
        detalhe
      );
      if (btn) { btn.disabled = false; btn.textContent = textoBtn; }
    }
  });

  if (config.requerLogin && typeof rbcipProteger === "function") {
    rbcipProteger(form, config);
  }
}
