/* =============================================================
   Cliente Supabase compartilhado
   -------------------------------------------------------------
   Cria uma única instância do cliente (com sessão persistente) e
   a expõe em window.rbcipSupabase. window.rbcipReady é uma Promise
   que resolve com o cliente (ou null se não configurado).
   ============================================================= */

window.rbcipSupabase = null;
window.rbcipDB = { configurado: false };

window.rbcipReady = (async () => {
  const cfg = window.RBCIP_CONFIG || {};
  const url = cfg.SUPABASE_URL || "";
  const key = cfg.SUPABASE_ANON_KEY || "";

  // Ainda com placeholders? Não conecta (mantém modo local).
  if (!url || !key || url.includes("SUA_") || key.includes("SUA_")) return null;

  let createClient;
  try {
    ({ createClient } = await import("https://esm.sh/@supabase/supabase-js@2"));
  } catch (err) {
    console.error("Não foi possível carregar o cliente Supabase:", err);
    return null;
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "rbcip-auth",
    },
  });
  window.rbcipSupabase = supabase;

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
    const bruto = dados["Valor"] || dados["Valor Total do Reembolso"] || null;
    if (!bruto) return null;
    const n = Number(String(bruto).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  window.rbcipDB = {
    configurado: true,
    // Sobe um arquivo (ex.: comprovante) ao Storage e devolve o caminho
    async uploadArquivo(file) {
      const nome = Date.now() + "-" + file.name.replace(/[^\w.\-]/g, "_");
      const { data, error } = await supabase.storage
        .from("comprovantes")
        .upload(nome, file, { upsert: false });
      if (error) throw error;
      return data.path;
    },
    async salvarSubmissao({ formulario, dados, por_terceiro, preenchido_por_nome, preenchido_por_email }) {
      const pessoa = extrairPessoa(dados);
      const registro = {
        formulario,
        cpf: pessoa.cpf,
        nome: pessoa.nome,
        email: pessoa.email,
        projeto: dados["Projeto de Referência"] || null,
        valor: parseValor(dados),
        dados,
        // Autoria do preenchimento: o vínculo com a conta é resolvido no
        // servidor (auth.uid()); daqui só vai o declarado quando não há login.
        por_terceiro: !!por_terceiro,
        preenchido_por_nome: preenchido_por_nome || null,
        preenchido_por_email: preenchido_por_email || null,
      };
      // Via função SECURITY DEFINER: insere e DEVOLVE o número do recibo
      // (o RLS não permite ler a tabela submissoes de volta num insert comum).
      const { data, error } = await supabase.rpc("fn_registrar_submissao", { p_registro: registro });
      if (error) throw error;
      const linha = Array.isArray(data) ? data[0] : data;
      return linha
        ? { id: linha.id, reciboNumero: linha.recibo_numero, reciboAno: linha.recibo_ano }
        : null;
    },
  };

  return supabase;
})();
