-- =====================================================================
--  Auditoria — registra QUEM alterou o status de cada solicitação
--  Execute no SQL Editor depois dos schemas anteriores.
--
--  Guarda o histórico completo (uma linha por alteração), com o autor,
--  o status anterior, o novo e o momento. O registro é feito por trigger
--  no banco — não depende do navegador, então não dá para burlar pelo
--  cliente nem esquecer de registrar.
-- =====================================================================

-- 1. Tabela de log
create table if not exists submissoes_log (
  id            bigint generated always as identity primary key,
  submissao_id  bigint not null references submissoes (id) on delete cascade,
  acao          text not null default 'status',
  de            text,          -- status anterior
  para          text,          -- status novo
  auth_user_id  uuid,          -- quem fez (usuário autenticado)
  autor_nome    text,          -- nome no momento da ação (snapshot)
  autor_email   text,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_log_submissao on submissoes_log (submissao_id, criado_em desc);

-- 2. Trigger: a cada mudança de status, grava quem fez
--    SECURITY DEFINER para conseguir escrever no log mesmo com RLS ativo.
create or replace function fn_log_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_email text;
begin
  if new.status is distinct from old.status then
    select p.nome, p.email into v_nome, v_email
      from pessoas p where p.auth_user_id = v_uid limit 1;

    -- fallback: e-mail do próprio token quando a pessoa não está em `pessoas`
    if v_email is null then
      v_email := nullif(auth.jwt() ->> 'email', '');
    end if;

    insert into submissoes_log (submissao_id, acao, de, para, auth_user_id, autor_nome, autor_email)
    values (new.id, 'status', old.status, new.status, v_uid,
            coalesce(v_nome, '(desconhecido)'), v_email);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_status on submissoes;
create trigger trg_log_status
  after update on submissoes
  for each row execute function fn_log_status();

-- 3. Segurança: só staff lê o log; ninguém edita ou apaga (nem staff).
--    Sem políticas de INSERT/UPDATE/DELETE, o log é imutável pela API —
--    só a trigger (definer) escreve.
alter table submissoes_log enable row level security;

drop policy if exists "staff le log" on submissoes_log;
create policy "staff le log"
  on submissoes_log for select
  to authenticated
  using (fn_is_staff());

grant select on table submissoes_log to authenticated;
grant select, insert on table submissoes_log to service_role;
