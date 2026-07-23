// =====================================================================
//  Edge Function: gerar-recibo
//  Chamada pela trigger trg_enviar_recibo (pg_net) a cada submissão.
//  Gera o PDF do recibo (fiel ao texto dos modelos) e envia por e-mail
//  ao financeiro, com o PDF anexado. Para Reembolso, embute a imagem do
//  comprovante (Storage) na página 2.
//
//  Secrets necessários:
//    GMAIL_USER, GMAIL_APP_PASSWORD  -> envio (SMTP Gmail/Workspace)
//    RECIBO_DESTINATARIOS            -> e-mails do financeiro (separados por vírgula)
//    RECIBO_TOKEN                    -> deve bater com app_config.recibo_token
//  (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados)
//
//  Publique com "Verify JWT" DESLIGADO.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

/* ---------------- Valor por extenso ---------------- */
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

/* ---------------- Utilidades ---------------- */
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function dataExtenso(d = new Date()): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
function fmtReais(v: number): string {
  return "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const val = (d: Record<string, unknown>, k: string) => {
  const x = d[k];
  if (Array.isArray(x)) return x.join(", ");
  return x == null || x === "" ? "—" : String(x);
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Base64 em blocos (evita estouro de pilha com PDFs grandes)
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/* ---------------- Construção do PDF ---------------- */
const ENDERECO = "Rede Brasileira de Certificação, Pesquisa e Inovação — SBN Qd. 2, Bl. F, Lt. 12, Sala 604, Ed. Via Capital, Brasília/DF · contato@rbcip.org · www.rbcip.org";
const A4: [number, number] = [595.28, 841.89];
const MARG = 56;

async function novoPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const largura = A4[0] - MARG * 2;

  const ctx = {
    doc, font, bold, largura,
    page: doc.addPage(A4),
    y: A4[1] - MARG,
    quebra(alturaNecessaria = 40) {
      if (this.y < MARG + alturaNecessaria) { this.page = doc.addPage(A4); this.y = A4[1] - MARG; }
    },
    linha(texto: string, o: { size?: number; bold?: boolean; gap?: number; cor?: [number, number, number]; centro?: boolean } = {}) {
      const size = o.size ?? 11;
      const f = o.bold ? bold : font;
      const cor = o.cor ? rgb(...o.cor) : rgb(0.1, 0.1, 0.1);
      const palavras = texto.split(/\s+/);
      let atual = "";
      const linhas: string[] = [];
      for (const w of palavras) {
        const teste = atual ? atual + " " + w : w;
        if (f.widthOfTextAtSize(teste, size) > largura && atual) { linhas.push(atual); atual = w; }
        else atual = teste;
      }
      if (atual) linhas.push(atual);
      for (const ln of linhas) {
        this.quebra(size + 6);
        const x = o.centro ? MARG + (largura - f.widthOfTextAtSize(ln, size)) / 2 : MARG;
        this.page.drawText(ln, { x, y: this.y, size, font: f, color: cor });
        this.y -= size + 4;
      }
      this.y -= o.gap ?? 6;
    },
    espaco(h: number) { this.y -= h; },
    regua() {
      this.quebra(20);
      this.page.drawLine({ start: { x: MARG, y: this.y }, end: { x: A4[0] - MARG, y: this.y }, thickness: 0.7, color: rgb(0.8, 0.8, 0.8) });
      this.y -= 12;
    },
  };
  return ctx;
}

function cabecalho(p: Awaited<ReturnType<typeof novoPdf>>, titulo: string, numero: string) {
  p.linha("REDE BRASILEIRA DE CERTIFICAÇÃO, PESQUISA E INOVAÇÃO", { size: 12, bold: true, centro: true, gap: 2 });
  p.linha("Diretoria Executiva", { size: 10, centro: true, cor: [0.4, 0.4, 0.4], gap: 10 });
  p.linha(titulo + "  " + numero, { size: 14, bold: true, centro: true, gap: 6, cor: [0.12, 0.37, 0.55] });
  p.regua();
}

function rodape(p: Awaited<ReturnType<typeof novoPdf>>) {
  p.espaco(14);
  p.regua();
  p.linha(ENDERECO, { size: 8, cor: [0.45, 0.45, 0.45], gap: 0 });
}

function secao(p: Awaited<ReturnType<typeof novoPdf>>, t: string) {
  p.espaco(4);
  p.linha(t, { size: 11, bold: true, gap: 4, cor: [0.12, 0.37, 0.55] });
}

// Monta o conteúdo específico de cada formulário
function construir(p: Awaited<ReturnType<typeof novoPdf>>, sub: any) {
  const d = sub.dados || {};
  const numero = `Nº ${sub.recibo_numero ?? "—"}/${sub.recibo_ano ?? new Date().getFullYear()}`;
  const valor = Number(sub.valor || 0);
  const extenso = valorExtenso(valor);
  const nome = sub.nome || val(d, "Nome Completo");
  const cpf = sub.cpf || val(d, "CPF");

  if (sub.formulario === "pagamentos") {
    cabecalho(p, "RECIBO DE PAGAMENTO", numero);
    secao(p, "1. Informações do Beneficiário");
    p.linha(`Nome Completo: ${nome}`);
    p.linha(`CPF: ${cpf}`);
    p.linha(`Chave PIX: ${val(d, "Chave Pix (CPF)")}`, { gap: 8 });
    secao(p, "2. Detalhes do Serviço");
    p.linha(`Eu, ${nome}, portador do CPF nº ${cpf}, recebi da Rede Brasileira de Certificação, Pesquisa e Inovação (RBCIP), CNPJ nº 35.847.316/0001-06, a importância de ${fmtReais(valor)} (${extenso}) referente a ${val(d, "Descrição Sumária das Atividades")}.`, { gap: 10 });
    p.linha(`Por ser verdade, firmo o presente.`, { gap: 16 });
    p.linha(`Brasília, ${dataExtenso()}.`, { gap: 26 });
    p.linha(`_______________________________________`, { gap: 2 });
    p.linha(nome, { bold: true });
  } else if (sub.formulario === "reembolso") {
    cabecalho(p, "RECIBO DE REEMBOLSO", numero);
    secao(p, "Beneficiário");
    p.linha(`Nome Completo: ${nome}`);
    p.linha(`RG: ${val(d, "RG")}  —  Órgão Emissor/UF: ${val(d, "Órgão Emissor / UF")}`);
    p.linha(`CPF: ${cpf}  —  Chave PIX: ${val(d, "Chave Pix (CPF)")}`, { gap: 8 });
    secao(p, "Declaração");
    p.linha(`Eu, ${nome}, portador do RG nº ${val(d, "RG")} ${val(d, "Órgão Emissor / UF")}, e CPF nº ${cpf}, declaro ter recebido nesta data a quantia de ${fmtReais(valor)} (${extenso}) da REDE BRASILEIRA DE CERTIFICAÇÃO, PESQUISA E INOVAÇÃO, CNPJ nº 35.847.316/0001-06, referente à ${val(d, "Descrição do Pagamento")}.`, { gap: 8 });
    p.linha(`Categoria da despesa: ${val(d, "Categoria da Despesa")}.`, { gap: 8 });
    p.linha(`Conforme a Portaria nº 1-25, os pagamentos referentes a este recibo serão realizados exclusivamente via PIX, utilizando obrigatoriamente chave CPF vinculada ao beneficiário (${val(d, "Chave Pix (CPF)")}), salvo justificativa apresentada e aprovada previamente.`, { gap: 8 });
    p.linha(`Declaro, ainda, que não se trata de remuneração, mas sim de reembolso de valores pagos no desempenho das atividades relacionadas à RBCIP, em caráter eventual e sem vínculo empregatício.`, { gap: 8 });
    p.linha(`Informativo de Pagamento: o prazo para o recebimento do valor descrito acima é de até 5 (cinco) dias úteis a contar da data de emissão deste recibo.`, { gap: 12 });
    p.linha(`E para maior clareza, firmo o presente.`, { gap: 12 });
    p.linha(`Brasília, ${dataExtenso()}.`, { gap: 26 });
    p.linha(`_______________________________________`, { gap: 2 });
    p.linha(nome, { bold: true });
    rodape(p);
    return; // imagem do comprovante é adicionada fora (página 2)
  } else {
    const tipo = sub.formulario === "diarias-bolsistas" ? "Bolsista" : "Colaborador";
    cabecalho(p, "RECIBO DE DIÁRIA", numero + " - " + tipo);
    secao(p, "1. Informações do Beneficiário");
    p.linha(`Nome Completo: ${nome}`);
    p.linha(`CPF: ${cpf}  —  Cargo/Função: ${val(d, "Cargo/Função")}`);
    p.linha(`E-mail: ${val(d, "Email")}`);
    p.linha(`Projeto: ${val(d, "Projeto de Referência")}`, { gap: 8 });
    secao(p, "2. Detalhes do Deslocamento");
    p.linha(`Período: ${val(d, "Período Inicial")} a ${val(d, "Período Final")}`);
    p.linha(`Origem: ${val(d, "Origem (Estado e Município)")}  —  Destino: ${val(d, "Destino (Estado e Município)")}`);
    p.linha(`Justificativa: ${val(d, "Descrição Sumária das Atividades, Reuniões ou Atividades")}`, { gap: 10 });
    p.linha(`Atesto que recebi da REDE BRASILEIRA DE CERTIFICAÇÃO, PESQUISA E INOVAÇÃO (RBCIP), CNPJ 35.847.316/0001-06, a importância de ${fmtReais(valor)} (${extenso}) em razão do deslocamento mencionado acima.`, { gap: 8 });
    p.linha(`O reembolso foi calculado em conformidade com a Resolução nº 001/2022 da RBCIP. Conforme a Portaria nº 1-25, os pagamentos serão realizados exclusivamente por meio de PIX vinculado ao CPF do beneficiário, salvo justificativa apresentada e aprovada previamente.`, { gap: 16 });
    p.linha(`Brasília, ${dataExtenso()}.`, { gap: 26 });
    p.linha(`_______________________________________`, { gap: 2 });
    p.linha(nome, { bold: true });
  }
  rodape(p);
}

async function anexarComprovante(p: Awaited<ReturnType<typeof novoPdf>>, db: any, caminho: string) {
  try {
    const { data, error } = await db.storage.from("comprovantes").download(caminho);
    if (error || !data) return;
    const bytes = new Uint8Array(await data.arrayBuffer());
    let img;
    try { img = await p.doc.embedJpg(bytes); } catch { img = await p.doc.embedPng(bytes); }
    const pg = p.doc.addPage(A4);
    pg.drawText("Comprovante anexado", { x: MARG, y: A4[1] - MARG, size: 12, font: p.bold, color: rgb(0.12, 0.37, 0.55) });
    const maxW = A4[0] - MARG * 2, maxH = A4[1] - MARG * 2 - 40;
    const esc = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * esc, h = img.height * esc;
    pg.drawImage(img, { x: (A4[0] - w) / 2, y: A4[1] - MARG - 30 - h, width: w, height: h });
  } catch (e) {
    console.error("Falha ao anexar comprovante:", e);
  }
}

/* ---------------- Handler ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { token, record } = await req.json();
    if (token !== Deno.env.get("RECIBO_TOKEN")) return json({ ok: false, erro: "token_invalido" }, 401);
    if (!record || !record.id) return json({ ok: false, erro: "sem_record" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Monta o PDF
    const p = await novoPdf();
    construir(p, record);
    if (record.formulario === "reembolso") {
      const caminho = record.dados?.["Anexar Comprovante/Recibo"];
      if (caminho && !/\s/.test(caminho)) await anexarComprovante(p, db, caminho);
    }
    const pdfBytes = await p.doc.save();
    const b64 = toBase64(pdfBytes);

    // Envia por e-mail
    const destinatarios = (Deno.env.get("RECIBO_DESTINATARIOS") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!destinatarios.length) throw new Error("RECIBO_DESTINATARIOS vazio");

    const nomeArq = `recibo-${record.formulario}-${record.recibo_numero}-${record.recibo_ano}.pdf`;
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: Deno.env.get("GMAIL_USER")!, password: Deno.env.get("GMAIL_APP_PASSWORD")! },
      },
    });
    await client.send({
      from: Deno.env.get("GMAIL_USER")!,
      to: destinatarios,
      subject: `Recibo ${record.recibo_numero}/${record.recibo_ano} — ${record.formulario} — ${record.nome || ""}`,
      content: `Segue em anexo o recibo referente à solicitação de ${record.formulario}.\n\nBeneficiário: ${record.nome || "-"}\nCPF: ${record.cpf || "-"}\nValor: ${fmtReais(Number(record.valor || 0))}\n\nMensagem automática do Sistema Integrado RBCIP.`,
      attachments: [{ filename: nomeArq, content: b64, encoding: "base64", contentType: "application/pdf" }],
    });
    await client.close();

    // Marca como enviado
    await db.from("submissoes").update({ recibo_enviado_em: new Date().toISOString() }).eq("id", record.id);

    return json({ ok: true, numero: `${record.recibo_numero}/${record.recibo_ano}`, destinatarios });
  } catch (err) {
    console.error(err);
    const e = err as { message?: string };
    return json({ ok: false, erro: e?.message || String(err) }, 500);
  }
});
