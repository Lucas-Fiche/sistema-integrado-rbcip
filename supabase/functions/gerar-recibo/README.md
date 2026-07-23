# Fase 5 — Recibo idêntico (Google Docs) + envio ao financeiro

A cada submissão, a trigger `trg_enviar_recibo` chama esta Edge Function, que:
1. copia o **modelo Google Doc** correspondente ao formulário,
2. substitui os `<<campos>>` pelos valores (numera o recibo, valor por extenso),
3. **exporta em PDF idêntico** ao modelo,
4. envia por e-mail ao financeiro (Reembolso vai com o comprovante anexado),
5. apaga a cópia temporária e marca `submissoes.recibo_enviado_em`.

## 1. Banco

Rode `supabase/schema_recibo.sql` (já feito) e defina o token:
```sql
update app_config set valor = 'SEU_TOKEN' where chave = 'recibo_token';
```

## 2. Setup no Google (uma vez)

1. **Google Cloud Console** (mesmo projeto da Service Account do Sheets) →
   **APIs & Services → Library** → habilite **Google Docs API** e **Google Drive API**.
2. Faça upload dos 4 DOCX no **Google Drive** e **abra cada um como Google Docs**
   (Arquivo → Salvar como Documentos Google), criando 4 Google Docs.
3. Crie uma **pasta** no Drive para os recibos gerados.
4. **Compartilhe** com o e-mail da Service Account (`...@...iam.gserviceaccount.com`):
   - os 4 modelos (permissão **Leitor**),
   - a pasta de destino (permissão **Editor**).
5. Anote os **IDs**: do trecho `/document/d/`**`ID`**`/edit` (modelos) e
   `/folders/`**`ID`** (pasta).

## 3. Publicar a função (Verify JWT DESLIGADO)

- Painel: Edge Functions → `gerar-recibo` → aba **Code** → cole o `index.ts` → **Deploy**.
- Settings → **desligue Verify JWT**.

## 4. Secrets

Reaproveita os do Google (já configurados na `sync-bolsistas`) e adiciona os IDs:

| Secret | Valor |
|---|---|
| `GOOGLE_SA_EMAIL` | (já existe) e-mail da Service Account |
| `GOOGLE_SA_PRIVATE_KEY` | (já existe) chave privada |
| `DOC_TEMPLATE_PAGAMENTOS` | ID do Google Doc do modelo de Pagamento |
| `DOC_TEMPLATE_REEMBOLSO` | ID do modelo de Reembolso |
| `DOC_TEMPLATE_DIARIAS_COLAB` | ID do modelo de Diária — Colaborador |
| `DOC_TEMPLATE_DIARIAS_BOLS` | ID do modelo de Diária — Bolsista |
| `DRIVE_FOLDER_ID` | ID da pasta de destino |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | envio (já configurados) |
| `RECIBO_DESTINATARIOS` | e-mails do financeiro (por vírgula) |
| `RECIBO_TOKEN` | igual ao `app_config.recibo_token` |

## 5. Testar

Envie um formulário e confira o e-mail: o PDF deve estar **idêntico ao modelo**.

### Diagnóstico (Logs da função)
- `template_nao_configurado` → falta o secret do ID daquele formulário.
- `Drive copy: ... 404/403` → o modelo/pasta não foi compartilhado com a Service Account, ou o ID está errado.
- `Token Google: ...` → APIs não habilitadas ou chave inválida.
- erro de SMTP → conferir `GMAIL_USER`/`GMAIL_APP_PASSWORD`.

## Observações
- A substituição usa a **API do Docs** (opera sobre o texto), então funciona mesmo
  que o modelo tivesse marcadores "quebrados" no DOCX.
- O comprovante do Reembolso vai **anexado ao e-mail** (o texto do marcador é
  substituído por uma nota). Se preferir a imagem **dentro** do PDF, dá para evoluir depois.
