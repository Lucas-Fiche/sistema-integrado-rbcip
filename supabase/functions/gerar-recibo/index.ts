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

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

/* ---------- Acesso ao Supabase por fetch ----------
   O cliente supabase-js é um módulo grande e era carregado e interpretado em
   TODA invocação, consumindo CPU do orçamento de 2s. Aqui só se usavam cinco
   chamadas simples de Storage e REST, então elas viram fetch direto. */
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sbAuth = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

async function sbBaixar(bucket: string, caminho: string): Promise<Uint8Array | null> {
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${caminho}`, { headers: sbAuth });
  if (!r.ok) { console.error("storage download:", r.status, await r.text()); return null; }
  return new Uint8Array(await r.arrayBuffer());
}

async function sbEnviar(bucket: string, caminho: string, bytes: Uint8Array, tipo: string) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${caminho}`, {
    method: "POST",
    headers: { ...sbAuth, "Content-Type": tipo, "x-upsert": "true" },
    body: bytes,
  });
  if (!r.ok) console.error("storage upload:", r.status, await r.text());
}

async function sbUrlAssinada(bucket: string, caminho: string, segundos: number): Promise<string | null> {
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/${bucket}/${caminho}`, {
    method: "POST",
    headers: { ...sbAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: segundos }),
  });
  if (!r.ok) { console.error("signed url:", r.status, await r.text()); return null; }
  const j = await r.json();
  return j?.signedURL ? `${SB_URL}/storage/v1${j.signedURL}` : null;
}

async function sbAtualizar(id: number, campos: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/rest/v1/submissoes?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbAuth, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(campos),
  });
  if (!r.ok) console.error("update submissoes:", r.status, await r.text());
}

// pdf-lib é uma biblioteca grande: só de CARREGAR e interpretar o módulo já se
// gasta CPU, e isso acontecia em TODA invocação, mesmo nas que não usam PDF
// (pagamentos e diárias nunca precisam dela). Import sob demanda.
let _PDFDocument: any = null;
async function carregarPdfLib() {
  if (!_PDFDocument) {
    const m = await import("https://esm.sh/pdf-lib@1.17.1");
    _PDFDocument = m.PDFDocument;
  }
  return _PDFDocument;
}

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
// Observação: NÃO converta o PDF para base64 aqui. Isso já custou o limite de
// CPU da Edge Function ("CPU Time exceeded", status 546): montar uma string de
// vários MB com String.fromCharCode(...) é caro demais. O denomailer aceita os
// bytes direto (encoding: "binary") e faz a codificação internamente.

/* ---------- Tipo e dimensões do comprovante ---------- */
const ehPdfBytes = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50; // "%P"
const ehPngBytes = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50;
const ehJpgBytes = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

/* Lê largura/altura sem decodificar a imagem inteira, para calcular o
   tamanho de inserção no Google Docs mantendo a proporção. */
function dimensoesImagem(b: Uint8Array): { w: number; h: number } | null {
  if (ehPngBytes(b)) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) }; // após o IHDR
  }
  if (ehJpgBytes(b)) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      // marcadores SOF (dimensões), exceto DHT/DAC/RSTn
      const ehSOF = (m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
      const tam = (b[i + 2] << 8) | b[i + 3];
      if (ehSOF) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + tam;
    }
  }
  return null;
}

/* Localiza o índice de um marcador no corpo do documento do Google Docs.
   O marcador entra via replaceAllText, então fica num único textRun. */
function acharIndice(doc: any, marcador: string): number | null {
  const busca = (elems: any[]): number | null => {
    for (const el of elems || []) {
      const p = el.paragraph;
      if (p) {
        for (const e of p.elements || []) {
          const t = e.textRun?.content;
          if (t && t.includes(marcador)) {
            return e.startIndex + t.indexOf(marcador);
          }
        }
      }
      if (el.table) {
        for (const linha of el.table.tableRows || []) {
          for (const c of linha.tableCells || []) {
            const r = busca(c.content);
            if (r != null) return r;
          }
        }
      }
    }
    return null;
  };
  return busca(doc.body?.content);
}

/* ---------- Anexa a imagem do comprovante como página do recibo ----------
   Rede de segurança: usada quando a inserção no modelo não foi possível. */
async function anexarImagemComoPagina(reciboPdf: Uint8Array, img: Uint8Array): Promise<Uint8Array> {
  const PDFDocument = await carregarPdfLib();
  const doc = await PDFDocument.load(reciboPdf);
  const emb = ehPngBytes(img) ? await doc.embedPng(img) : await doc.embedJpg(img);
  const A4_L = 595.28, A4_A = 841.89, margem = 36;
  const pagina = doc.addPage([A4_L, A4_A]);
  const escala = Math.min((A4_L - margem * 2) / emb.width, (A4_A - margem * 2) / emb.height, 1);
  const l = emb.width * escala, a = emb.height * escala;
  pagina.drawImage(emb, { x: (A4_L - l) / 2, y: (A4_A - a) / 2, width: l, height: a });
  return await doc.save(SAVE_RAPIDO);
}

/* useObjectStreams:false pula a compressão em object streams no save() — é a
   etapa mais cara do pdf-lib. O arquivo fica um pouco maior, mas gasta bem
   menos CPU, que é o recurso escasso aqui. */
const SAVE_RAPIDO = { useObjectStreams: false } as const;

/* Acima deste tamanho, unir o PDF custa CPU demais e a função é morta antes de
   enviar. Nesses casos o comprovante vai como anexo separado: um e-mail com
   dois arquivos é melhor do que nenhum e-mail. */
const LIMITE_UNIR_PDF = 1_500_000;

/* ---------- Anexa um comprovante em PDF como páginas do recibo ----------
   Usado só quando o comprovante é PDF (imagens vão dentro do modelo). */
async function anexarPdf(reciboPdf: Uint8Array, anexoPdf: Uint8Array): Promise<Uint8Array> {
  const PDFDocument = await carregarPdfLib();
  const doc = await PDFDocument.load(reciboPdf);
  const anexo = await PDFDocument.load(anexoPdf);
  const paginas = await doc.copyPages(anexo, anexo.getPageIndices());
  paginas.forEach((p) => doc.addPage(p));
  return await doc.save(SAVE_RAPIDO);
}

/* Sigla por formulário: torna o número do recibo único entre formulários */
const SIGLAS: Record<string, string> = {
  pagamentos: "PAG",
  reembolso: "REE",
  "diarias-colaboradores": "DC",
  "diarias-bolsistas": "DB",
};
const codigoRecibo = (rec: any) =>
  (SIGLAS[rec.formulario] || "REC") + "-" + (rec.recibo_numero ?? "") + "/" + (rec.recibo_ano ?? "");

/* Trecho seguro para nome de arquivo: sem acentos, espaços ou símbolos, para
   não quebrar em anexos de e-mail nem em sistemas de arquivos. */
function paraNomeArquivo(s: string, limite = 60): string {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, limite)
    .replace(/-+$/, "");
}

/* Nome do arquivo do recibo: código + nome do beneficiário.
   Ex.: REE-33-2026-Lucas-Fiche-Ungarelli-Borges.pdf */
function nomeArquivoRecibo(rec: any): string {
  const codigo = paraNomeArquivo(codigoRecibo(rec), 24);
  const pessoa = paraNomeArquivo(rec.nome || rec.dados?.["Nome Completo"] || "");
  return "recibo-" + codigo + (pessoa ? "-" + pessoa : "") + ".pdf";
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/* =====================================================================
   Corpo do e-mail (padrão visual RBCIP)

   Regras de e-mail, que não são as da web:
   - Layout em <table>. Flex e grid não existem no Outlook.
   - Estilo inline. <style> no <head> é descartado por vários clientes.
   - Gradiente só como enfeite: o bgcolor sólido é o que realmente aparece
     no Outlook, então a barra continua azul-petróleo mesmo sem ele.
   - A logo é branca sobre fundo escuro e mora no site. Quase todo cliente
     bloqueia imagem remota na primeira abertura, então o fundo da barra
     já é da marca e o alt descreve a logo — bloqueada, o e-mail continua
     com a cara da RBCIP.
   ===================================================================== */

const LOGO_URL = "https://solicitacoes.rbcip.org/assets/img/logo.png";

const ROTULO_FORM: Record<string, string> = {
  pagamentos: "Pagamento",
  reembolso: "Reembolso",
  "diarias-colaboradores": "Diárias — Colaboradores",
  "diarias-bolsistas": "Diárias — Bolsistas",
};

/* Campos de detalhe por formulário, na ordem em que aparecem no e-mail.
   As chaves são os rótulos dos formulários (data-label), que é como o
   registro guarda cada resposta. "__periodo__" é montado à parte: as duas
   datas da diária lidas juntas valem mais que duas linhas soltas. */
const DETALHES_FORM: Record<string, string[]> = {
  pagamentos: ["Projeto de Referência", "Descrição Sumária das Atividades"],
  reembolso: ["Projeto de Referência", "Categoria da Despesa", "Descrição do Pagamento"],
  "diarias-colaboradores": [
    "Projeto de Referência", "Cargo/Função",
    "Origem (Estado e Município)", "Destino (Estado e Município)",
    "__periodo__",
    "Descrição Sumária das Atividades, Reuniões ou Atividades",
  ],
  "diarias-bolsistas": [
    "Projeto de Referência", "Cargo/Função",
    "Origem (Estado e Município)", "Destino (Estado e Município)",
    "__periodo__",
    "Descrição Sumária das Atividades, Reuniões ou Atividades",
  ],
};

const escHtml = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Data em pt-BR.
   "2026-11-18" é uma data de calendário, não um instante: o JS a lê como
   meia-noite UTC e, convertida para Brasília (UTC-3), volta um dia — o
   período da diária aparecia 18→17. Datas puras são formatadas direto,
   sem fuso; só carimbos de tempo completos (criado_em) são convertidos. */
const dataBR = (iso: unknown) => {
  const s = String(iso ?? "").trim();
  if (!s) return "";
  const soData = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};

/* Uma linha rótulo/valor. O valor vai à direita, como no extrato. */
function linhaDetalhe(rotulo: string, valor: string, destaque = false): string {
  if (!valor) return "";
  return `<tr>
    <td style="padding:9px 0;font-size:14px;color:#5c6b78;vertical-align:top;width:42%">${escHtml(rotulo)}</td>
    <td align="right" style="padding:9px 0;font-size:14px;color:#1c2530;vertical-align:top;${
      destaque ? "font-weight:bold;" : ""
    }">${escHtml(valor)}</td>
  </tr>`;
}

function secao(titulo: string, linhas: string): string {
  if (!linhas) return "";
  return `<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:4px 28px 0">
    <h2 style="margin:22px 0 2px;font-size:16px;font-weight:bold;color:#1c2530;letter-spacing:-.2px">${escHtml(titulo)}</h2>
    <table role="presentation" width="100%" style="border-collapse:collapse">${linhas}</table>
  </td></tr>`;
}

function montarEmailHtml(record: any, opts: { anexoSeparado: boolean }): string {
  const dados = record?.dados || {};
  const campo = (k: string) => {
    const v = dados[k];
    return Array.isArray(v) ? v.join(", ") : String(v ?? "").trim();
  };

  const codigo = codigoRecibo(record);
  const rotulo = ROTULO_FORM[record.formulario] || record.formulario;
  const valor = fmtRS(Number(record.valor || 0));
  const data = dataBR(record.criado_em) || dataBR(new Date().toISOString());

  // Beneficiário
  const linhasPessoa =
    linhaDetalhe("Nome", record.nome || campo("Nome Completo"), true) +
    linhaDetalhe("CPF", record.cpf || campo("CPF")) +
    linhaDetalhe("Chave PIX", campo("Chave Pix (CPF)"));

  // Período da diária: duas datas lidas como um intervalo só
  const ini = dataBR(campo("Período Inicial"));
  const fim = dataBR(campo("Período Final"));
  const periodo = ini && fim ? `${ini} a ${fim}` : (ini || fim);

  // Detalhes próprios do formulário
  const linhasForm = (DETALHES_FORM[record.formulario] || [])
    .map((k) => k === "__periodo__"
      ? linhaDetalhe("Período", periodo)
      : linhaDetalhe(k.replace(/, Reuniões ou Atividades$/, ""), campo(k)))
    .join("");

  // Preenchimento por terceiro: quem respondeu não é quem recebe
  const linhasTerceiro = record.por_terceiro
    ? linhaDetalhe("Preenchido por", record.preenchido_por_nome || "—", true) +
      linhaDetalhe("E-mail", record.preenchido_por_email || "")
    : "";

  const notaAnexo = record.formulario !== "reembolso"
    ? "O recibo segue em anexo, em PDF."
    : opts.anexoSeparado
      ? "O recibo segue em anexo, em PDF. O comprovante vai como segundo anexo — é grande demais para ser unido ao recibo."
      : "O recibo segue em anexo, em PDF, já com o comprovante incluído no mesmo arquivo.";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recibo ${escHtml(codigo)}</title></head>
<body style="margin:0;padding:0;background:#eef2f5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Recibo ${escHtml(codigo)} — ${escHtml(rotulo)} — ${escHtml(valor)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#eef2f5">
<tr><td align="center" style="padding:24px 12px">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">

  <!-- Barra de marca -->
  <tr><td bgcolor="#004e6b" align="center" style="background-color:#004e6b;background-image:linear-gradient(90deg,#004e6b 0%,#2f166e 100%);padding:24px;border-radius:12px 12px 0 0">
    <img src="${LOGO_URL}" width="170" height="57" alt="RBCIP" style="display:block;border:0;outline:none;text-decoration:none;height:57px;width:170px;color:#ffffff;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:bold;line-height:57px;letter-spacing:2px">
  </td></tr>

  <!-- Identificação do recibo -->
  <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:28px 28px 0">
    <div style="font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#308ead">${escHtml(rotulo)}</div>
    <h1 style="margin:6px 0 0;font-size:27px;line-height:1.2;font-weight:bold;color:#1c2530;letter-spacing:-.4px">Recibo ${escHtml(codigo)}</h1>
    <p style="margin:6px 0 0;font-size:14px;color:#5c6b78">Solicitação registrada em ${escHtml(data)}.</p>
  </td></tr>

  <!-- Total -->
  <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:22px 28px 0">
    <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid #e3e8ee;border-bottom:1px solid #e3e8ee">
      <tr>
        <td style="padding:18px 0;font-size:21px;font-weight:bold;color:#1c2530">Total</td>
        <td align="right" style="padding:18px 0;font-size:27px;font-weight:bold;color:#004e6b;letter-spacing:-.5px">${escHtml(valor)}</td>
      </tr>
    </table>
  </td></tr>

  ${secao("Beneficiário", linhasPessoa)}
  ${secao("Detalhes da solicitação", linhasForm)}
  ${secao("Preenchimento", linhasTerceiro)}

  <!-- Anexos -->
  <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:24px 28px 28px">
    <table role="presentation" width="100%" style="border-collapse:collapse;background:#f4f8fa;border-left:3px solid #308ead;border-radius:6px">
      <tr><td style="padding:14px 16px;font-size:14px;color:#1c2530;line-height:1.5">📎 ${escHtml(notaAnexo)}</td></tr>
    </table>
  </td></tr>

  <!-- Rodapé -->
  <tr><td bgcolor="#1c2530" style="background:#1c2530;padding:22px 28px;border-radius:0 0 12px 12px">
    <p style="margin:0;font-size:13px;font-weight:bold;color:#ffffff;letter-spacing:.3px">RBCIP — pesquisa e inovação</p>
    <p style="margin:6px 0 0;font-size:12px;color:#9fb0bd;line-height:1.6">
      Mensagem automática do Sistema de Solicitações.<br>
      Acompanhe as solicitações em <a href="https://solicitacoes.rbcip.org/admin/" style="color:#7fc4de;text-decoration:underline">solicitacoes.rbcip.org</a>.
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

/* ---------- Chamadas ao Google com repetição ----------
   As APIs do Google devolvem 500/503 esporádicos e o próprio Google orienta
   repetir com espera progressiva. Sem isso, um "Internal Error" momentâneo
   derrubava a geração inteira do recibo. A espera custa tempo de parede, que
   sobra, e quase nenhuma CPU, que é o recurso escasso aqui. */
async function fetchGoogle(url: string, init: RequestInit, tentativas = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    // Transitórios: vale insistir. Demais erros são definitivos.
    const transitorio = r.status === 408 || r.status === 429 || r.status >= 500;
    if (r.ok || !transitorio || i >= tentativas - 1) return r;
    try { await r.body?.cancel(); } catch (_) { /* ignora */ }
    const espera = 600 * 2 ** i + Math.floor(Math.random() * 300);
    console.log(`Google respondeu ${r.status}; tentativa ${i + 2} em ${espera}ms`);
    await new Promise((s) => setTimeout(s, espera));
  }
}

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
  const res = await fetchGoogle("https://oauth2.googleapis.com/token", {
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
  const numero = codigoRecibo(rec);
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
      "<<Link Imagem Autocrat>>": "(comprovante na última página deste documento)",
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
  // Criado fora do try para que o catch consiga registrar a falha no banco —
  // sem isso, um erro deixava a solicitação sem qualquer indicação do motivo.
  let idAtual: number | null = null;
  // Cronômetro por etapa: sem isso não dá para saber ONDE os 12 segundos são
  // gastos quando a função é morta por WORKER_RESOURCE_LIMIT.
  const t0 = Date.now();
  const marco = (etapa: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s] ${etapa}`);
  try {
    const { token, record } = await req.json();
    if (token !== Deno.env.get("RECIBO_TOKEN")) return json({ ok: false, erro: "token_invalido" }, 401);
    if (!record?.id) return json({ ok: false, erro: "sem_record" }, 400);
    idAtual = record.id;

    const templateId = TEMPLATE_ID(record.formulario);
    if (!templateId) return json({ ok: false, erro: "template_nao_configurado: " + record.formulario }, 400);

    gtoken = await tokenGoogle();
    marco("token Google obtido");
    const folderId = Deno.env.get("DRIVE_FOLDER_ID");

    // 1. Copia o modelo (supportsAllDrives: necessário para Drives Compartilhados)
    const copyResp = await fetchGoogle(`https://www.googleapis.com/drive/v3/files/${templateId}/copy?supportsAllDrives=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gtoken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: nomeArquivoRecibo(record).replace(/\.pdf$/, ""), parents: folderId ? [folderId] : undefined }),
    });
    if (!copyResp.ok) throw new Error("Drive copy: " + await copyResp.text());
    docId = (await copyResp.json()).id;
    marco("modelo copiado no Drive");


    // 2. Reembolso: baixa o comprovante antes, para saber se é imagem ou PDF
    const MARCADOR = "@@COMPROVANTE@@";
    let compBytes: Uint8Array | null = null;
    let compCaminho = "";
    if (record.formulario === "reembolso") {
      const caminho = record.dados?.["Anexar Comprovante/Recibo"];
      if (caminho && !/\s/.test(caminho)) {
        try {
          const bytes = await sbBaixar("comprovantes", caminho);
          if (bytes) { compBytes = bytes; compCaminho = caminho; }
        } catch (e) {
          console.error("download do comprovante falhou:", e);
        }
      }
    }
    const compEhImagem = !!compBytes && !ehPdfBytes(compBytes) &&
      (ehPngBytes(compBytes) || ehJpgBytes(compBytes));
    if (compBytes) marco(`comprovante baixado (${(compBytes.length / 1048576).toFixed(2)} MB, ${compEhImagem ? "imagem" : "PDF"})`);

    // 3. Substitui os campos. Para imagem, o placeholder do modelo recebe um
    //    marcador — a imagem entra ali (página reservada no modelo), evitando
    //    uma página extra em branco.
    const reps = substituicoes(record);
    if (record.formulario === "reembolso") {
      reps["<<Link Imagem Autocrat>>"] = compEhImagem
        ? MARCADOR
        : (compBytes ? "(comprovante nas páginas seguintes)" : "(sem comprovante anexado)");
    }
    const requests = Object.entries(reps).map(([text, replaceText]) => ({
      replaceAllText: { containsText: { text, matchCase: true }, replaceText: replaceText || "—" },
    }));
    const upd = await fetchGoogle(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gtoken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (!upd.ok) throw new Error("Docs batchUpdate: " + await upd.text());
    marco("campos substituídos");

    // 4. Insere a imagem do comprovante no lugar do marcador.
    //    Se falhar (marcador ausente no modelo, Google sem acessar a URL…),
    //    imagemPendente segue true e a imagem é anexada como página no fim —
    //    o comprovante nunca pode se perder por causa do modelo.
    let imagemPendente = compEhImagem && !!compBytes;
    if (compEhImagem && compBytes) {
      try {
        const urlAssinada = await sbUrlAssinada("comprovantes", compCaminho, 600);
        if (!urlAssinada) throw new Error("sem URL assinada");

        const docResp = await fetchGoogle(`https://docs.googleapis.com/v1/documents/${docId}`, {
          headers: { Authorization: `Bearer ${gtoken}` },
        });
        if (!docResp.ok) throw new Error("Docs get: " + await docResp.text());
        const idx = acharIndice(await docResp.json(), MARCADOR);
        if (idx == null) throw new Error("marcador não encontrado no modelo");

        // Encaixa na área útil da página mantendo a proporção
        const MAX_L = 440, MAX_A = 560;
        const dim = dimensoesImagem(compBytes);
        const escala = dim ? Math.min(MAX_L / dim.w, MAX_A / dim.h, 1) : 1;
        const tamanho = dim
          ? {
              width: { magnitude: Math.round(dim.w * escala), unit: "PT" },
              height: { magnitude: Math.round(dim.h * escala), unit: "PT" },
            }
          : { width: { magnitude: MAX_L, unit: "PT" } };

        const ins = await fetchGoogle(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${gtoken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [
              { deleteContentRange: { range: { startIndex: idx, endIndex: idx + MARCADOR.length } } },
              { insertInlineImage: { location: { index: idx }, uri: urlAssinada, objectSize: tamanho } },
            ],
          }),
        });
        if (!ins.ok) throw new Error("insertInlineImage: " + await ins.text());
        imagemPendente = false; // entrou no modelo, não precisa de página extra
        marco("imagem inserida no modelo");
      } catch (e) {
        // Falha ao embutir não impede o envio: cai no anexo em página própria
        console.error("inserir comprovante no documento falhou (usando página extra):", e);
      }
    }

    // 5. Exporta em PDF
    const exp = await fetchGoogle(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=application/pdf`, {
      headers: { Authorization: `Bearer ${gtoken}` },
    });
    if (!exp.ok) throw new Error("Drive export: " + await exp.text());
    let pdfBytes = new Uint8Array(await exp.arrayBuffer());
    marco(`PDF exportado (${(pdfBytes.length / 1048576).toFixed(2)} MB)`);

    // 6. Comprovante em PDF: entra como páginas seguintes do mesmo arquivo.
    //    Acima do limite, unir custa CPU demais (a função é morta antes de
    //    enviar), então segue como anexo separado.
    let anexoSeparado: { nome: string; bytes: Uint8Array } | null = null;
    if (compBytes && !compEhImagem && ehPdfBytes(compBytes)) {
      if (compBytes.length > LIMITE_UNIR_PDF) {
        console.log(`comprovante PDF de ${(compBytes.length / 1048576).toFixed(2)} MB: ` +
          "grande demais para unir, seguindo como anexo separado");
        anexoSeparado = { nome: compCaminho.split("/").pop() || "comprovante.pdf", bytes: compBytes };
      } else {
        try {
          pdfBytes = await anexarPdf(pdfBytes, compBytes);
        } catch (e) {
          console.error("anexar PDF do comprovante falhou, seguindo separado:", e);
          anexoSeparado = { nome: compCaminho.split("/").pop() || "comprovante.pdf", bytes: compBytes };
        }
      }
    }

    // 6b. Rede de segurança: a imagem não entrou no modelo, então vai como
    //     página própria. Melhor uma página extra do que um recibo sem
    //     comprovante.
    if (imagemPendente && compBytes) {
      try {
        pdfBytes = await anexarImagemComoPagina(pdfBytes, compBytes);
      } catch (e) {
        console.error("anexar imagem como página falhou:", e);
      }
    }
    // Guarda o PDF (já com o comprovante) no Storage para o dashboard exibir
    const reciboPath = `${record.id}-${record.recibo_ano}-${record.recibo_numero}.pdf`;
    await sbEnviar("recibos", reciboPath, pdfBytes, "application/pdf");
    marco("PDF salvo no Storage");
    const nomeArq = nomeArquivoRecibo(record);
    // encoding "binary": entrega os bytes ao denomailer sem passar por base64
    // em JS — foi o que estourava o limite de CPU.
    const anexos: Record<string, unknown>[] = [
      { filename: nomeArq, content: pdfBytes, encoding: "binary", contentType: "application/pdf" },
    ];
    if (anexoSeparado) {
      anexos.push({
        filename: anexoSeparado.nome,
        content: anexoSeparado.bytes,
        encoding: "binary",
        contentType: "application/pdf",
      });
    }
    console.log(`PDF pronto: ${(pdfBytes.length / 1048576).toFixed(2)} MB — ${nomeArq}` +
      (anexoSeparado ? ` + comprovante separado de ${(anexoSeparado.bytes.length / 1048576).toFixed(2)} MB` : ""));

    // 5. Envia por e-mail
    const destinatarios = (Deno.env.get("RECIBO_DESTINATARIOS") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!destinatarios.length) throw new Error("RECIBO_DESTINATARIOS vazio");
    marco("conectando ao SMTP");
    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: Deno.env.get("GMAIL_USER")!, password: Deno.env.get("GMAIL_APP_PASSWORD")! } },
    });
    const codigo = codigoRecibo(record);
    const rotuloForm = ROTULO_FORM[record.formulario] || record.formulario;
    const html = montarEmailHtml(record, { anexoSeparado: !!anexoSeparado });
    // Assunto em ASCII puro: acentos/traços longos em cabeçalho (RFC 2047) podem
    // corromper o MIME em alguns clientes (era o caso das Diárias). O texto
    // bonito com acentos fica no corpo HTML, que é codificado corretamente.
    const semAcento = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x00-\x7f]/g, "-");
    await client.send({
      from: Deno.env.get("GMAIL_USER")!,
      to: destinatarios,
      subject: semAcento(`Recibo ${codigo} - ${rotuloForm} - ${record.nome || ""} - ${fmtRS(Number(record.valor || 0))}`),
      content: "auto",
      html,
      attachments: anexos as any,
    });
    await client.close();
    marco("e-mail enviado");

    // 6. Limpa a cópia e marca como enviado
    await fetch(`https://www.googleapis.com/drive/v3/files/${docId}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${gtoken}` } });
    docId = null;
    await sbAtualizar(record.id, {
      recibo_enviado_em: new Date().toISOString(),
      recibo_path: reciboPath,
      recibo_erro: null,
      recibo_erro_em: null,
    });

    return json({ ok: true, numero: codigo, destinatarios });
  } catch (err) {
    console.error(err);
    // best-effort: remove a cópia se algo falhou depois de criá-la
    if (docId && gtoken) {
      try { await fetch(`https://www.googleapis.com/drive/v3/files/${docId}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${gtoken}` } }); } catch (_) { /* ignora */ }
    }
    const e = err as { message?: string };
    const motivo = e?.message || String(err);
    // Registra a falha para o painel mostrar e permitir o reenvio
    if (idAtual != null) {
      try {
        await sbAtualizar(idAtual, {
          recibo_erro: motivo.slice(0, 500),
          recibo_erro_em: new Date().toISOString(),
        });
      } catch (_) { /* não pode mascarar o erro original */ }
    }
    return json({ ok: false, erro: motivo }, 500);
  }
});
