# Inventário de credenciais e segredos

> **Nunca** coloque os **valores** dos segredos neste arquivo (nem em qualquer
> arquivo do repositório). Guarde os valores num **gerenciador de senhas**.
> Aqui ficam apenas: o que é cada item, **onde** é configurado e **como trocar**.

## Públicos (podem ficar no repositório)

| Item | Onde | Observação |
|---|---|---|
| Supabase URL | `assets/js/config.js` | endereço do projeto (público) |
| Supabase chave `publishable`/`anon` | `assets/js/config.js` | pública por design; protegida por RLS |

## Segredos (só no gerenciador de senhas + no painel onde é usado)

| Segredo | Onde é usado | Como obter / trocar |
|---|---|---|
| **Senha do banco (Postgres)** | criada ao criar o projeto Supabase | Project Settings → Database → *Reset database password* |
| **Service role key** | injetada automaticamente nas Edge Functions | Project Settings → API Keys (nunca vai ao repositório) |
| **Senha de app do Gmail** | Authentication → SMTP **e** secret `GMAIL_APP_PASSWORD` da função `gerar-recibo` | Conta Google @rbcip.org → Segurança → Senhas de app (gerar nova; não é recuperável) |
| **`recibo_token`** | tabela `app_config` **e** secret `RECIBO_TOKEN` da função `gerar-recibo` | Você define; os dois valores devem ser **iguais** |
| **Service Account do Google (JSON)** | secrets `GOOGLE_SA_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` da função `sync-bolsistas` | Google Cloud → conta de serviço → nova chave JSON |
| **`SHEET_ID`** | secret da função `sync-bolsistas` | trecho da URL da planilha "Cadastro de Bolsista" |
| **`RECIBO_DESTINATARIOS`** | secret da função `gerar-recibo` | e-mails do financeiro (separados por vírgula) |

## Onde os secrets ficam no Supabase

- **Edge Functions → (função) → Secrets** — `sync-bolsistas` e `gerar-recibo`.
- **Authentication → SMTP Settings** — usuário e senha de app do e-mail.
- **SQL / `app_config`** — `recibo_token` (protegido por RLS).

## Boas práticas

- Nunca commitar valores de segredo. O `.gitignore` já ignora `assets/js/config.local.js`.
- Ao trocar a senha de app do Gmail, atualize **todos** os lugares que a usam.
- Ao rotacionar o `recibo_token`, altere nos **dois** lugares (`app_config` e o secret da função).
