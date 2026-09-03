-- =====================================================================
--  DIAGNÓSTICO — recibos não estão chegando por e-mail
--  Rode no SQL Editor. Não altera nada, só consulta.
--
--  O envio tem DUAS etapas independentes:
--    A) o gatilho no banco chama a Edge Function (pg_net)
--    B) a Edge Function gera o PDF e envia pelo Gmail
--  Cada consulta abaixo isola uma delas.
-- =====================================================================

-- 1. As últimas solicitações concluíram o envio?
--    recibo_enviado_em só é preenchido no FIM de uma execução bem-sucedida.
--    Se estiver vazio, a função não terminou (etapa B falhou) OU nem foi
--    chamada (etapa A falhou).
select id,
       formulario,
       nome,
       criado_em,
       recibo_numero,
       recibo_enviado_em,
       case when recibo_enviado_em is not null then '✅ enviado'
            else '❌ não concluiu' end as situacao
  from submissoes
 order by criado_em desc
 limit 10;

-- 2. O gatilho existe e está ativo? (etapa A)
select tgname as gatilho,
       case when tgenabled = 'D' then '❌ DESATIVADO' else '✅ ativo' end as estado
  from pg_trigger
 where tgrelid = 'submissoes'::regclass
   and not tgisinternal
 order by tgname;

-- 3. O que o servidor respondeu às chamadas do gatilho? (etapa A → B)
--    status 200 = a função respondeu; veja o corpo para saber se deu ok:true.
--    status 401 = "Verify JWT" foi ligado ou o token não confere.
--    status 500 = a função executou e deu erro (o corpo traz o motivo).
--    sem linhas  = o gatilho não chegou a chamar (pg_net inativo).
select id,
       status_code,
       left(content, 300) as resposta,
       created
  from net._http_response
 order by created desc
 limit 10;

-- 4. O token do gatilho ainda bate com o segredo da função?
--    Se estiver 'TROQUE_ESTE_TOKEN', nunca foi configurado.
select chave,
       case when valor = 'TROQUE_ESTE_TOKEN' then '❌ token padrão, não configurado'
            when length(valor) < 8 then '⚠️ token muito curto'
            else '✅ token definido (' || length(valor) || ' caracteres)' end as situacao
  from app_config
 where chave = 'recibo_token';

-- 5. A extensão pg_net está instalada? (sem ela o gatilho não chama nada)
select extname as extensao, '✅ instalada' as situacao
  from pg_extension
 where extname = 'pg_net';
