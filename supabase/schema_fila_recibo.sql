-- =====================================================================
--  Fila de recibos — nenhuma solicitação fica sem e-mail em silêncio
--  Execute no SQL Editor DEPOIS de schema_status_email.sql.
--
--  O PROBLEMA
--  O gatilho chamava a Edge Function e esquecia a chamada:
--      perform net.http_post(...)          -- o id da chamada era jogado fora
--  Ninguém conferia o resultado. Se a função morresse antes de responder
--  (estouro de CPU, instabilidade do Google, conexão cortada), NADA era
--  gravado: a solicitação ficava "⏳ não enviado" para sempre e só se
--  descobria quando alguém reclamava de não ter sido pago.
--
--  Além disso, o pg_net espera apenas 5 segundos por padrão — menos do
--  que os ~8 a 12 segundos que a geração do PDF leva. A chamada era
--  cortada antes da hora, e a resposta nunca era registrada.
--
--  O QUE ESTE ARQUIVO FAZ
--   1. Guarda o id da chamada  -> dá para ver o que o servidor respondeu.
--   2. Conta as tentativas      -> dá para reprocessar sem repetir para sempre.
--   3. Espera até 60 segundos   -> a chamada não é mais cortada no meio.
--   4. Cria o reprocessamento   -> pendências voltam para a fila sozinhas.
--
--  Nada aqui apaga dados. Pode rodar com o sistema em produção.
-- =====================================================================

-- 1. Colunas de rastreio da chamada -----------------------------------
alter table submissoes
  add column if not exists recibo_req_id     bigint,
  add column if not exists recibo_tentativas int not null default 0,
  add column if not exists recibo_tentado_em timestamptz;

-- 2. Ponto único de disparo -------------------------------------------
--    Antes havia três lugares repetindo a mesma chamada (gatilho, reenvio
--    manual e agora o reprocessamento). Agora é uma função só: corrigir
--    o envio passa a ser corrigir um lugar.
create or replace function fn_disparar_recibo(p_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec submissoes;
  v_req bigint;
begin
  select * into v_rec from submissoes where id = p_id;
  if not found then
    raise exception 'solicitação % não encontrada', p_id;
  end if;

  select net.http_post(
    url     := 'https://doqojrrqemvlnpgjrkqu.supabase.co/functions/v1/gerar-recibo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- chave publishable/anon (pública) — necessária para o gateway rotear
      'Authorization', 'Bearer sb_publishable_CZ5v2kL9BUn9pVs2V08y5Q_7OlDIQsE'
    ),
    body    := jsonb_build_object(
      'token',  (select valor from app_config where chave = 'recibo_token'),
      'record', to_jsonb(v_rec)
    ),
    -- o padrão do pg_net é 5s; gerar o PDF leva mais que isso
    timeout_milliseconds := 60000
  ) into v_req;

  update submissoes
     set recibo_req_id     = v_req,
         recibo_tentativas = coalesce(recibo_tentativas, 0) + 1,
         recibo_tentado_em = now(),
         recibo_erro       = null,
         recibo_erro_em    = null
   where id = p_id;

  return v_req;
end;
$$;

-- Disparar recibo não pode ser chamado pelo navegador.
revoke execute on function fn_disparar_recibo(bigint) from public;

-- 3. O gatilho passa a usar o ponto único ------------------------------
create or replace function fn_enviar_recibo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform fn_disparar_recibo(new.id);
  return new;
end;
$$;

drop trigger if exists trg_enviar_recibo on submissoes;
create trigger trg_enviar_recibo
  after insert on submissoes
  for each row execute function fn_enviar_recibo();

-- 4. Reenvio manual de UMA solicitação (botão "↻ Tentar enviar") -------
create or replace function fn_reenviar_recibo(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req bigint;
begin
  if not fn_is_staff() then
    raise exception 'apenas a equipe de gestão pode reenviar recibos';
  end if;

  v_req := fn_disparar_recibo(p_id);
  return jsonb_build_object('ok', true, 'id', p_id, 'chamada', v_req);
end;
$$;

grant execute on function fn_reenviar_recibo(bigint) to authenticated;

-- 5. Reenvio em lote de TUDO que está pendente (botão do painel) -------
create or replace function fn_reenviar_pendentes(p_limite int default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_n  int := 0;
begin
  if not fn_is_staff() then
    raise exception 'apenas a equipe de gestão pode reenviar recibos';
  end if;

  for v_id in
    select id from submissoes
     where recibo_enviado_em is null
     order by criado_em
     limit greatest(coalesce(p_limite, 25), 0)
  loop
    perform fn_disparar_recibo(v_id);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'reenviados', v_n);
end;
$$;

grant execute on function fn_reenviar_pendentes(int) to authenticated;

-- 6. Reprocessamento automático ----------------------------------------
--    Chamado pelo agendador (schema_cron_recibo.sql). Só pega o que ficou
--    para trás, respeita um intervalo entre tentativas e desiste depois de
--    5 tentativas — assim uma falha permanente não vira e-mail infinito.
create or replace function fn_reprocessar_recibos(p_limite int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_n  int := 0;
begin
  for v_id in
    select id from submissoes
     where recibo_enviado_em is null
       and coalesce(recibo_tentativas, 0) < 5
       and criado_em > now() - interval '30 days'
       and (recibo_tentado_em is null
            or recibo_tentado_em < now() - interval '10 minutes')
     order by criado_em
     limit greatest(coalesce(p_limite, 10), 0)
  loop
    perform fn_disparar_recibo(v_id);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'reprocessados', v_n, 'em', now());
end;
$$;

-- Só o agendador e o service_role chamam esta função.
revoke execute on function fn_reprocessar_recibos(int) from public;

-- 7. As solicitações antigas nunca foram contadas ----------------------
--    Elas têm recibo_tentativas = 0 e recibo_tentado_em nulo, então o
--    reprocessamento vai pegá-las na primeira rodada. É o que queremos.

-- =====================================================================
--  CONFERÊNCIA — o que está pendente e o que o servidor respondeu
-- =====================================================================
select s.id,
       s.formulario,
       s.nome,
       s.recibo_numero,
       s.criado_em,
       case when s.recibo_enviado_em is not null then '✅ enviado'
            when s.recibo_erro is not null       then '❌ falhou'
            else '⏳ não enviado' end            as situacao,
       s.recibo_tentativas                       as tentativas,
       r.status_code                             as resposta_http,
       left(coalesce(r.content, r.error_msg), 160) as detalhe
  from submissoes s
  left join net._http_response r on r.id = s.recibo_req_id
 where s.recibo_enviado_em is null
 order by s.criado_em desc
 limit 30;
