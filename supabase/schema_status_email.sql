-- =====================================================================
--  Status do envio do recibo por e-mail + reenvio manual
--  Execute no SQL Editor.
--
--  Até agora o sistema só sabia dizer que um recibo FOI enviado
--  (recibo_enviado_em). Quando falhava, ninguém ficava sabendo — foi o
--  que aconteceu no episódio do "CPU Time exceeded". Estas colunas
--  guardam também o MOTIVO da falha, e a função permite reenviar.
-- =====================================================================

-- 1. Colunas de resultado do envio
alter table submissoes
  add column if not exists recibo_erro    text,
  add column if not exists recibo_erro_em timestamptz;

-- 2. Reenvio manual, disparado pelo painel.
--    SECURITY DEFINER porque precisa ler o token em app_config (protegido
--    por RLS) — assim o navegador nunca vê o token. Só staff pode chamar.
create or replace function fn_reenviar_recibo(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec submissoes;
begin
  if not fn_is_staff() then
    raise exception 'apenas a equipe de gestão pode reenviar recibos';
  end if;

  select * into v_rec from submissoes where id = p_id;
  if not found then
    raise exception 'solicitação % não encontrada', p_id;
  end if;

  -- Limpa o resultado anterior: a tentativa nova define o novo estado
  update submissoes
     set recibo_erro = null,
         recibo_erro_em = null
   where id = p_id;

  perform net.http_post(
    url     := 'https://doqojrrqemvlnpgjrkqu.supabase.co/functions/v1/gerar-recibo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_CZ5v2kL9BUn9pVs2V08y5Q_7OlDIQsE'
    ),
    body    := jsonb_build_object(
      'token',  (select valor from app_config where chave = 'recibo_token'),
      'record', to_jsonb(v_rec)
    )
  );

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

grant execute on function fn_reenviar_recibo(bigint) to authenticated;

-- 3. Conferência: situação de envio das últimas solicitações
select id, formulario, nome, criado_em,
       case when recibo_enviado_em is not null then '✅ enviado'
            when recibo_erro is not null       then '❌ falhou'
            else '⏳ não enviado' end as email,
       recibo_enviado_em,
       left(recibo_erro, 120) as motivo
  from submissoes
 order by criado_em desc
 limit 15;
