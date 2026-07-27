-- =====================================================================
--  VERIFICAÇÃO DE ESTADO DO BANCO
--  Rode no SQL Editor depois de qualquer alteração de schema.
--  Não altera nada — só relata. Toda linha deve terminar em ✅.
-- =====================================================================

with checagens as (

  -- Colunas esperadas em submissoes
  select 'coluna submissoes.recibo_numero' as item,
         to_regclass('submissoes') is not null and exists (
           select 1 from information_schema.columns
            where table_name='submissoes' and column_name='recibo_numero') as ok,
         'rode schema_recibo.sql' as acao
  union all
  select 'coluna submissoes.recibo_path',
         exists (select 1 from information_schema.columns
                  where table_name='submissoes' and column_name='recibo_path'),
         'rode schema_recibo.sql (seção 7)'
  union all
  select 'colunas de terceiros (por_terceiro)',
         exists (select 1 from information_schema.columns
                  where table_name='submissoes' and column_name='por_terceiro'),
         'rode schema_terceiros.sql'

  -- Contador de recibo por formulário
  union all
  select 'contador de recibo por formulário',
         exists (select 1 from information_schema.columns
                  where table_name='recibo_contador' and column_name='formulario'),
         'rode schema_recibo_por_formulario.sql'
  union all
  select 'fn_proximo_recibo recebe (text, int)',
         exists (select 1 from pg_proc p
                  where p.proname='fn_proximo_recibo'
                    and pg_get_function_identity_arguments(p.oid)='text, integer'),
         'rode schema_recibo_por_formulario.sql'

  -- Insert que devolve o número e grava a autoria
  union all
  select 'fn_registrar_submissao grava autoria',
         exists (select 1 from pg_proc p
                  where p.proname='fn_registrar_submissao'
                    and pg_get_functiondef(p.oid) ilike '%preenchido_por_uid%'),
         'rode schema_terceiros.sql (schema_comprovante.sql o substitui!)'

  -- Proteção de identidade (a correção mais importante)
  union all
  select 'fn_registrar_pessoa protege cadastro',
         exists (select 1 from pg_proc p
                  where p.proname='fn_registrar_pessoa'
                    and pg_get_functiondef(p.oid) ilike '%v_protegida%'),
         'rode schema_protege_identidade2.sql'
  union all
  select 'proteção NÃO preenche campos vazios (versão 2)',
         exists (select 1 from pg_proc p
                  where p.proname='fn_registrar_pessoa'
                    and pg_get_functiondef(p.oid) ilike '%v_protegida is true%'),
         'rode schema_protege_identidade2.sql (a versão 1 é insuficiente)'

  -- Auditoria
  union all
  select 'tabela submissoes_log existe',
         to_regclass('submissoes_log') is not null,
         'rode schema_auditoria.sql'
  union all
  select 'log é somente leitura (sem política de escrita)',
         not exists (select 1 from pg_policies
                      where tablename='submissoes_log' and cmd in ('INSERT','UPDATE','DELETE')),
         'remova políticas de escrita de submissoes_log'

  -- Painel
  union all
  select 'fn_is_staff existe',
         exists (select 1 from pg_proc where proname='fn_is_staff'),
         'rode schema_dashboard.sql'

  -- RLS ativo nas tabelas sensíveis
  union all
  select 'RLS ativo em submissoes',
         (select relrowsecurity from pg_class where relname='submissoes'),
         'alter table submissoes enable row level security;'
  union all
  select 'RLS ativo em pessoas',
         (select relrowsecurity from pg_class where relname='pessoas'),
         'alter table pessoas enable row level security;'
  union all
  select 'RLS ativo em app_config (guarda o token)',
         coalesce((select relrowsecurity from pg_class where relname='app_config'), false),
         'rode schema_recibo.sql'

  -- Triggers ativas em submissoes
  union all
  select 'trigger de numeração do recibo',
         exists (select 1 from pg_trigger where tgname='trg_numerar_recibo' and not tgisinternal),
         'rode schema_recibo_por_formulario.sql'
  union all
  select 'trigger de envio do recibo',
         exists (select 1 from pg_trigger where tgname='trg_enviar_recibo' and not tgisinternal),
         'rode schema_recibo.sql'
  union all
  select 'trigger de auditoria de status',
         exists (select 1 from pg_trigger where tgname='trg_log_status' and not tgisinternal),
         'rode schema_auditoria.sql'

  -- Buckets
  union all
  select 'bucket recibos (privado)',
         exists (select 1 from storage.buckets where id='recibos' and public = false),
         'rode schema_recibo.sql (seção 7)'
  union all
  select 'bucket comprovantes (privado)',
         exists (select 1 from storage.buckets where id='comprovantes' and public = false),
         'rode schema_recibo.sql (seção 6)'

  -- Contas de acesso ao painel (uma linha por usuário)
  union all
  select 'acesso: ' || u.email,
         (p.auth_user_id is not null and coalesce(p.is_staff, false)),
         case when p.auth_user_id is null
                then 'sem vínculo em pessoas — rode o update de auth_user_id'
              when not coalesce(p.is_staff, false)
                then 'não é staff — update pessoas set is_staff = true'
              else '' end
    from auth.users u
    left join pessoas p on p.auth_user_id = u.id
)
select case when ok then '✅' else '❌' end as status,
       item,
       case when ok then '' else acao end as o_que_fazer
  from checagens
 order by ok, item;
