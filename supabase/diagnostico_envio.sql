-- =====================================================================
--  DIAGNÓSTICO DECISIVO — por que um recibo não saiu
--  Rode no SQL Editor. Não altera nada, só consulta.
--
--  Desde schema_fila_recibo.sql cada disparo guarda o id da chamada
--  (recibo_req_id). Isto junta, numa linha só, as três coisas que
--  explicam qualquer falha de envio:
--    1. o que o SERVIDOR respondeu à chamada (status, timeout, erro)
--    2. quantas TENTATIVAS já foram feitas e quando
--    3. o TAMANHO do comprovante anexado
--
--  Como ler a coluna "veredito" (a última da tabela):
--
--  SEM RESPOSTA + tentativas > 0
--      A função foi chamada e morreu antes de responder. É o padrão do
--      estouro de CPU: o processo é morto, então não sobra nem erro
--      gravado. Olhe o tamanho do comprovante na mesma linha.
--
--  HTTP 546
--      Estouro de CPU confirmado pelo próprio servidor.
--
--  TIMEOUT
--      O pg_net desistiu de esperar. Se o tempo for 5000ms, o banco
--      ainda está com a versão antiga do disparo: rode
--      schema_fila_recibo.sql.
--
--  HTTP 500 + detalhe
--      A função rodou e falhou por um motivo que ela mesma relatou. O
--      detalhe traz a mensagem — é o caso mais fácil de resolver.
--
--  HTTP 401
--      Token divergente entre o banco e a função, ou "Verify JWT" ligado.
--
--  NUNCA DISPARADO (tentativas = 0)
--      O gatilho não chegou a chamar. Veja a consulta 3.
-- =====================================================================

-- 1. TUDO que não saiu, com o veredito de cada caso
select s.id,
       (case s.formulario
          when 'pagamentos' then 'PAG' when 'reembolso' then 'REE'
          when 'diarias-colaboradores' then 'DC' when 'diarias-bolsistas' then 'DB'
          else 'REC' end) || '-' || s.recibo_numero || '/' || s.recibo_ano as recibo,
       s.nome,
       s.criado_em,
       coalesce(s.recibo_tentativas, 0)            as tentativas,
       s.recibo_tentado_em                         as ultima_tentativa,
       round((o.metadata->>'size')::numeric / 1048576, 2) as anexo_mb,
       o.metadata->>'mimetype'                     as anexo_tipo,
       r.status_code                               as http,
       left(coalesce(s.recibo_erro, r.content, r.error_msg), 200) as detalhe,
       case
         when s.recibo_erro is not null              then 'ERRO RELATADO — leia o detalhe'
         when coalesce(s.recibo_tentativas, 0) = 0   then 'NUNCA DISPARADO — veja a consulta 3'
         when r.status_code = 546                    then 'ESTOURO DE CPU confirmado'
         when r.status_code = 401                    then 'TOKEN/JWT — veja a consulta 4'
         when r.status_code >= 500                   then 'FUNCAO FALHOU — leia o detalhe'
         when r.timed_out                            then 'TIMEOUT do pg_net'
         when r.id is null                           then 'SEM RESPOSTA — morreu antes de responder'
         else 'respondeu ' || r.status_code
       end                                         as veredito
  from submissoes s
  left join net._http_response r on r.id = s.recibo_req_id
  left join storage.objects o
    on o.bucket_id = 'comprovantes'
   and o.name = s.dados->>'Anexar Comprovante/Recibo'
 where s.recibo_enviado_em is null
 order by s.criado_em desc;

-- 2. As últimas respostas do servidor, independentemente de submissão.
--    Útil quando a consulta 1 vem com "SEM RESPOSTA": aqui aparece se o
--    pg_net chegou a registrar alguma coisa no mesmo horário.
select id, status_code, timed_out,
       left(coalesce(content, error_msg), 200) as resposta,
       created
  from net._http_response
 order by created desc
 limit 15;

-- 3. O gatilho de envio está ativo?
select tgname as gatilho,
       case when tgenabled = 'D' then '❌ DESATIVADO' else '✅ ativo' end as estado
  from pg_trigger
 where tgrelid = 'submissoes'::regclass
   and not tgisinternal
 order by tgname;

-- 4. O token do disparo está configurado?
select case when valor = 'TROQUE_ESTE_TOKEN' then '❌ nunca configurado'
            when length(valor) < 8 then '⚠️ muito curto'
            else '✅ definido (' || length(valor) || ' caracteres)' end as token
  from app_config
 where chave = 'recibo_token';

-- 5. O agendador de reprocessamento está rodando?
select j.jobname, j.schedule, j.active,
       (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid) as ultima_rodada
  from cron.job j
 where j.jobname = 'reprocessa-recibos';
