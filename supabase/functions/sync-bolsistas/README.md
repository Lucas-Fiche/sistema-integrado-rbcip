# Fase 2 — Sincronização Google Sheets → `pessoas`

A Edge Function [`index.ts`](./index.ts) lê a planilha **"Cadastro de Bolsista"**
e faz `upsert` na tabela `pessoas` (usando o **CPF** como chave, `tipo = 'bolsista'`).

## 1. Ajustar o de-para das colunas

Abra `index.ts` e edite o objeto `MAPEAMENTO` para que as chaves batam
**exatamente** com os cabeçalhos (linha 1) da planilha. Exemplo:

```ts
const MAPEAMENTO = {
  "Nome Completo":     "nome",
  "E-mail":            "email",
  "CPF":               "cpf",
  "RG":                "rg",
  "Órgão Emissor/UF":  "orgao_uf",
  "Chave PIX":         "chave_pix",
};
```

## 2. Criar a Service Account no Google

1. Acesse <https://console.cloud.google.com> → crie (ou use) um projeto.
2. **APIs & Services → Library** → habilite **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
4. Criada a conta, entre nela → aba **Keys → Add key → JSON**. Baixe o arquivo.
5. Do JSON, você vai usar dois campos: `client_email` e `private_key`.

## 3. Compartilhar a planilha com a Service Account

Na planilha "Cadastro de Bolsista" → **Compartilhar** → adicione o
`client_email` da Service Account (algo como
`sync@projeto.iam.gserviceaccount.com`) com permissão de **Leitor**.

> O `SHEET_ID` é o trecho da URL da planilha:
> `https://docs.google.com/spreadsheets/d/`**`ESSE_PEDACO`**`/edit`

## 4. Publicar a função

**Opção A — Painel do Supabase (mais simples):** Edge Functions → *Deploy a new
function* → nome `sync-bolsistas` → cole o conteúdo de `index.ts`.

**Opção B — CLI:**
```bash
supabase login
supabase link --project-ref doqojrrqemvlnpgjrkqu
supabase functions deploy sync-bolsistas
```

## 5. Definir os secrets

No painel: **Edge Functions → sync-bolsistas → Secrets** (ou via CLI abaixo).
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados automaticamente.

```bash
supabase secrets set \
  SHEET_ID="cole_o_id_da_planilha" \
  SHEET_RANGE="A1:Z10000" \
  GOOGLE_SA_EMAIL="sync@projeto.iam.gserviceaccount.com" \
  GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

> A `private_key` do JSON já vem com `\n` literais — cole exatamente assim
> (a função converte `\n` em quebras de linha reais).

## 6. Testar manualmente

```bash
curl -X POST "https://doqojrrqemvlnpgjrkqu.functions.supabase.co/sync-bolsistas" \
  -H "Authorization: Bearer <SUA_CHAVE_ANON_OU_SERVICE_ROLE>"
```
Resposta esperada: `{"ok":true,"processados": N}`. Depois, confira em
**Table Editor → pessoas** os registros com `tipo = 'bolsista'`.

## 7. Agendar (a cada hora)

No **SQL Editor**, habilite as extensões e crie o agendamento (troque o token):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-bolsistas-horario',
  '0 * * * *',
  $$
    select net.http_post(
      url     := 'https://doqojrrqemvlnpgjrkqu.functions.supabase.co/sync-bolsistas',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <SUA_CHAVE_ANON_OU_SERVICE_ROLE>',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

Para remover o agendamento: `select cron.unschedule('sync-bolsistas-horario');`
