# Backend Supabase — Fase 1

Este diretório contém o schema do banco que armazena as respostas dos
formulários e o cadastro de pessoas.

## Passo a passo para colocar no ar

1. **Crie o projeto**
   - Acesse <https://supabase.com> e crie um projeto novo (guarde a senha do
     banco). Escolha a região mais próxima (ex.: São Paulo).

2. **Rode o schema**
   - No painel do projeto, abra **SQL Editor → New query**.
   - Cole todo o conteúdo de [`schema.sql`](./schema.sql) e clique em **Run**.
   - Isso cria as tabelas `projetos`, `pessoas` e `submissoes`, as regras de
     segurança (RLS) e a trigger que cadastra a pessoa automaticamente.

3. **Pegue as credenciais**
   - Vá em **Project Settings → API**.
   - Copie o **Project URL** e a chave **anon public**.

4. **Configure o site**
   - Abra `assets/js/config.js` e cole os dois valores:
     ```js
     window.RBCIP_CONFIG = {
       SUPABASE_URL: "https://xxxxxxxx.supabase.co",
       SUPABASE_ANON_KEY: "eyJhbGciOi...",
     };
     ```
   - A chave `anon` é pública por design (as regras RLS é que protegem os
     dados), então pode ser versionada no repositório.

5. **Teste**
   - Abra um formulário, preencha e envie.
   - No painel do Supabase, veja **Table Editor → submissoes**: a resposta deve
     aparecer lá, e a pessoa correspondente em **pessoas**.

## O que já está pronto para o futuro

- **Campo `status`** em `submissoes` (`pendente`, `em_analise`, `aprovado`,
  `rejeitado`, `pago`) — base para o dashboard de gestão de solicitações.
- **Campo `valor`** numérico e timestamps — para relatórios e gráficos.
- **Tabela `pessoas` unificada** com `tipo` (`bolsista` / `nao_bolsista`) —
  os bolsistas virão do Google Sheets (Fase 2); os não-bolsistas já são
  cadastrados automaticamente a cada envio (Fase 1).

## Segurança (resumo)

- O site público usa apenas a chave **anon**, que — pelas políticas RLS — só
  pode **inserir** em `submissoes`. Não consegue **ler** respostas nem acessar
  `pessoas` diretamente.
- O cadastro de pessoas é feito por uma trigger `SECURITY DEFINER` no banco,
  sem expor a tabela ao público.
- Como tratamos CPF e chave PIX (dados pessoais), a leitura desses dados ficará
  restrita ao dashboard autenticado (Fase 3) — atenção à LGPD.
