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

> **Importante:** contas de serviço não têm armazenamento próprio no Drive. Por
> isso a cópia dos modelos precisa ser criada em um **Drive Compartilhado**
> (Shared Drive) — arquivos lá não contam contra a quota da conta de serviço.

1. **Google Cloud Console** (mesmo projeto da Service Account do Sheets) →
   **APIs & Services → Library** → habilite **Google Docs API** e **Google Drive API**.
2. No Google Drive, crie um **Drive Compartilhado** (Drives compartilhados → Novo)
   — ex.: "RBCIP Recibos". *(Requer Google Workspace.)*
3. **Adicione a Service Account como membro** desse Drive Compartilhado, com
   papel **Gerenciador de conteúdo** (ou Gerente).
4. Faça upload dos 4 DOCX **dentro do Drive Compartilhado** e **abra cada um como
   Google Docs** (Arquivo → Salvar como Documentos Google).
5. (Opcional) crie uma subpasta no Drive Compartilhado para os recibos gerados.
6. Anote os **IDs**: dos 4 modelos (`/document/d/`**`ID`**`/edit`) e da pasta de
   destino (`/folders/`**`ID`**) — ou use o ID do próprio Drive Compartilhado.

> Alternativa sem Drive Compartilhado: **delegação em todo o domínio**
> (impersonar um usuário real) — mais setup no Admin do Workspace. Se preferir
> esse caminho, avise.

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
