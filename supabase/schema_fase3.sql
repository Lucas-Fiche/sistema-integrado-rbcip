-- =====================================================================
--  Fase 3 — Autenticação e autofill
--  Execute no SQL Editor DEPOIS do schema.sql principal.
-- =====================================================================

-- 1. Vincula cada pessoa ao usuário autenticado (auth.users)
alter table pessoas add column if not exists auth_user_id uuid references auth.users (id);
create index if not exists idx_pessoas_auth_user on pessoas (auth_user_id);

-- 2. RLS: o usuário autenticado lê APENAS o próprio registro (para o autofill)
drop policy if exists "usuario le seu registro" on pessoas;
create policy "usuario le seu registro"
  on pessoas for select
  to authenticated
  using (auth_user_id = auth.uid());

grant usage  on schema public to authenticated;
grant select on table pessoas to authenticated;

-- 3. Submissões:
--    - anon (público) só pode inserir o formulário de Pagamento
--    - autenticado pode inserir qualquer formulário
drop policy if exists "anon insere submissoes" on submissoes;
drop policy if exists "anon insere pagamentos" on submissoes;
create policy "anon insere pagamentos"
  on submissoes for insert
  to anon
  with check (formulario = 'pagamentos');

drop policy if exists "autenticado insere submissoes" on submissoes;
create policy "autenticado insere submissoes"
  on submissoes for insert
  to authenticated
  with check (true);

grant insert on table submissoes to authenticated;
