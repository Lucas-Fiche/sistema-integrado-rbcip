# Fase 5 — Recibo automático + envio ao financeiro

A cada submissão, a trigger `trg_enviar_recibo` chama esta Edge Function, que:
1. numera o recibo (sequencial por ano),
2. gera o PDF (fiel ao texto dos modelos, com valor por extenso),
3. para Reembolso, embute a imagem do comprovante (Storage),
4. envia por e-mail ao financeiro com o PDF anexado,
5. marca `submissoes.recibo_enviado_em`.

## 1. Banco

Rode `supabase/schema_recibo.sql` no SQL Editor. Depois defina um token próprio
(o mesmo valor será usado como secret da função):

```sql
update app_config set valor = 'UM_TOKEN_SECRETO_QUALQUER' where chave = 'recibo_token';
```

## 2. Publicar a função (Verify JWT DESLIGADO)

- Painel: Edge Functions → nova função `gerar-recibo` → cole o `index.ts` →
  em Settings, **desligue Verify JWT**.
- CLI: `supabase functions deploy gerar-recibo --no-verify-jwt`

## 3. Secrets da função

Em Edge Functions → `gerar-recibo` → Secrets:

| Secret | Valor |
|---|---|
| `GMAIL_USER` | o e-mail @rbcip.org usado no SMTP |
| `GMAIL_APP_PASSWORD` | a **mesma senha de app** já criada para o SMTP do login |
| `RECIBO_DESTINATARIOS` | e-mails do financeiro separados por vírgula. **Por enquanto:** `lucas.fiche.u.borges@gmail.com` |
| `RECIBO_TOKEN` | o **mesmo** valor definido em `app_config.recibo_token` |

(`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados.)

## 4. Testar

1. Envie qualquer formulário (ex.: Pagamento — é público).
2. Confira o e-mail do destinatário: deve chegar com o PDF anexado.
3. No banco: `select recibo_numero, recibo_ano, recibo_enviado_em from submissoes order by criado_em desc limit 1;` — `recibo_enviado_em` deve estar preenchido.

### Diagnóstico
- **Nada chegou** → veja Edge Functions → `gerar-recibo` → Logs. Erros comuns:
  - `token_invalido` → `RECIBO_TOKEN` ≠ `app_config.recibo_token`.
  - erro de SMTP → conferir `GMAIL_USER`/`GMAIL_APP_PASSWORD`.
  - `RECIBO_DESTINATARIOS vazio` → definir o secret.
- **Reembolso sem a imagem** → o comprovante precisa ter sido enviado ao Storage
  (formulário atualizado) e o caminho salvo em `dados`.

## Quando tiver os 3 e-mails do financeiro

Basta atualizar o secret `RECIBO_DESTINATARIOS` para
`fin1@rbcip.org, fin2@rbcip.org, fin3@rbcip.org` — sem mexer no código.

## Observações
- O envio usa Gmail/Workspace (limites de envio se aplicam). Para volume/produção,
  dá para migrar a um serviço transacional depois.
- O recibo é gerado **no envio** do formulário. Se preferir gerar só após a
  aprovação no dashboard, dá para mudar o gatilho.
