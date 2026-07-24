-- =====================================================================
--  Migração — contagem de recibo INDIVIDUAL por formulário
--  Execute UMA vez no SQL Editor (bancos que já rodaram schema_recibo.sql
--  com o contador antigo, que era global por ano).
--
--  Antes: um contador por ano (todos os formulários compartilhavam).
--  Depois: um contador por (formulário, ano). A sigla do formulário
--  (PAG/REE/DC/DB) é adicionada na exibição para o identificador ser
--  único entre formulários (ex.: PAG-12/2026, REE-3/2026).
--
--  Observação: os recibos já emitidos mantêm o número que receberam. Se
--  quiser recomeçar a contagem do zero, limpe os dados de teste antes.
-- =====================================================================

-- Recria o contador com chave (formulario, ano)
drop table if exists recibo_contador;
create table recibo_contador (
  formulario text not null,
  ano        int  not null,
  ultimo     int  not null default 0,
  primary key (formulario, ano)
);
alter table recibo_contador enable row level security;

-- Nova função com o formulário no parâmetro
create or replace function fn_proximo_recibo(p_formulario text, p_ano int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into recibo_contador (formulario, ano, ultimo)
  values (p_formulario, p_ano, 1)
  on conflict (formulario, ano)
    do update set ultimo = recibo_contador.ultimo + 1
  returning ultimo into n;
  return n;
end;
$$;

-- Remove a versão antiga (1 argumento) para evitar ambiguidade
drop function if exists fn_proximo_recibo(int);

-- Trigger passa a numerar por formulário
create or replace function fn_numerar_recibo()
returns trigger
language plpgsql
as $$
begin
  new.recibo_ano := extract(year from now())::int;
  new.recibo_numero := fn_proximo_recibo(new.formulario, new.recibo_ano);
  return new;
end;
$$;

drop trigger if exists trg_numerar_recibo on submissoes;
create trigger trg_numerar_recibo
  before insert on submissoes
  for each row execute function fn_numerar_recibo();
