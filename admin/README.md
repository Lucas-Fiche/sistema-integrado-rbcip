# Dashboard de Gestão — acesso e administração

O painel (`admin/index.html`) é restrito à equipe. O login é por **e-mail + senha**
(diferente dos formulários, que usam CPF + código). Só quem tem `is_staff = true`
em `pessoas` consegue ver qualquer dado — a restrição é garantida por RLS no banco.

## Pré-requisitos (uma vez)

1. Rode `supabase/schema_dashboard.sql` no SQL Editor (cria `is_staff`,
   `fn_is_staff()` e as políticas do painel).
2. Em **Authentication → URL Configuration → Redirect URLs**, adicione a URL da
   página de definição de senha, para cada ambiente. Ex.:
   - Local: `http://localhost:8000/admin/redefinir.html`
   - Produção: `https://SEU_DOMINIO/admin/redefinir.html`
3. Confirme que o template **Authentication → Emails → Reset password** contém
   o link (`{{ .ConfirmationURL }}` — é o padrão).

## Definir a senha do primeiro admin (você)

Você já tem conta (criada ao usar os formulários) e já está marcado como staff.
Para criar sua senha:

1. Abra `admin/index.html` → clique em **"Esqueci / definir minha senha"**.
2. Informe seu e-mail → você recebe um link → defina a senha.
3. Volte e entre com **e-mail + senha**.

## Adicionar um novo admin

**Caso A — a pessoa já usa os formulários** (já tem conta de autenticação):
```sql
update pessoas set is_staff = true where cpf = 'CPF_SO_DIGITOS';
```
Depois, a pessoa usa **"Esqueci / definir minha senha"** para criar a senha.

**Caso B — a pessoa nunca usou o sistema** (não tem conta ainda):
1. Supabase → **Authentication → Users → Add user** → e-mail + senha (marque
   **Auto Confirm User**).
2. No SQL Editor:
   ```sql
   insert into pessoas (cpf, nome, email, tipo, is_staff, auth_user_id)
   values ('CPF_SO_DIGITOS', 'Nome do Admin', 'admin@rbcip.org',
           'nao_bolsista', true,
           (select id from auth.users where lower(email) = 'admin@rbcip.org'))
   on conflict (cpf) do update
     set is_staff = true,
         auth_user_id = excluded.auth_user_id,
         email = excluded.email;
   ```
3. A pessoa entra com o e-mail + senha definidos no passo 1.

## Remover um admin

```sql
update pessoas set is_staff = false where cpf = 'CPF_SO_DIGITOS';
```
(Opcional: apague o usuário em Authentication → Users se ele não precisar mais
acessar os formulários.)

## Observações

- **Só admins têm senha/painel.** Usuários comuns (bolsistas/colaboradores)
  entram nos formulários por CPF + código e nunca definem senha. Mesmo que um
  deles crie uma senha, sem `is_staff = true` o painel não mostra nada (RLS).
- A sessão do painel é **persistente**: o admin loga uma vez e permanece logado
  no mesmo navegador até sair ou trocar de dispositivo.
