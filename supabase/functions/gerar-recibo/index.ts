// =====================================================================
//  Edge Function: gerar-recibo  (via Google Docs — PDF idêntico)
//  A cada submissão (trigger), copia o modelo Google Doc, substitui os
//  <<campos>>, exporta em PDF idêntico e envia por e-mail ao financeiro.
//  Para Reembolso, anexa também a imagem do comprovante (Storage).
//
//  Secrets:
//    GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY  (mesmos da sync-bolsistas)
//    DOC_TEMPLATE_PAGAMENTOS, DOC_TEMPLATE_REEMBOLSO,
//    DOC_TEMPLATE_DIARIAS_COLAB, DOC_TEMPLATE_DIARIAS_BOLS  (IDs dos Docs)
//    DRIVE_FOLDER_ID          (pasta de destino dos recibos gerados)
//    GMAIL_USER, GMAIL_APP_PASSWORD, RECIBO_DESTINATARIOS, RECIBO_TOKEN
//
//  Publique com "Verify JWT" DESLIGADO.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

/* ---------- Valor por extenso ---------- */
const UNI = ["zero","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
const DEZ = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
const CEM = ["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
function porNumero(n: number): string {
  if (n < 20) return UNI[n];
  if (n < 100) return DEZ[Math.floor(n / 10)] + (n % 10 ? " e " + UNI[n % 10] : "");
  if (n < 1000) { if (n === 100) return "cem"; return CEM[Math.floor(n / 100)] + (n % 100 ? " e " + porNumero(n % 100) : ""); }
  if (n < 1000000) { const mil = Math.floor(n / 1000), r = n % 1000; let p = mil === 1 ? "mil" : porNumero(mil) + " mil"; if (r) p += (r < 100 || r % 100 === 0 ? " e " : " ") + porNumero(r); return p; }
  const mi = Math.floor(n / 1000000), r = n % 1000000; let p = mi === 1 ? "um milhão" : porNumero(mi) + " milhões"; if (r) p += " " + porNumero(r); return p;
}
function valorExtenso(v: number): string {
  const cent = Math.round((v || 0) * 100);
  const reais = Math.floor(cent / 100), c = cent % 100;
  let s = reais === 0 ? "zero reais" : porNumero(reais) + (reais === 1 ? " real" : " reais");
  if (c > 0) s += " e " + porNumero(c) + (c === 1 ? " centavo" : " centavos");
  return s;
}
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const dataExtenso = (d = new Date()) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
const fmtNumero = (v: number) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRS = (v: number) => "R$ " + fmtNumero(v);
const val = (d: Record<string, unknown>, k: string) => {
  const x = d[k];
  if (Array.isArray(x)) return x.join(", ");
  return x == null || x === "" ? "" : String(x);
};
function toBase64(bytes: Uint8Array): string {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------- Autenticação Google (Service Account) ---------- */
const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function importarChave(pem: string): Promise<CryptoKey> {
  const limpa = pem.replace(/\\n/g, "\n").replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(limpa), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
async function tokenGoogle(): Promise<string> {
  const email = Deno.env.get("GOOGLE_SA_EMAIL")!;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await importarChave(Deno.env.get("GOOGLE_SA_PRIVATE_KEY")!);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error("Token Google: " + await res.text());
  return (await res.json()).access_token;
}

/* ---------- Mapa de substituições por formulário ---------- */
function substituicoes(rec: any): Record<string, string> {
  const d = rec.dados || {};
  const numero = String(rec.recibo_numero ?? "");
  const nome = rec.nome || val(d, "Nome Completo");
  const cpf = rec.cpf || val(d, "CPF");
  const valor = Number(rec.valor || 0);
  const ext = valorExtenso(valor);
  const data = dataExtenso();

  if (rec.formulario === "pagamentos") {
    return {
      "<<Número do Recibo>>": numero,
      "<<Nome>>": nome,
      "<<CPF>>": cpf,
      "<<Descrição Sumária das Atividades>>": val(d, "Descrição Sumária das Atividades"),
      "<<Valor>>": fmtNumero(valor),
      "<<Valor por Extenso>>": ext,
      "<<Chave Pix>>": val(d, "Chave Pix (CPF)"),
      "<<Data>>": data,
      "<<Nome Assinatura>>": nome,
    };
  }
  if (rec.formulario === "reembolso") {
    return {
      "<<N_Recibo>>": numero,
      "<<Nome_Completo>>": nome,
      "<<RG>>": val(d, "RG"),
      "<<Orgao_Emissor>>": val(d, "Órgão Emissor / UF"),
      "<<CPF>>": cpf,
      "<<Valor_Total>>": fmtRS(valor),
      "<<Valor_Extenso>>": ext,
      "<<Descricao_Pagamento>>": val(d, "Descrição do Pagamento"),
      "<<Chave_Pix>>": val(d, "Chave Pix (CPF)"),
      "<<Data_Atual>>": data,
      "<<Nome_Assinatura>>": nome,
      "<<Link Imagem Autocrat>>": "(comprovante anexado ao e-mail)",
    };
  }
  return {
    "<<Número do Recibo>>": numero,
    "<<Nome do Bolsista>>": nome,
    "<<CPF>>": cpf,
    "<<Cargo/Função>>": val(d, "Cargo/Função"),
    "<<Email>>": val(d, "Email"),
    "<<Escolha o Projeto de Referência>>": rec.projeto || val(d, "Projeto de Referência"),
    "<<Período Inicial>>": val(d, "Período Inicial"),
    "<<Período Final>>": val(d, "Período Final"),
    "<<Origem>>": val(d, "Origem (Estado e Município)"),
    "<<Destino>>": val(d, "Destino (Estado e Município)"),
    "<<Descrição Sumária das Atividades, Reunião ou Atividades>>": val(d, "Descrição Sumária das Atividades, Reuniões ou Atividades"),
    "<<Valor>>": fmtRS(valor),
    "<<Nome Assinatura>>": nome,
  };
}

const TEMPLATE_ID = (formulario: string) => ({
  pagamentos: Deno.env.get("DOC_TEMPLATE_PAGAMENTOS"),
  reembolso: Deno.env.get("DOC_TEMPLATE_REEMBOLSO"),
  "diarias-colaboradores": Deno.env.get("DOC_TEMPLATE_DIARIAS_COLAB"),
  "diarias-bolsistas": Deno.env.get("DOC_TEMPLATE_DIARIAS_BOLS"),
}[formulario]);

/* ---------- Handler ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let docId: string | null = null;
  let gtoken = "";
  try {
    const { token, record } = await req.json();
    if (token !== Deno.env.get("RECIBO_TOKEN")) return json({ ok: false, erro: "token_invalido" }, 401);
    if (!record?.id) return json({ ok: false, erro: "sem_record" }, 400);

    const templateId = TEMPLATE_ID(record.formulario);
    if (!templateId) return json({ ok: false, erro: "template_nao_configurado: " + record.formulario }, 400);

    gtoken = await tokenGoogle();
    const folderId = Deno.env.get("DRIVE_FOLDER_ID");

    // 1. Copia o modelo (supportsAllDrives: necessário para Drives Compartilhados)
    const copyResp = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy?supportsAllDrives=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gtoken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `recibo-${record.formulario}-${record.recibo_numero}-${record.recibo_ano}`, parents: folderId ? [folderId] : undefined }),
    });
    if (!copyResp.ok) throw new Error("Drive copy: " + await copyResp.text());
    docId = (await copyResp.json()).id;

    // 2. Substitui os campos
    const reps = substituicoes(record);
    const requests = Object.entries(reps).map(([text, replaceText]) => ({
      replaceAllText: { containsText: { text, matchCase: true }, replaceText: replaceText || "—" },
    }));
    const upd = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gtoken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (!upd.ok) throw new Error("Docs batchUpdate: " + await upd.text());

    // 3. Exporta em PDF
    const exp = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=application/pdf`, {
      headers: { Authorization: `Bearer ${gtoken}` },
    });
    if (!exp.ok) throw new Error("Drive export: " + await exp.text());
    const pdfBytes = new Uint8Array(await exp.arrayBuffer());
    const pdfB64 = toBase64(pdfBytes);

    // 4. Monta anexos (PDF + comprovante do reembolso)
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Guarda o PDF no Storage para o dashboard poder exibir
    const reciboPath = `${record.id}-${record.recibo_ano}-${record.recibo_numero}.pdf`;
    await db.storage.from("recibos").upload(reciboPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    const nomeArq = `recibo-${record.formulario}-${record.recibo_numero}-${record.recibo_ano}.pdf`;
    const anexos: Record<string, unknown>[] = [{ filename: nomeArq, content: pdfB64, encoding: "base64", contentType: "application/pdf" }];
    if (record.formulario === "reembolso") {
      const caminho = record.dados?.["Anexar Comprovante/Recibo"];
      if (caminho && !/\s/.test(caminho)) {
        const { data } = await db.storage.from("comprovantes").download(caminho);
        if (data) anexos.push({ filename: caminho.split("/").pop() || "comprovante", content: toBase64(new Uint8Array(await data.arrayBuffer())), encoding: "base64" });
      }
    }

    // 5. Envia por e-mail
    const destinatarios = (Deno.env.get("RECIBO_DESTINATARIOS") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!destinatarios.length) throw new Error("RECIBO_DESTINATARIOS vazio");
    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: Deno.env.get("GMAIL_USER")!, password: Deno.env.get("GMAIL_APP_PASSWORD")! } },
    });
    const nomeBenef = record.nome || "-";
    const cpfBenef = record.cpf || "-";
    const valorBenef = fmtRS(Number(record.valor || 0));
    const rotuloForm = ({
      pagamentos: "Pagamento",
      reembolso: "Reembolso",
      "diarias-colaboradores": "Diárias — Colaboradores",
      "diarias-bolsistas": "Diárias — Bolsistas",
    } as Record<string, string>)[record.formulario] || record.formulario;
    const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1c2b3a">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#17324d;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:17px;font-weight:bold">Recibo ${esc(String(record.recibo_numero))}/${esc(String(record.recibo_ano))}</div>
      <div style="font-size:13px;color:#c19a3e;margin-top:2px">${esc(rotuloForm)}</div>
    </div>
    <div style="background:#fff;padding:22px;border:1px solid #e3e8ee;border-top:none;border-radius:0 0 10px 10px">
      <p style="margin:0 0 16px">Segue em anexo o recibo em PDF referente à solicitação abaixo.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#5a6b7b;width:130px">Beneficiário</td><td style="padding:6px 0;font-weight:bold">${esc(nomeBenef)}</td></tr>
        <tr><td style="padding:6px 0;color:#5a6b7b">CPF</td><td style="padding:6px 0">${esc(cpfBenef)}</td></tr>
        <tr><td style="padding:6px 0;color:#5a6b7b">Valor</td><td style="padding:6px 0;font-weight:bold">${esc(valorBenef)}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#8a97a4">Mensagem automática do Sistema Integrado RBCIP.</p>
    </div>
  </div>
</body></html>`;
    // Assunto em ASCII puro: acentos/traços longos em cabeçalho (RFC 2047) podem
    // corromper o MIME em alguns clientes (era o caso das Diárias). O texto
    // bonito com acentos fica no corpo HTML, que é codificado corretamente.
    const semAcento = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x00-\x7f]/g, "-");
    await client.send({
      from: Deno.env.get("GMAIL_USER")!,
      to: destinatarios,
      subject: semAcento(`Recibo ${record.recibo_numero}/${record.recibo_ano} - ${rotuloForm} - ${record.nome || ""}`),
      content: "auto",
      html,
      attachments: anexos as any,
    });
    await client.close();

    // 6. Limpa a cópia e marca como enviado
    await fetch(`https://www.googleapis.com/drive/v3/files/${docId}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${gtoken}` } });
    docId = null;
    await db.from("submissoes").update({ recibo_enviado_em: new Date().toISOString(), recibo_path: reciboPath }).eq("id", record.id);

    return json({ ok: true, numero: `${record.recibo_numero}/${record.recibo_ano}`, destinatarios });
  } catch (err) {
    console.error(err);
    // best-effort: remove a cópia se algo falhou depois de criá-la
    if (docId && gtoken) {
      try { await fetch(`https://www.googleapis.com/drive/v3/files/${docId}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${gtoken}` } }); } catch (_) { /* ignora */ }
    }
    const e = err as { message?: string };
    return json({ ok: false, erro: e?.message || String(err) }, 500);
  }
});
