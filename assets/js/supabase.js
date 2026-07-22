/* =============================================================
   Camada de integração com o Supabase
   -------------------------------------------------------------
   Expõe window.rbcipDB. Se as credenciais em config.js não
   estiverem preenchidas, permanece "não configurado" e o app.js
   usa o modo local (localStorage + download).
   ============================================================= */

window.rbcipDB = { configurado: false };

(async () => {
  const cfg = window.RBCIP_CONFIG || {};
  const url = cfg.SUPABASE_URL || "";
  const key = cfg.SUPABASE_ANON_KEY || "";

  // Ainda com placeholders? Não conecta (mantém modo local).
  if (!url || !key || url.includes("SUA_") || key.includes("SUA_")) return;

  let createClient;
  try {
    ({ createClient } = await import("https://esm.sh/@supabase/supabase-js@2"));
  } catch (err) {
    console.error("Não foi possível carregar o cliente Supabase:", err);
    return;
  }

  const supabase = createClient(url, key);

  // ----- helpers de extração -----
  function extrairPessoa(dados) {
    return {
      nome: dados["Nome Completo"] || null,
      email: dados["Email"] || null,
      cpf: (dados["CPF"] || "").replace(/\D/g, "") || null,
    };
  }

  // "1.234,56" -> 1234.56
  function parseValor(dados) {
    const bruto =
      dados["Valor"] || dados["Valor Total do Reembolso"] || null;
    if (!bruto) return null;
    const n = Number(String(bruto).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  window.rbcipDB = {
    configurado: true,

    // Insere a submissão. A trigger no banco cuida do cadastro da pessoa.
    async salvarSubmissao({ formulario, dados }) {
      const pessoa = extrairPessoa(dados);
      const registro = {
        formulario,
        cpf: pessoa.cpf,
        nome: pessoa.nome,
        email: pessoa.email,
        projeto: dados["Projeto de Referência"] || null,
        valor: parseValor(dados),
        dados,
      };
      // Sem .select(): o RLS não permite que o público leia submissões,
      // então não pedimos o registro de volta (evitaríamos um erro no
      // RETURNING). O insert basta para gravar.
      const { error } = await supabase.from("submissoes").insert(registro);
      if (error) throw error;
      return true;
    },
  };
})();
