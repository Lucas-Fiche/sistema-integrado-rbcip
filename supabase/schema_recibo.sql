-- =====================================================================
--  Fase 5 — Geração de recibo + envio ao financeiro
--  Execute no SQL Editor depois dos schemas anteriores.
-- =====================================================================

-- 1. Colunas de controle do recibo em submissoes
alter table submissoes
  add column if not exists recibo_numero     int,
  add column if not exists recibo_ano        int,
  add column if not exists recibo_enviado_em timestamptz;

-- 2. Contador sequencial por ano (numeração dos recibos)
create table if not exists recibo_contador (
  ano    int primary key,
  ultimo int not null default 0
);

-- SECURITY DEFINER: escreve no contador mesmo com RLS ativo e sem grants
-- para os papéis públicos (o INSERT do formulário chama isto via trigger).
create or replace function fn_proximo_recibo(p_ano int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into recibo_contador (ano, ultimo) values (p_ano, 1)
  on conflict (ano) do update set ultimo = recibo_contador.ultimo + 1
  returning ultimo into n;
  return n;
end;
$$;

-- Protege o contador: RLS ligado e sem políticas = nenhum acesso por
-- anon/authenticated. A função SECURITY DEFINER e o service_role continuam
-- operando normalmente.
alter table recibo_contador enable row level security;

-- 3. Numera o recibo no momento do INSERT
create or replace function fn_numerar_recibo()
returns trigger
language plpgsql
as $$
begin
  new.recibo_ano := extract(year from now())::int;
  new.recibo_numero := fn_proximo_recibo(new.recibo_ano);
  return new;
end;
$$;

drop trigger if exists trg_numerar_recibo on submissoes;
create trigger trg_numerar_recibo
  before insert on submissoes
  for each row execute function fn_numerar_recibo();

-- 4. Configuração simples (token compartilhado com a Edge Function)
create table if not exists app_config (
  chave text primary key,
  valor text
);
insert into app_config (chave, valor)
values ('recibo_token', 'TROQUE_ESTE_TOKEN')
on conflict (chave) do nothing;

-- app_config guarda o token: protege com RLS (sem políticas = sem acesso
-- por anon/authenticated; as funções definer e o service_role seguem lendo).
alter table app_config enable row level security;

-- 5. Ao inserir a submissão, chama a Edge Function que gera e envia o recibo
create extension if not exists pg_net;

create or replace function fn_enviar_recibo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://doqojrrqemvlnpgjrkqu.supabase.co/functions/v1/gerar-recibo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- chave publishable/anon (pública) — necessária para o gateway rotear
      'Authorization', 'Bearer sb_publishable_CZ5v2kL9BUn9pVs2V08y5Q_7OlDIQsE'
    ),
    body    := jsonb_build_object(
      'token',  (select valor from app_config where chave = 'recibo_token'),
      'record', to_jsonb(new)
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_enviar_recibo on submissoes;
create trigger trg_enviar_recibo
  after insert on submissoes
  for each row execute function fn_enviar_recibo();

-- 6. Storage: bucket privado para os comprovantes do Reembolso
insert into storage.buckets (id, name, public)
values ('comprovantes', 'comprovantes', false)
on conflict (id) do nothing;

-- Usuários autenticados podem enviar comprovantes
drop policy if exists "auth envia comprovantes" on storage.objects;
create policy "auth envia comprovantes"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'comprovantes');

-- 7. Storage: PDFs de recibo (para visualização no Dashboard de Gestão)
alter table submissoes add column if not exists recibo_path text;

insert into storage.buckets (id, name, public)
values ('recibos', 'recibos', false)
on conflict (id) do nothing;

-- Somente staff pode ler os recibos (depende de fn_is_staff, do schema_dashboard)
drop policy if exists "staff le recibos" on storage.objects;
create policy "staff le recibos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'recibos' and fn_is_staff());
