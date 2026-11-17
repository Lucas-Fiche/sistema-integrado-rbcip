/* =============================================================
   Resumo da solicitação
   Cartão ao lado do formulário (abaixo dele, no celular), atualizado
   enquanto a pessoa preenche: beneficiário, detalhes do pedido, valor
   total e quanto falta dos campos obrigatórios.

   Só LÊ o formulário. Não tem campos nem botão de envio próprios: um
   segundo caminho de envio abriria espaço para pedidos duplicados.
   ============================================================= */
(function () {
  "use strict";

  const TITULOS = {
    pagamentos: "Pagamento",
    reembolso: "Reembolso",
    "diarias-colaboradores": "Diárias — Colaboradores",
    "diarias-bolsistas": "Diárias — Bolsistas",
  };

  const DIA = 86400000;
  // "2026-11-18" é data de calendário: lida em UTC para não voltar um dia
  const lerData = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const fmtData = (t) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "UTC" });

  function criarAside(titulo) {
    const aside = document.createElement("aside");
    aside.className = "resumo-sol";
    aside.setAttribute("aria-label", "Resumo da solicitação");
    aside.innerHTML =
      '<div class="rs-cab">' +
      '<span class="rs-eyebrow">Resumo da solicitação</span>' +
      '<h2 class="rs-titulo"></h2>' +
      '<span class="rs-terceiro" hidden>Preenchido para outra pessoa</span>' +
      "</div>" +
      '<div class="rs-progresso">' +
      '<div class="rs-progresso__linha"><span class="rs-progresso__rotulo">Campos obrigatórios</span>' +
      '<span class="rs-progresso__conta"></span></div>' +
      '<div class="rs-barra" role="progressbar" aria-valuemin="0" aria-label="Campos obrigatórios preenchidos"><span></span></div>' +
      "</div>" +
      '<div class="rs-corpo"></div>' +
      '<div class="rs-total"><span>Valor total</span><strong class="rs-valor"></strong></div>' +
      '<p class="rs-detalhe-total" hidden></p>' +
      '<button type="button" class="rs-revisar">Revisar e enviar' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>';
    aside.querySelector(".rs-titulo").textContent = titulo;
    return aside;
  }

  window.ativarResumo = function (config) {
    const form = document.getElementById("form");
    if (!form || form.querySelector(".resumo-sol")) return;
    const id = (config && config.id) || "";
    const ehDiaria = id.startsWith("diarias");
    const aside = criarAside(TITULOS[id] || "Solicitação");
    form.insertBefore(aside, form.querySelector(":scope > .actions"));

    const campo = (nome) => form.querySelector(`[name="${nome}"]`);

    /* ---------- leitura dos valores ---------- */
    const texto = (nome) => {
      const el = campo(nome);
      if (!el) return "";
      if (el.tagName === "SELECT") {
        const op = el.options[el.selectedIndex];
        return el.value && op ? op.text.trim() : "";
      }
      return (el.value || "").trim();
    };
    const categorias = () => [...form.querySelectorAll('[name="categoria"]:checked')].map((c) => {
      if (c.dataset.other === "true") {
        const outro = c.closest(".option")?.querySelector(".other-input");
        return outro && outro.value.trim() ? `Outro: ${outro.value.trim()}` : "Outro";
      }
      return c.value;
    }).join(", ");
    const arquivo = () => {
      const f = form.querySelector('input[type="file"]');
      return f && f.files && f.files[0] ? f.files[0].name : "";
    };
    // Cidade escolhida na lista (diarias.js guarda "UF|Nome") → "Nome/UF"
    const cidade = (nome) => {
      const el = campo(nome);
      if (!el) return "";
      const m = (el.dataset.municipio || "").split("|");
      return m.length === 2 ? `${m[1]}/${m[0]}` : (el.value || "").trim();
    };
    const pernoites = () => {
      const a = lerData(texto("periodo_inicial")), b = lerData(texto("periodo_final"));
      return a != null && b != null && b >= a ? Math.round((b - a) / DIA) : null;
    };
    const periodo = () => {
      const a = lerData(texto("periodo_inicial")), b = lerData(texto("periodo_final"));
      if (a == null && b == null) return "";
      if (a != null && b != null) return `${fmtData(a)} a ${fmtData(b)}`;
      return fmtData(a != null ? a : b);
    };
    const trecho = () => {
      const o = cidade("origem"), d = cidade("destino");
      return o || d ? `${o || "…"} → ${d || "…"}` : "";
    };
    const valorCent = () => {
      const v = texto("valor");
      return /^\d{1,3}(\.\d{3})*,\d{2}$/.test(v) ? parseInt(v.replace(/\D/g, ""), 10) : 0;
    };
    const brl = (cent) => (cent / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    /* ---------- o que aparece, por formulário ---------- */
    const blocos = [{
      titulo: "Beneficiário",
      itens: [
        ["Nome", () => texto("nome")],
        ["CPF", () => texto("cpf")],
        ["Chave PIX", () => texto("chave_pix")],
      ],
    }];
    const pedido = [];
    if (campo("projeto")) pedido.push(["Projeto", () => texto("projeto")]);
    if (id === "pagamentos") {
      pedido.push(["Descrição", () => texto("descricao"), "longo"]);
    } else if (id === "reembolso") {
      pedido.push(["Categoria", categorias]);
      pedido.push(["Descrição", () => texto("descricao"), "longo"]);
      pedido.push(["Comprovante", arquivo]);
    } else if (ehDiaria) {
      pedido.push(["Cargo/Função", () => texto("cargo")]);
      pedido.push(["Trecho", trecho]);
      pedido.push(["Período", periodo]);
      pedido.push(["Pernoites", () => { const n = pernoites(); return n == null ? "" : String(n); }]);
    }
    blocos.push({ titulo: "Solicitação", itens: pedido });

    // Monta a estrutura uma vez; depois só troca os textos
    const corpo = aside.querySelector(".rs-corpo");
    const linhas = [];
    for (const b of blocos) {
      const sec = document.createElement("section");
      sec.className = "rs-bloco";
      const h = document.createElement("h3");
      h.textContent = b.titulo;
      const dl = document.createElement("dl");
      for (const [rotulo, ler, tipo] of b.itens) {
        const linha = document.createElement("div");
        linha.className = "rs-item" + (tipo === "longo" ? " rs-item--longo" : "");
        const dt = document.createElement("dt");
        dt.textContent = rotulo;
        const dd = document.createElement("dd");
        linha.append(dt, dd);
        dl.appendChild(linha);
        linhas.push({ dd, ler });
      }
      sec.append(h, dl);
      corpo.appendChild(sec);
    }

    /* ---------- progresso dos obrigatórios ---------- */
    const obrigatorios = () => [...form.querySelectorAll(".field")].filter((f) => {
      const c = f.querySelector("input, textarea, select");
      return c && (f.dataset.required === "true" || c.required);
    });
    const preenchido = (f) => {
      const ctrls = [...f.querySelectorAll("input, textarea, select")];
      const c = ctrls[0];
      if (c.type === "checkbox" || c.type === "radio") return ctrls.some((x) => (x.type === "checkbox" || x.type === "radio") && x.checked);
      if (c.type === "file") return !!(c.files && c.files.length);
      if (f.dataset.validate === "municipio") return !!(c.dataset.municipio || (c.dataset.municipioLivre && c.value.trim()));
      return !!c.value.trim() && !f.classList.contains("invalid");
    };

    const conta = aside.querySelector(".rs-progresso__conta");
    const barra = aside.querySelector(".rs-barra");
    const preenchimento = aside.querySelector(".rs-barra span");
    const rotuloProg = aside.querySelector(".rs-progresso__rotulo");
    const valorEl = aside.querySelector(".rs-valor");
    const detalheTotal = aside.querySelector(".rs-detalhe-total");
    const terceiro = aside.querySelector(".rs-terceiro");

    function atualizar() {
      for (const { dd, ler } of linhas) {
        const v = ler();
        dd.textContent = v || "—";
        dd.classList.toggle("rs-vazio", !v);
      }

      const lista = obrigatorios();
      const feitos = lista.filter(preenchido).length;
      const total = lista.length;
      const completo = total > 0 && feitos === total;
      conta.textContent = `${feitos} de ${total}`;
      rotuloProg.textContent = completo ? "Tudo pronto para enviar" : "Campos obrigatórios";
      preenchimento.style.width = total ? `${Math.round((feitos / total) * 100)}%` : "0%";
      barra.setAttribute("aria-valuemax", String(total));
      barra.setAttribute("aria-valuenow", String(feitos));
      aside.classList.toggle("rs-completo", completo);

      const cent = valorCent();
      valorEl.textContent = brl(cent);
      valorEl.classList.toggle("rs-vazio", !cent);

      // Diárias: o valor por pernoite, como na tabela do formulário
      const n = ehDiaria ? pernoites() : null;
      if (cent && n) {
        const exato = cent % n === 0;
        detalheTotal.textContent = `${exato ? "" : "≈ "}${brl(Math.round(cent / n))} por pernoite · ${n} ${n === 1 ? "pernoite" : "pernoites"}`;
        detalheTotal.hidden = false;
      } else {
        detalheTotal.hidden = true;
      }

      const chk = document.getElementById("por-terceiro");
      terceiro.hidden = !(chk && chk.checked);
    }

    // Uma atualização por quadro, por mais rápido que se digite
    let agendado = false;
    const agendar = () => {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => { agendado = false; atualizar(); });
    };
    form.addEventListener("input", agendar);
    form.addEventListener("change", agendar);
    form.addEventListener("focusout", agendar); // validação no blur muda o progresso
    form.addEventListener("reset", () => setTimeout(atualizar, 0));

    // Leva até a barra de envio (o envio continua sendo só o botão do formulário)
    aside.querySelector(".rs-revisar").addEventListener("click", () => {
      const acoes = form.querySelector(":scope > .actions");
      if (!acoes) return;
      acoes.scrollIntoView({ behavior: "smooth", block: "center" });
      const enviar = acoes.querySelector('button[type="submit"]');
      if (enviar) setTimeout(() => enviar.focus({ preventScroll: true }), 450);
    });

    atualizar();
  };
})();
