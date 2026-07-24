/* =============================================================
   Autenticação (login por CPF + código no e-mail) e autofill
   -------------------------------------------------------------
   Fluxo: a pessoa digita o CPF -> a Edge Function 'auth-cpf' acha
   o e-mail e envia um código -> a pessoa digita o código -> a
   função valida e devolve a sessão. O e-mail nunca é exposto ao
   navegador.
   ============================================================= */

const soDigitosCpf = (s) => (s || "").replace(/\D/g, "");

// Extrai o detalhe do erro de uma Edge Function (lê o corpo da resposta)
async function rbcipDetalharErro(error) {
  let detalhe = error?.message || String(error);
  try {
    if (error?.context && typeof error.context.json === "function") {
      const corpo = await error.context.json();
      detalhe += " — " + JSON.stringify(corpo);
    }
  } catch (_) { /* corpo não é JSON */ }
  console.error("auth-cpf erro:", detalhe);
  return new Error(detalhe);
}

window.rbcipAuth = {
  async sessao() {
    const supa = await window.rbcipReady;
    if (!supa) return null;
    const { data } = await supa.auth.getSession();
    return data.session;
  },

  async solicitarCodigo(cpf, extra = {}) {
    const supa = await window.rbcipReady;
    const { data, error } = await supa.functions.invoke("auth-cpf", {
      body: { acao: "solicitar", cpf: soDigitosCpf(cpf), ...extra },
    });
    if (error) throw await rbcipDetalharErro(error);
    return data;
  },

  async verificarCodigo(cpf, codigo) {
    const supa = await window.rbcipReady;
    const { data, error } = await supa.functions.invoke("auth-cpf", {
      body: { acao: "verificar", cpf: soDigitosCpf(cpf), codigo },
    });
    if (error) throw await rbcipDetalharErro(error);
    console.log("verificar -> vinculadas:", data.vinculadas, "| vinculo_erro:", data.vinculo_erro);
    if (data.ok) {
      await supa.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
    }
    return data;
  },

  async meusDados() {
    const supa = await window.rbcipReady;
    if (!supa) return null;
    // IMPORTANTE: filtrar pelo usuário logado. Staff pode ler TODA a tabela
    // pessoas (política de RLS), então sem este filtro a consulta traria a
    // linha de outra pessoa. Busca pelo vínculo (auth_user_id) e, se não
    // achar, pelo e-mail do login.
    const { data: u } = await supa.auth.getUser();
    const user = u && u.user;
    if (!user) return null;
    const cols = "nome,email,cpf,telefone,rg,orgao_uf,chave_pix,is_staff";
    let { data, error } = await supa
      .from("pessoas").select(cols).eq("auth_user_id", user.id).limit(1);
    if (error) console.error("meusDados erro:", error);
    if (data && data[0]) return data[0];
    if (user.email) {
      ({ data, error } = await supa
        .from("pessoas").select(cols).ilike("email", user.email).limit(1));
      if (error) console.error("meusDados erro:", error);
      if (data && data[0]) return data[0];
    }
    return null;
  },

  async sair() {
    const supa = await window.rbcipReady;
    if (supa) await supa.auth.signOut();
    location.reload();
  },
};

/* ---------- Autofill da Seção 1 ---------- */
async function rbcipAutofill(form) {
  const dados = await window.rbcipAuth.meusDados();
  if (!dados) return;
  const campos = ["nome", "email", "cpf", "rg", "orgao_uf", "chave_pix"];
  for (const campo of campos) {
    const el = form.querySelector(`[name="${campo}"]`);
    if (el && dados[campo]) {
      el.value = dados[campo];
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}

/* ---------- Barra do usuário logado ---------- */
async function rbcipBarraUsuario() {
  const dados = await window.rbcipAuth.meusDados();
  const card = document.querySelector(".form-card");
  if (!card) return;
  const barra = document.createElement("div");
  barra.className = "user-bar";
  const nome = dados?.nome || "Colaborador(a)";
  barra.innerHTML =
    `<span>👤 ${nome}</span>` +
    `<button type="button" class="link-sair">Sair</button>`;
  card.insertBefore(barra, card.firstChild);
  barra.querySelector(".link-sair").onclick = () => window.rbcipAuth.sair();
}

/* ---------- Tela de login ---------- */
function rbcipRenderLogin(form, config) {
  const card = document.querySelector(".form-card");
  const painel = document.createElement("div");
  painel.className = "login-panel";
  painel.innerHTML = `
    <div class="login-head">
      <div class="login-icon">🔒</div>
      <h2>Acesso restrito</h2>
      <p>Informe seu CPF para receber um código de acesso por e-mail.</p>
    </div>

    <div class="login-step" data-step="cpf">
      <label>CPF</label>
      <input type="text" id="login-cpf" inputmode="numeric" maxlength="11" placeholder="Somente números" />
      <p class="login-msg" id="login-msg-cpf"></p>
      <button type="button" class="btn btn-primary" id="btn-enviar-codigo">Enviar código</button>
    </div>

    <div class="login-step" data-step="primeiro" hidden>
      <p class="login-info">Não encontramos seu CPF. Se é seu primeiro acesso, informe seu e-mail e nome:</p>
      <label>E-mail</label>
      <input type="email" id="login-email" placeholder="seu@email.com" />
      <label>Nome completo</label>
      <input type="text" id="login-nome" />
      <button type="button" class="btn btn-primary" id="btn-primeiro">Enviar código</button>
    </div>

    <div class="login-step" data-step="codigo" hidden>
      <p class="login-info" id="login-enviado"></p>
      <label>Código recebido</label>
      <input type="text" id="login-codigo" inputmode="numeric" placeholder="Digite o código" />
      <p class="login-msg" id="login-msg-codigo"></p>
      <button type="button" class="btn btn-primary" id="btn-entrar">Entrar</button>
      <button type="button" class="link-voltar" id="btn-voltar">Usar outro CPF</button>
    </div>
  `;
  card.insertBefore(painel, form);

  const $ = (id) => painel.querySelector(id);
  const mostrarPasso = (passo) => {
    painel.querySelectorAll(".login-step").forEach((s) => {
      s.hidden = s.dataset.step !== passo;
    });
  };
  const cpfEl = $("#login-cpf");
  cpfEl.addEventListener("input", () => {
    cpfEl.value = cpfEl.value.replace(/\D/g, "");
  });

  async function enviar(extra) {
    const cpf = cpfEl.value.trim();
    const msg = $("#login-msg-cpf");
    msg.textContent = "";
    if (soDigitosCpf(cpf).length !== 11) {
      msg.textContent = "Digite um CPF válido (11 números).";
      return;
    }
    const btns = painel.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    try {
      const r = await window.rbcipAuth.solicitarCodigo(cpf, extra);
      if (r.ok) {
        $("#login-enviado").textContent =
          "Enviamos um código para " + (r.email_mascarado || "seu e-mail") + ".";
        mostrarPasso("codigo");
      } else if (r.motivo === "cpf_nao_encontrado") {
        mostrarPasso("primeiro");
      } else {
        msg.textContent = "Não foi possível enviar o código. Tente novamente.";
      }
    } catch (e) {
      const txt = (e && e.message ? e.message : "").toLowerCase();
      if (txt.includes("security purposes") || txt.includes("rate") || txt.includes("seconds")) {
        msg.textContent = "Aguarde alguns segundos antes de solicitar um novo código.";
      } else {
        msg.textContent = "Erro ao enviar o código. Tente novamente.";
      }
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  }

  $("#btn-enviar-codigo").onclick = () => enviar();
  $("#btn-primeiro").onclick = () =>
    enviar({
      email: $("#login-email").value.trim(),
      nome: $("#login-nome").value.trim(),
    });
  $("#btn-voltar").onclick = () => {
    $("#login-codigo").value = "";
    mostrarPasso("cpf");
  };

  $("#btn-entrar").onclick = async () => {
    const codigo = $("#login-codigo").value.trim();
    const msg = $("#login-msg-codigo");
    msg.textContent = "";
    if (!codigo) {
      msg.textContent = "Digite o código recebido.";
      return;
    }
    const btns = painel.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    try {
      const r = await window.rbcipAuth.verificarCodigo(cpfEl.value.trim(), codigo);
      if (r.ok) {
        painel.remove();
        form.style.display = "";
        await rbcipBarraUsuario();
        await rbcipAutofill(form);
      } else {
        msg.textContent =
          r.motivo === "codigo_invalido"
            ? "Código inválido ou expirado. Verifique e tente de novo."
            : "Não foi possível entrar. Tente novamente.";
        btns.forEach((b) => (b.disabled = false));
      }
    } catch (_) {
      msg.textContent = "Erro ao validar o código. Tente novamente.";
      btns.forEach((b) => (b.disabled = false));
    }
  };
}

/* ---------- Ponto de entrada: protege o formulário ---------- */
async function rbcipProteger(form, config) {
  const supa = await window.rbcipReady;
  if (!supa) return; // Supabase não configurado: modo local, sem login
  const sessao = await window.rbcipAuth.sessao();
  if (sessao) {
    await rbcipBarraUsuario();
    await rbcipAutofill(form);
  } else {
    form.style.display = "none";
    rbcipRenderLogin(form, config);
  }
}
