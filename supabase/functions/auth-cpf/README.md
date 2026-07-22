# Fase 3 — Autenticação por CPF + código no e-mail

A Edge Function [`index.ts`](./index.ts) implementa o login:
- `acao: "solicitar"` → acha o e-mail pelo CPF (na tabela `pessoas`) e envia
  um código por e-mail (Email OTP). O e-mail **não** é devolvido ao navegador.
- `acao: "verificar"` → valida o código e devolve a sessão, além de vincular o
  usuário autenticado ao registro em `pessoas` (`auth_user_id`).

## 1. Rodar o SQL da Fase 3

No **SQL Editor**, execute [`supabase/schema_fase3.sql`](../../schema_fase3.sql).
Ele cria a coluna `auth_user_id`, as políticas de leitura do próprio registro
(autofill) e a regra de que só **Pagamento** é público.

## 2. Publicar a função com **Verify JWT DESLIGADO**

O usuário ainda não está autenticado ao pedir/validar o código, então a
verificação de JWT precisa estar **desligada** nesta função:

- **Painel:** Edge Functions → *Deploy a new function* → nome `auth-cpf` → cole
  o `index.ts`. Depois, em **Settings** da função, **desligue "Verify JWT"**.
- **CLI:** `supabase functions deploy auth-cpf --no-verify-jwt`

> A função usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (já injetados). Não
> precisa de secrets novos.

## 3. Configurar o e-mail do código (importante)

O login usa **código de 6 dígitos** (não link mágico). Garanta que o template
de e-mail inclua o token:

- **Authentication → Emails → Magic Link** (ou "OTP") → o corpo precisa conter
  a variável `{{ .Token }}`. Ex.: *"Seu código de acesso é: **{{ .Token }}**"*.
- Em **Authentication → Providers → Email**, mantenha o provedor de e-mail
  habilitado. O e-mail nativo do Supabase tem limite baixo (bom para testes);
  para produção, configure um **SMTP** próprio em **Project Settings → Auth → SMTP**.

## 4. Testar

1. Abra `forms/reembolso.html` (via `python3 -m http.server` ou hospedagem).
2. Deve aparecer a tela **"Acesso restrito"**.
3. Digite um CPF que exista em `pessoas` (um bolsista sincronizado) → **Enviar código**.
4. Verifique o e-mail, digite o código → **Entrar**.
5. O formulário aparece com **Nome, E-mail, CPF (e RG/Órgão/Chave Pix, se já
   houver)** preenchidos automaticamente.

### Diagnóstico
- **Não recebeu o código** → template sem `{{ .Token }}`, e-mail inválido na
  planilha, ou limite do e-mail nativo (configure SMTP).
- **"CPF não encontrado"** → o CPF não está em `pessoas`; a tela oferece o
  fluxo de *primeiro acesso* (e-mail + nome).
- **Erro 401 ao chamar a função** → "Verify JWT" ainda está ligado; desligue.
