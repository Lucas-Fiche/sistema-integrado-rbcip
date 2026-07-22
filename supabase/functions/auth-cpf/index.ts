// =====================================================================
//  Edge Function: auth-cpf
//  Login por CPF com código no e-mail (Email OTP).
//    acao = "solicitar" -> acha o e-mail pelo CPF e envia o código
//    acao = "verificar" -> valida o código e devolve a sessão
//  O e-mail nunca é devolvido ao navegador (apenas mascarado).
//
//  IMPORTANTE: publique esta função com "Verify JWT" DESLIGADO
//  (o usuário ainda não está autenticado ao solicitar/verificar).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const soDigitos = (s: string) => (s || "").replace(/\D/g, "");

function mascararEmail(email: string): string {
  const [u, d] = email.split("@");
  if (!d) return email;
  const visivel = u.slice(0, 2);
  return `${visivel}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { acao, cpf, codigo, email, nome } = await req.json();
    const cpfDig = soDigitos(cpf);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pessoa } = await admin
      .from("pessoas")
      .select("cpf,email,nome")
      .eq("cpf", cpfDig)
      .maybeSingle();

    // ---------- Solicitar código ----------
    if (acao === "solicitar") {
      let emailAlvo = pessoa?.email || null;

      // Primeiro acesso: CPF não cadastrado -> precisa de e-mail + nome
      if (!emailAlvo) {
        if (!email) return json({ ok: false, motivo: "cpf_nao_encontrado" });
        emailAlvo = email;
        await admin.from("pessoas").upsert(
          {
            cpf: cpfDig,
            nome: nome || email,
            email,
            tipo: "nao_bolsista",
            origem: "primeiro_acesso",
          },
          { onConflict: "cpf" },
        );
      }

      const { error } = await admin.auth.signInWithOtp({
        email: emailAlvo,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      return json({ ok: true, email_mascarado: mascararEmail(emailAlvo) });
    }

    // ---------- Verificar código ----------
    if (acao === "verificar") {
      if (!pessoa?.email) return json({ ok: false, motivo: "cpf_nao_encontrado" });

      const { data, error } = await admin.auth.verifyOtp({
        email: pessoa.email,
        token: soDigitos(codigo),
        type: "email",
      });
      if (error || !data.session || !data.user) {
        return json({ ok: false, motivo: "codigo_invalido" });
      }

      // Vincula o usuário autenticado ao registro em pessoas
      await admin
        .from("pessoas")
        .update({ auth_user_id: data.user.id })
        .eq("cpf", cpfDig);

      return json({
        ok: true,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }

    return json({ ok: false, motivo: "acao_invalida" }, 400);
  } catch (err) {
    console.error(err);
    const e = err as { message?: string; code?: string; status?: number; name?: string };
    const detalhe =
      e?.message ||
      e?.code ||
      e?.name ||
      JSON.stringify(err, Object.getOwnPropertyNames(err || {})) ||
      String(err);
    return json({ ok: false, erro: detalhe, code: e?.code, status: e?.status }, 500);
  }
});
