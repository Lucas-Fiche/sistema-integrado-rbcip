-- =====================================================================
--  Staff pode visualizar os comprovantes anexados
--  Execute no SQL Editor.
--
--  O bucket 'comprovantes' só tinha política de INSERT (envio pelo
--  formulário). Sem uma política de SELECT, nem o painel nem a geração
--  do recibo conseguiam LER o arquivo pela API do usuário — por isso o
--  comprovante não podia ser aberto no Dashboard.
--
--  Mesma regra já usada no bucket 'recibos': somente staff.
-- =====================================================================

drop policy if exists "staff le comprovantes" on storage.objects;
create policy "staff le comprovantes"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'comprovantes' and fn_is_staff());

-- Conferência: as duas políticas de leitura devem aparecer
select policyname, cmd
  from pg_policies
 where tablename = 'objects'
   and policyname in ('staff le comprovantes', 'staff le recibos')
 order by policyname;
