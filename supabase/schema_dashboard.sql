-- =====================================================================
--  Fase 4 — Dashboard de gestão (acesso de staff)
--  Execute no SQL Editor DEPOIS do schema.sql e do schema_fase3.sql.
-- =====================================================================

-- 1. Marca quem é da equipe de gestão
alter table pessoas add column if not exists is_staff boolean not null default false;

-- 2. Helper: o usuário logado é staff?
--    SECURITY DEFINER para não sofrer recursão de RLS ao consultar pessoas.
create or replace function fn_is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_staff from pessoas where auth_user_id = auth.uid()),
    false
  );
$$;
grant execute on function fn_is_staff() to authenticated;

-- 3. Staff pode LER e ATUALIZAR todas as submissões
drop policy if exists "staff le submissoes" on submissoes;
create policy "staff le submissoes"
  on submissoes for select
  to authenticated
  using (fn_is_staff());

drop policy if exists "staff atualiza submissoes" on submissoes;
create policy "staff atualiza submissoes"
  on submissoes for update
  to authenticated
  using (fn_is_staff())
  with check (fn_is_staff());

grant select, update on table submissoes to authenticated;

-- 4. Staff pode ler a base de pessoas (nomes, gestão futura)
drop policy if exists "staff le pessoas" on pessoas;
create policy "staff le pessoas"
  on pessoas for select
  to authenticated
  using (fn_is_staff());

-- 5. Defina o staff inicial (ajuste/adicione CPFs conforme necessário)
update pessoas set is_staff = true where cpf = '02879695171';
