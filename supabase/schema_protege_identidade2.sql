-- =====================================================================
--  Correção definitiva: envio de formulário NUNCA altera o cadastro de
--  quem tem conta de acesso ou é bolsista.
--  Execute no SQL Editor (substitui a versão de schema_protege_identidade).
--
--  A correção anterior impedia SUBSTITUIR dados existentes, mas ainda
--  PREENCHIA campos vazios (email = coalesce(email, new.email)). Ao
--  preencher para um terceiro, se o campo do titular estivesse vazio, ele
--  recebia o dado do terceiro — foi o que trocou o e-mail exibido.
--
--  Regra nova, mais simples e segura: cadastro protegido não é tocado
--  por envio de formulário. Os dados dessas pessoas vêm da conta e da
--  planilha de bolsistas (fontes autoritativas), nunca de um formulário.
-- =====================================================================

create or replace function fn_registrar_pessoa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cpf       text := regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g');
  v_protegida boolean;
begin
  if v_cpf = '' then
    return new;
  end if;

  select (p.auth_user_id is not null or p.tipo = 'bolsista')
    into v_protegida
    from pessoas p
   where p.cpf = v_cpf;

  if v_protegida is true then
    -- Cadastro protegido: NÃO é alterado por formulário (nem preenchido).
    null;
  else
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
  end if;

  select id into new.pessoa_id from pessoas where cpf = v_cpf;
  new.cpf := v_cpf;
  return new;
end;
$$;

-- =====================================================================
--  DIAGNÓSTICO — o que o painel realmente lê
--  O painel busca em `pessoas` a linha do auth_user_id da sessão. Rode
--  isto para ver exatamente essa linha (e eventuais duplicatas).
-- =====================================================================

-- 1. A linha que o painel lê para cada conta de acesso
--    (compare 'email_cadastro' com 'email_login')
select u.email               as email_login,
       p.nome                as nome_cadastro,
       p.email               as email_cadastro,
       p.cpf,
       p.tipo,
       p.is_staff,
       case when lower(coalesce(p.email,'')) <> lower(u.email)
            then '⚠️ divergente' else '✅ igual' end as situacao
  from auth.users u
  left join pessoas p on p.auth_user_id = u.id
 order by u.email;

-- 2. Duplicatas de e-mail (podem fazer o painel ler a linha errada)
select lower(email) as email, count(*) as linhas,
       string_agg(cpf || ' / ' || nome, '  |  ') as registros
  from pessoas
 where email is not null and email <> ''
 group by lower(email)
having count(*) > 1;

-- 3. Duplicatas de CPF (não deveria existir: cpf é unique)
select cpf, count(*) from pessoas group by cpf having count(*) > 1;

-- =====================================================================
--  REPARO — ajuste e descomente conforme o diagnóstico acima
-- =====================================================================
-- Corrige o e-mail do cadastro usando o e-mail de login (fonte confiável):
-- update pessoas p
--    set email = u.email, atualizado_em = now()
--   from auth.users u
--  where p.auth_user_id = u.id
--    and lower(coalesce(p.email,'')) <> lower(u.email);

-- Corrige o nome, se necessário:
-- update pessoas set nome = 'Lucas Fiche Ungarelli Borges'
--  where cpf = '02879695171';
