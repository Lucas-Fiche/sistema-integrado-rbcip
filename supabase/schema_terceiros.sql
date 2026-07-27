-- =====================================================================
--  Preenchimento em nome de terceiros
--  Execute no SQL Editor depois dos schemas anteriores.
--
--  Caso de uso: a secretaria preenche Pagamento/Reembolso/Diárias para
--  prestadores de serviço. A solicitação continua sendo DO beneficiário
--  (nome/CPF do terceiro), mas fica registrado QUEM preencheu.
--
--  Segurança: o vínculo com a conta (preenchido_por_uid) é resolvido no
--  servidor via auth.uid() — o navegador não consegue forjar a autoria.
-- =====================================================================

-- 1. Colunas de autoria do preenchimento
alter table submissoes
  add column if not exists por_terceiro          boolean not null default false,
  add column if not exists preenchido_por_nome   text,
  add column if not exists preenchido_por_email  text,
  add column if not exists preenchido_por_uid    uuid;

-- 2. Insert com registro de autoria (substitui a versão do schema_comprovante)
create or replace function fn_registrar_submissao(p_registro jsonb)
returns table (id bigint, recibo_numero int, recibo_ano int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_formulario text := p_registro->>'formulario';
  v_uid        uuid := auth.uid();
  v_terceiro   boolean := coalesce((p_registro->>'por_terceiro')::boolean, false);
  v_nome       text;
  v_email      text;
begin
  if v_formulario is null or v_formulario = '' then
    raise exception 'formulario_invalido';
  end if;

  -- Mesma regra do RLS: sem login, só o formulário de pagamento.
  if v_uid is null and v_formulario <> 'pagamentos' then
    raise exception 'login_obrigatorio';
  end if;

  -- Quem preencheu: com login, os dados vêm do cadastro (fonte confiável);
  -- sem login (Pagamento é público), usa o que foi declarado no formulário.
  if v_uid is not null then
    select p.nome, p.email into v_nome, v_email
      from pessoas p where p.auth_user_id = v_uid limit 1;
    if v_email is null then
      v_email := nullif(auth.jwt() ->> 'email', '');
    end if;
  else
    v_nome  := nullif(p_registro->>'preenchido_por_nome', '');
    v_email := nullif(p_registro->>'preenchido_por_email', '');
  end if;

  return query
  insert into submissoes (
    formulario, cpf, nome, email, projeto, valor, dados,
    por_terceiro, preenchido_por_nome, preenchido_por_email, preenchido_por_uid
  )
  values (
    v_formulario,
    nullif(p_registro->>'cpf', ''),
    nullif(p_registro->>'nome', ''),
    nullif(p_registro->>'email', ''),
    nullif(p_registro->>'projeto', ''),
    nullif(p_registro->>'valor', '')::numeric,
    coalesce(p_registro->'dados', '{}'::jsonb),
    v_terceiro,
    case when v_terceiro then v_nome  else null end,
    case when v_terceiro then v_email else null end,
    v_uid
  )
  returning submissoes.id, submissoes.recibo_numero, submissoes.recibo_ano;
end;
$$;

grant execute on function fn_registrar_submissao(jsonb) to anon, authenticated;
