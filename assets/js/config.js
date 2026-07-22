/* =============================================================
   Configuração do Supabase
   -------------------------------------------------------------
   Preencha com os dados do seu projeto (Project Settings > API).
   A chave "anon" é PÚBLICA por design — ela é protegida pelas
   regras de segurança (RLS) definidas em supabase/schema.sql, então
   pode ficar no repositório sem problema.

   Enquanto os valores abaixo estiverem como "SUA_..." o site continua
   funcionando em modo local (salva no navegador e permite baixar o
   comprovante), sem tentar se conectar ao banco.
   ============================================================= */

window.RBCIP_CONFIG = {
  SUPABASE_URL: "https://SUA_INSTANCIA.supabase.co",
  SUPABASE_ANON_KEY: "SUA_CHAVE_ANON",
};
