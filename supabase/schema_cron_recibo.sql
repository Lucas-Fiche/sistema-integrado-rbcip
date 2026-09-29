-- =====================================================================
--  Agendador: reprocessa sozinho os recibos que não saíram
--  Execute no SQL Editor DEPOIS de schema_fila_recibo.sql.
--
--  POR QUE ESTÁ EM ARQUIVO SEPARADO
--  O SQL Editor roda tudo como UMA transação: se a extensão pg_cron não
--  estiver liberada no projeto, o erro aqui desfaria também o arquivo
--  anterior. Separado, um problema neste passo não derruba o resto.
--
--  O QUE FAZ
--  A cada 10 minutos procura solicitações sem e-mail enviado e chama a
--  Edge Function de novo. Para depois de 5 tentativas por solicitação,
--  para não insistir eternamente num caso que precisa de gente olhando.
--
--  Se der erro dizendo que pg_cron não existe: painel do Supabase →
--  Database → Extensions → ative "pg_cron" e rode este arquivo de novo.
-- =====================================================================

create extension if not exists pg_cron;

-- Remove um agendamento anterior com o mesmo nome (permite reexecutar
-- este arquivo sem criar jobs duplicados).
select cron.unschedule('reprocessa-recibos')
 where exists (select 1 from cron.job where jobname = 'reprocessa-recibos');

select cron.schedule(
  'reprocessa-recibos',
  '*/10 * * * *',
  $$select fn_reprocessar_recibos(10);$$
);

-- =====================================================================
--  CONFERÊNCIA
-- =====================================================================

-- 1. O agendamento existe e está ativo?
select jobid, jobname, schedule, active
  from cron.job
 where jobname = 'reprocessa-recibos';

-- 2. Como foram as últimas rodadas? (aparece alguns minutos depois)
select start_time, status, return_message
  from cron.job_run_details
 where jobid in (select jobid from cron.job where jobname = 'reprocessa-recibos')
 order by start_time desc
 limit 10;
