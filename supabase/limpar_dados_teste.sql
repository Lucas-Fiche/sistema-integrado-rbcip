-- =====================================================================
--  LIMPEZA DE DADOS DE TESTE
--  Execute no SQL Editor UMA vez, ao terminar os testes e antes de entrar
--  em produção. A numeração dos recibos recomeça em 1 para cada
--  formulário (PAG-1/2026, REE-1/2026, DC-1/2026, DB-1/2026).
--
--  ⚠️ APAGA TODAS as submissões e o histórico de auditoria.
--     Não há como desfazer. Confira o item 0 antes de prosseguir.
--
--  NÃO mexe em: contas de acesso (auth.users), bolsistas sincronizados
--  da planilha, projetos, nem nas configurações do sistema.
-- =====================================================================

-- 0. CONFIRA O QUE SERÁ APAGADO (rode sozinho primeiro, se quiser)
select 'submissões'            as o_que, count(*) as registros from submissoes
union all select 'itens de histórico',  count(*) from submissoes_log
union all select 'pessoas não bolsistas', count(*) from pessoas where tipo = 'nao_bolsista'
union all select 'PRESERVADOS: bolsistas', count(*) from pessoas where tipo = 'bolsista'
union all select 'PRESERVADOS: contas de acesso', count(*) from auth.users;

-- ---------------------------------------------------------------------
-- 1. Submissões + histórico de auditoria
--    As duas tabelas vão juntas: submissoes_log referencia submissoes,
--    e o TRUNCATE exige que ambas sejam esvaziadas na mesma instrução.
-- ---------------------------------------------------------------------
truncate table submissoes_log, submissoes restart identity;

-- ---------------------------------------------------------------------
-- 2. Contadores de recibo (numeração recomeça em 1 por formulário)
-- ---------------------------------------------------------------------
truncate table recibo_contador;

-- ---------------------------------------------------------------------
-- 3. Pessoas cadastradas pelos formulários durante os testes.
--    Preserva bolsistas (planilha) e quem tem conta de acesso.
--    Comente se quiser manter os cadastros de não bolsistas.
-- ---------------------------------------------------------------------
delete from pessoas
 where tipo = 'nao_bolsista'
   and auth_user_id is null;

-- ---------------------------------------------------------------------
-- 4. CONFERÊNCIA — tudo deve ficar zerado, menos os preservados
-- ---------------------------------------------------------------------
select 'submissões'            as o_que, count(*) as registros from submissoes
union all select 'itens de histórico',  count(*) from submissoes_log
union all select 'contadores de recibo', count(*) from recibo_contador
union all select 'pessoas não bolsistas', count(*) from pessoas where tipo = 'nao_bolsista'
union all select 'PRESERVADOS: bolsistas', count(*) from pessoas where tipo = 'bolsista'
union all select 'PRESERVADOS: contas de acesso', count(*) from auth.users;

-- ---------------------------------------------------------------------
-- 5. ARQUIVOS DO STORAGE — precisa ser pelo painel
--    O Supabase bloqueia DELETE direto em storage.objects (erro 42501).
--    Vá em Storage → bucket → selecionar tudo → Delete, nos dois buckets:
--      • comprovantes  (anexos enviados nos reembolsos de teste)
--      • recibos       (PDFs gerados nos testes)
-- ---------------------------------------------------------------------
