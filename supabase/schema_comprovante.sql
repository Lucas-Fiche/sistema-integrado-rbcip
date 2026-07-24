-- =====================================================================
--  Fase 6 — Número real do recibo no comprovante do solicitante
--  Execute no SQL Editor depois dos schemas anteriores.
--
--  Por que uma função? O número do recibo é gerado por trigger no
--  INSERT (schema_recibo.sql), mas o RLS não deixa anon/authenticated
--  LER a tabela submissoes de volta — então um insert comum não
--  consegue devolver o número. Esta função SECURITY DEFINER faz o
--  insert e RETORNA id + número/ano, mantendo a mesma regra de acesso
--  do RLS (anônimo só envia 'pagamentos').
-- =====================================================================

create or replace function fn_registrar_submissao(p_registro jsonb)
returns table (id bigint, recibo_numero int, recibo_ano int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_formulario text := p_registro->>'formulario';
begin
  if v_formulario is null or v_formulario = '' then
    raise exception 'formulario_invalido';
  end if;

  -- Mesma regra do RLS: sem login, só o formulário de pagamento.
  if auth.uid() is null and v_formulario <> 'pagamentos' then
    raise exception 'login_obrigatorio';
  end if;

  return query
  insert into submissoes (formulario, cpf, nome, email, projeto, valor, dados)
  values (
    v_formulario,
    nullif(p_registro->>'cpf', ''),
    nullif(p_registro->>'nome', ''),
    nullif(p_registro->>'email', ''),
    nullif(p_registro->>'projeto', ''),
    nullif(p_registro->>'valor', '')::numeric,
    coalesce(p_registro->'dados', '{}'::jsonb)
  )
  returning submissoes.id, submissoes.recibo_numero, submissoes.recibo_ano;
end;
$$;

grant execute on function fn_registrar_submissao(jsonb) to anon, authenticated;
