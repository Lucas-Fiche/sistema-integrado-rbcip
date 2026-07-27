-- =====================================================================
--  Correção: envio de formulário não pode reescrever a identidade de
--  alguém já cadastrado.
--  Execute no SQL Editor.
--
--  Problema: fn_registrar_pessoa fazia
--      nome = coalesce(excluded.nome, pessoas.nome)
--  ou seja, o nome enviado no formulário SOBRESCREVIA o cadastro de quem
--  já existia com aquele CPF. Ao preencher para um terceiro usando um CPF
--  já cadastrado, o nome da pessoa dona daquele CPF era trocado — e o
--  painel passava a exibir o nome errado para o usuário logado.
--
--  Também era um risco de integridade: qualquer envio público (Pagamento)
--  com o CPF de um membro da equipe renomeava esse membro.
--
--  Regra nova: cadastros com conta de acesso (auth_user_id) ou bolsistas
--  (sincronizados da planilha) têm a identidade PRESERVADA — o formulário
--  só completa campos que estejam vazios, nunca substitui o que existe.
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

  -- Cadastro protegido: tem conta de acesso ou veio da planilha de bolsistas
  select (p.auth_user_id is not null or p.tipo = 'bolsista')
    into v_protegida
    from pessoas p
   where p.cpf = v_cpf;

  if v_protegida then
    -- Preserva a identidade: só preenche o que ainda está vazio
    update pessoas set
      email     = coalesce(email,     new.email),
      rg        = coalesce(rg,        new.dados->>'RG'),
      orgao_uf  = coalesce(orgao_uf,  new.dados->>'Órgão Emissor / UF'),
      chave_pix = coalesce(chave_pix, new.dados->>'Chave Pix (CPF)'),
      atualizado_em = now()
    where cpf = v_cpf;
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

-- ---------------------------------------------------------------------
-- Reparo do cadastro afetado pelo teste
-- Ajuste o nome/CPF conforme necessário antes de executar.
-- ---------------------------------------------------------------------
-- update pessoas
--    set nome = 'Lucas Fiche Ungarelli Borges'
--  where cpf = '02879695171';

-- Conferência: quem tem conta de acesso e como está o nome
--   select nome, email, cpf, tipo, is_staff, auth_user_id is not null as tem_conta
--     from pessoas where auth_user_id is not null order by nome;
