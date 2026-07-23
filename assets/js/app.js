/* =============================================================
   Máscaras, validação e envio dos formulários
   ============================================================= */

/* ---------- Máscaras de entrada ---------- */

// Mantém apenas dígitos (CPF, "APENAS NÚMEROS")
function maskDigits(el) {
  el.addEventListener("input", () => {
    el.value = el.value.replace(/\D/g, "");
  });
}

// Mantém apenas letras e números (RG do formulário de reembolso)
function maskAlphaNum(el) {
  el.addEventListener("input", () => {
    el.value = el.value.replace(/[^A-Za-z0-9]/g, "");
  });
}

// Valor monetário no formato brasileiro (1.234,56)
function maskMoney(el) {
  el.addEventListener("input", () => {
    let v = el.value.replace(/\D/g, "");
    if (!v) { el.value = ""; return; }
    v = (parseInt(v, 10) / 100).toFixed(2);
    v = v.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    el.value = v;
  });
}

/* ---------- Validação ---------- */

function setError(field, msg) {
  field.classList.add("invalid");
  const err = field.querySelector(".error");
  if (err && msg) err.textContent = msg;
}

function clearError(field) {
  field.classList.remove("invalid");
}

// Valida um CPF (11 dígitos + dígitos verificadores)
function cpfValido(cpf) {
  cpf = cpf.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let d1 = 11 - (soma % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  let d2 = 11 - (soma % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
}

// Valida o formulário inteiro; retorna true/false e marca os campos
function validarFormulario(form) {
  let valido = true;
  let primeiroErro = null;

  // Limpa estados anteriores
  form.querySelectorAll(".field").forEach(clearError);

  form.querySelectorAll(".field").forEach((field) => {
    const controls = field.querySelectorAll(
      "input, textarea, select"
    );
    if (!controls.length) return;

    const first = controls[0];
    const type = first.getAttribute("type");
    const tipoCampo = field.dataset.validate;

    // Grupos de checkbox/radio obrigatórios
    if (type === "checkbox" || type === "radio") {
      const required = field.dataset.required === "true";
      if (required) {
        const algum = [...controls].some(
          (c) => (c.type === "checkbox" || c.type === "radio") && c.checked
        );
        if (!algum) {
          setError(field, "Selecione ao menos uma opção.");
          valido = false;
        }
      }
      return;
    }

    const value = (first.value || "").trim();

    // Obrigatório vazio
    if (first.required && !value) {
      setError(field, "Este campo é obrigatório.");
      valido = false;
      if (!primeiroErro) primeiroErro = field;
      return;
    }

    if (!value) return; // opcional e vazio

    // Validações específicas
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(field, "Informe um e-mail válido.");
      valido = false;
    } else if (tipoCampo === "cpf" && !cpfValido(value)) {
      setError(field, "CPF inválido. Verifique os números digitados.");
      valido = false;
    } else if (tipoCampo === "money" && !/^\d{1,3}(\.\d{3})*,\d{2}$/.test(value)) {
      setError(field, "Informe um valor válido. Ex.: 1.234,56");
      valido = false;
    } else if (tipoCampo === "orgao-uf" && !/^[A-Za-zÀ-ÿ]{2,}\/[A-Za-z]{2}$/.test(value)) {
      setError(field, "Use o formato SSP/DF.");
      valido = false;
    }

    if (field.classList.contains("invalid") && !primeiroErro) {
      primeiroErro = field;
    }
  });

  if (primeiroErro) {
    primeiroErro.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return valido;
}

/* ---------- Coleta e envio ---------- */

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
            return outro && outro.value.trim()
              ? "Outro: " + outro.value.trim()
              : "Outro";
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

  // Aplica máscaras
  form.querySelectorAll("[data-mask='digits']").forEach(maskDigits);
  form.querySelectorAll("[data-mask='alnum']").forEach(maskAlphaNum);
  form.querySelectorAll("[data-mask='money']").forEach(maskMoney);

  // Campos "Outro:" — habilita a caixa de texto ao marcar
  form.querySelectorAll("[data-other='true']").forEach((chk) => {
    const wrap = chk.closest(".field");
    const outro = wrap?.querySelector(".other-input");
    if (outro) {
      const sync = () => {
        outro.disabled = !chk.checked;
        if (!chk.checked) outro.value = "";
      };
      chk.addEventListener("change", sync);
      sync();
    }
  });

  // Salva no navegador (fallback / histórico local)
  function salvarLocal(registro) {
    try {
      const chave = "rbcip_" + config.id;
      const hist = JSON.parse(localStorage.getItem(chave) || "[]");
      hist.push(registro);
      localStorage.setItem(chave, JSON.stringify(hist));
    } catch (_) { /* localStorage indisponível */ }
  }

  function mostrarSucesso(registro) {
    const sucesso = document.getElementById("sucesso");
    if (sucesso) {
      form.style.display = "none";
      sucesso.classList.add("show");
      sucesso.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // Botão de download do comprovante em JSON
    const baixar = document.getElementById("baixar");
    if (baixar) {
      baixar.onclick = () => {
        const blob = new Blob([JSON.stringify(registro, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = config.id + "-" + Date.now() + ".json";
        a.click();
        URL.revokeObjectURL(url);
      };
    }
  }

  function mostrarErro(msg) {
    let box = document.getElementById("erro-envio");
    if (!box) {
      box = document.createElement("div");
      box.id = "erro-envio";
      box.className = "callout callout-error";
      form.parentNode.insertBefore(box, form);
    }
    box.innerHTML =
      '<span class="i">⚠️</span><span>' + msg + "</span>";
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erroAntigo = document.getElementById("erro-envio");
    if (erroAntigo) erroAntigo.remove();
    if (!validarFormulario(form)) return;

    const dados = coletarDados(form);
    const registro = {
      formulario: config.titulo,
      formId: config.id,
      enviadoEm: new Date().toISOString(),
      dados,
    };

    const btn = form.querySelector('button[type="submit"]');
    const textoBtn = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }

    try {
      if (window.rbcipReady) await window.rbcipReady; // aguarda o cliente
      if (window.rbcipDB && window.rbcipDB.configurado) {
        // Sobe anexos (ex.: comprovante do Reembolso) ao Storage
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
        // Envia ao Supabase; guarda cópia local como comprovante
        await window.rbcipDB.salvarSubmissao({ formulario: config.id, dados });
        salvarLocal(registro);
      } else {
        // Modo local (Supabase ainda não configurado)
        salvarLocal(registro);
      }
      mostrarSucesso(registro);
    } catch (err) {
      console.error(err);
      mostrarErro(
        "Não foi possível enviar sua solicitação agora. Verifique sua conexão e tente novamente. " +
        "Se o problema persistir, entre em contato com o suporte."
      );
      if (btn) { btn.disabled = false; btn.textContent = textoBtn; }
    }
  });

  // Formulários protegidos: exige login e faz o autofill da Seção 1
  if (config.requerLogin && typeof rbcipProteger === "function") {
    rbcipProteger(form, config);
  }
}
