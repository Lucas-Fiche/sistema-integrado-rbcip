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

-- 4. Arquivos de teste do Storage (comprovantes de reembolso e PDFs de
--    recibo): NÃO dá para apagar por SQL — o Supabase bloqueia o DELETE
--    direto em storage.objects (erro 42501, protect_delete). Faça pelo
--    painel: Storage → bucket 'comprovantes' e bucket 'recibos' →
--    selecionar os arquivos → Delete.
