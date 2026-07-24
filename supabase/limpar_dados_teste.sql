-- =====================================================================
--  LIMPEZA DE DADOS DE TESTE
--  Execute no SQL Editor UMA vez, quando terminar os testes e antes de
--  entrar em produção. A numeração dos recibos recomeça em 1 para cada
--  formulário (PAG-1/2026, REE-1/2026, DC-1/2026, DB-1/2026).
--
--  ⚠️ ATENÇÃO: isto APAGA TODAS as submissões. Não há como desfazer.
--     Rode apenas se tiver certeza de que os registros são de teste.
-- =====================================================================

-- 1. Apaga todas as submissões e reinicia o contador de id da tabela.
truncate table submissoes restart identity;

-- 2. Zera os contadores de recibo (a numeração recomeça em 1 por formulário).
truncate table recibo_contador;

-- 3. (Opcional) Remove as pessoas cadastradas automaticamente pelos
--    formulários (tipo 'nao_bolsista'), mantendo os bolsistas
--    sincronizados do Google Sheets. Comente esta linha se quiser
--    preservar os cadastros de não bolsistas.
delete from pessoas where tipo = 'nao_bolsista';

-- 4. (Opcional) Limpa os arquivos de teste do Storage: comprovantes de
--    reembolso e PDFs de recibo. Isto remove os registros do banco; para
--    apagar os arquivos físicos também, use o painel Storage do Supabase
--    (Delete) nos buckets 'comprovantes' e 'recibos'.
delete from storage.objects where bucket_id in ('comprovantes', 'recibos');
