-- =====================================================================
--  Sistema Integrado RBCIP — Schema do banco (Supabase / PostgreSQL)
--  Fase 1: cadastro de pessoas, projetos e submissões dos formulários.
--
--  Como usar:
--    1. Crie um projeto em https://supabase.com
--    2. Abra o "SQL Editor" e cole/execute este arquivo inteiro
--    3. Copie a URL e a chave anon (Project Settings > API) para
--       assets/js/config.js
-- =====================================================================

-- ---------------------------------------------------------------------
-- Função utilitária: atualiza a coluna atualizado_em em UPDATE
-- ---------------------------------------------------------------------
create or replace function fn_touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tabela: projetos
-- (lista de projetos de referência dos formulários de diárias)
-- ---------------------------------------------------------------------
create table if not exists projetos (
  id         bigint generated always as identity primary key,
  codigo     text not null unique,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Tabela: pessoas  (cadastro unificado)
--   tipo = 'bolsista'      -> sincronizado do Google Sheets (Fase 2)
--   tipo = 'nao_bolsista'  -> criado automaticamente ao enviar formulário
-- ---------------------------------------------------------------------
create table if not exists pessoas (
  id            bigint generated always as identity primary key,
  cpf           text not null unique,            -- somente dígitos
  nome          text not null,
  email         text,
  rg            text,
  orgao_uf      text,
  chave_pix     text,
  tipo          text not null default 'nao_bolsista'
                check (tipo in ('bolsista', 'nao_bolsista')),
  origem        text,                            -- ex.: 'google_sheets', 'formulario:reembolso'
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_pessoas_tipo on pessoas (tipo);

create trigger trg_pessoas_touch
  before update on pessoas
  for each row execute function fn_touch_updated();

-- ---------------------------------------------------------------------
-- Tabela: submissoes  (respostas dos 4 formulários)
--   'dados' guarda o payload completo em JSON;
--   colunas soltas (cpf, valor, status...) facilitam relatórios e o
--   futuro dashboard de gestão.
-- ---------------------------------------------------------------------
create table if not exists submissoes (
  id            bigint generated always as identity primary key,
  formulario    text not null,                   -- 'pagamentos' | 'reembolso' | 'diarias-colaboradores' | 'diarias-bolsistas'
  pessoa_id     bigint references pessoas (id),
  cpf           text,
  nome          text,
  email         text,
  projeto       text,
  valor         numeric(12,2),
  status        text not null default 'pendente'
                check (status in ('pendente', 'em_analise', 'aprovado', 'rejeitado', 'pago')),
  dados         jsonb not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_submissoes_formulario on submissoes (formulario);
create index if not exists idx_submissoes_status     on submissoes (status);
create index if not exists idx_submissoes_cpf        on submissoes (cpf);
create index if not exists idx_submissoes_criado_em  on submissoes (criado_em desc);

create trigger trg_submissoes_touch
  before update on submissoes
  for each row execute function fn_touch_updated();

-- ---------------------------------------------------------------------
-- Trigger: ao inserir uma submissão, cadastra/atualiza a pessoa.
--   Roda no servidor com SECURITY DEFINER, então NÃO exige que o
--   formulário público tenha permissão de escrita na tabela pessoas.
--   Um bolsista que preencha um formulário NÃO é rebaixado para
--   'nao_bolsista' (o campo tipo não é sobrescrito no conflito).
-- ---------------------------------------------------------------------
create or replace function fn_registrar_pessoa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cpf text := regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g');
begin
  if v_cpf = '' then
    return new;
  end if;

  insert into pessoas (cpf, nome, email, rg, orgao_uf, chave_pix, tipo, origem)
  values (
    v_cpf,
    new.nome,
    new.email,
    new.dados->>'RG',
    new.dados->>'Órgão Emissor / UF',
    new.dados->>'Chave Pix (CPF)',
    'nao_bolsista',
    'formulario:' || new.formulario
  )
  on conflict (cpf) do update set
    nome      = coalesce(excluded.nome,      pessoas.nome),
    email     = coalesce(excluded.email,     pessoas.email),
    rg        = coalesce(excluded.rg,        pessoas.rg),
    orgao_uf  = coalesce(excluded.orgao_uf,  pessoas.orgao_uf),
    chave_pix = coalesce(excluded.chave_pix, pessoas.chave_pix),
    atualizado_em = now();

  select id into new.pessoa_id from pessoas where cpf = v_cpf;
  new.cpf := v_cpf;
  return new;
end;
$$;

create trigger trg_registrar_pessoa
  before insert on submissoes
  for each row execute function fn_registrar_pessoa();

-- =====================================================================
--  Segurança (Row Level Security)
--  - submissoes: o site público (papel anon) pode APENAS inserir.
--                Ninguém anônimo consegue ler as respostas.
--  - pessoas   : sem acesso anônimo direto (a escrita é feita pela
--                trigger, que roda como definer). Leitura/uso ficará a
--                cargo do dashboard autenticado / Edge Functions.
--  - projetos  : leitura pública liberada (lista não sensível).
-- =====================================================================
alter table submissoes enable row level security;
alter table pessoas    enable row level security;
alter table projetos   enable row level security;

drop policy if exists "anon insere submissoes" on submissoes;
create policy "anon insere submissoes"
  on submissoes for insert
  to anon
  with check (true);

drop policy if exists "leitura publica de projetos" on projetos;
create policy "leitura publica de projetos"
  on projetos for select
  to anon
  using (ativo = true);

-- ---------------------------------------------------------------------
-- GRANTs para o papel público (anon)
--   Necessários porque o RLS é COMPLEMENTAR ao privilégio base: sem o
--   GRANT, o PostgREST recusa a operação mesmo com a política liberada.
--   Importante quando "Automatically expose new tables" está DESLIGADO
--   no projeto (as tabelas criadas via SQL não recebem grant automático).
-- ---------------------------------------------------------------------
grant usage  on schema public to anon;
grant insert on table submissoes to anon;
grant select on table projetos   to anon;

-- ---------------------------------------------------------------------
-- Seed inicial dos projetos (mesma lista de assets/js/data.js)
-- ---------------------------------------------------------------------
insert into projetos (codigo) values
  ('PROJ1-2024-FAPEC'),
  ('PROJ2-2024-OPAS'),
  ('PROJ3-2024-INAC'),
  ('PROJ4-2024-PARANA1'),
  ('PROJ5-2024-PARANA2'),
  ('PROJ6-2024-RIBAS'),
  ('PROJ7.1-2024-Rondônia'),
  ('PROJ8-2024-Carreta_Digital'),
  ('PROJ9-2024-SAPIENS'),
  ('PROJ7.2-2024-Rondônia'),
  ('PROJ10-2024-SAPIENS'),
  ('PROJ1-2025-UNOPS-P2'),
  ('PROJ2-2025-UNOPS-P3'),
  ('PROJ3-2025-FAPEC-DOURADOS'),
  ('RBCIP-SÃO PAULO'),
  ('RBCIP-LEI_DO_BEM'),
  ('JFCE-PNUD')
on conflict (codigo) do nothing;
