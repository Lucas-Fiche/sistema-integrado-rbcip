// =====================================================================
//  Edge Function: sync-bolsistas
//  Lê a planilha "Cadastro de Bolsista" (Google Sheets) e faz upsert
//  na tabela `pessoas` (tipo = 'bolsista'), usando o CPF como chave.
//
//  Roda no servidor com a service role — bypassa o RLS para escrever.
//  Autentica no Google via Service Account (JWT -> access token).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------
//  DE-PARA: cabeçalho na planilha  ->  coluna em `pessoas`
//  AJUSTE as chaves à esquerda para baterem EXATAMENTE com os
//  cabeçalhos (linha 1) da planilha "Cadastro de Bolsista".
// ---------------------------------------------------------------------
const MAPEAMENTO: Record<string, string> = {
  "Nome Completo": "nome",
  "E-mail": "email",
  "CPF": "cpf",
  "RG": "rg",
  "Órgão Emissor/UF": "orgao_uf",
  "Chave PIX": "chave_pix",
};

const soDigitos = (s: string) => (s || "").replace(/\D/g, "");

// ----- Autenticação no Google (Service Account) -----
async function importarChave(pem: string): Promise<CryptoKey> {
  const limpa = pem
    .replace(/\\n/g, "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(limpa), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

const base64url = (bytes: Uint8Array | string) => {
  const str = typeof bytes === "string"
    ? bytes
    : String.fromCharCode(...bytes);
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

async function obterTokenGoogle(email: string, chavePem: string): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600,
  }));
  const naoAssinado = `${header}.${claim}`;

  const chave = await importarChave(chavePem);
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    chave,
    new TextEncoder().encode(naoAssinado),
  );
  const jwt = `${naoAssinado}.${base64url(new Uint8Array(assinatura))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error("Falha ao obter token Google: " + await res.text());
  return (await res.json()).access_token;
}

// ----- Handler -----
Deno.serve(async () => {
  try {
    const sheetId = Deno.env.get("SHEET_ID");
    const range = Deno.env.get("SHEET_RANGE") || "A1:Z10000";
    const saEmail = Deno.env.get("GOOGLE_SA_EMAIL");
    const saKey = Deno.env.get("GOOGLE_SA_PRIVATE_KEY");
    if (!sheetId || !saEmail || !saKey) {
      throw new Error("Faltam secrets: SHEET_ID, GOOGLE_SA_EMAIL ou GOOGLE_SA_PRIVATE_KEY.");
    }

    // 1. Lê a planilha
    const token = await obterTokenGoogle(saEmail, saKey);
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error("Google Sheets API: " + await resp.text());

    const { values } = (await resp.json()) as { values?: string[][] };
    if (!values || values.length < 2) {
      return Response.json({ ok: true, processados: 0, mensagem: "Planilha vazia." });
    }

    // 2. Localiza as colunas pelo cabeçalho
    const cabecalhos = values[0].map((h) => (h || "").trim());
    const idx: Record<string, number> = {};
    for (const [titulo, campo] of Object.entries(MAPEAMENTO)) {
      const i = cabecalhos.indexOf(titulo);
      if (i >= 0) idx[campo] = i;
    }
    if (idx["cpf"] === undefined) {
      throw new Error(
        "Coluna de CPF não encontrada. Cabeçalhos lidos: " + cabecalhos.join(", "),
      );
    }

    // 3. Monta as linhas válidas
    const linhas: Record<string, unknown>[] = [];
    for (let r = 1; r < values.length; r++) {
      const linha = values[r];
      const cpf = soDigitos(linha[idx["cpf"]] || "");
      if (cpf.length !== 11) continue; // ignora linhas sem CPF válido
      const pessoa: Record<string, unknown> = {
        cpf,
        tipo: "bolsista",
        origem: "google_sheets",
      };
      for (const campo of ["nome", "email", "rg", "orgao_uf", "chave_pix"]) {
        if (idx[campo] !== undefined) {
          pessoa[campo] = (linha[idx[campo]] || "").trim() || null;
        }
      }
      if (!pessoa["nome"]) continue; // nome é obrigatório
      linhas.push(pessoa);
    }

    // 4. Upsert em `pessoas` (chave: cpf)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error } = await supabase
      .from("pessoas")
      .upsert(linhas, { onConflict: "cpf" });
    if (error) throw error;

    return Response.json({ ok: true, processados: linhas.length });
  } catch (err) {
    console.error(err);
    return Response.json({ ok: false, erro: String(err) }, { status: 500 });
  }
});
