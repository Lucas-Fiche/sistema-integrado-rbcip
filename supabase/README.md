# Backend Supabase — banco e ordem de execução

> ⚠️ **A ordem importa.** Vários arquivos redefinem a mesma função. Rodar um
> arquivo antigo depois de um mais novo **desfaz correções** — inclusive de
> segurança. Confira as tabelas abaixo antes de executar qualquer coisa.

## Ordem canônica (projeto novo, do zero)

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `schema.sql` | Tabelas base (`projetos`, `pessoas`, `submissoes`), RLS, grants |
| 2 | `schema_fase3.sql` | Login por CPF: `auth_user_id` e políticas do usuário |
| 3 | `schema_dashboard.sql` | `is_staff`, `fn_is_staff()`, políticas do painel |
| 4 | `schema_recibo.sql` | Numeração do recibo, `app_config`, disparo da Edge Function, buckets |
| 5 | _(pular)_ `schema_recibo_por_formulario.sql` | Só para bancos antigos: migra o contador global para por formulário |
| 6 | `schema_comprovante.sql` | `fn_registrar_submissao` (insert que devolve o nº do recibo) |
| 7 | `schema_auditoria.sql` | `submissoes_log`: quem alterou cada status |
| 8 | `schema_terceiros.sql` | Preenchimento para terceiros (**substitui** a função do #6) |
| 9 | `schema_protege_identidade2.sql` | Protege o cadastro de quem tem conta ou é bolsista |

Ao final, rode **`verificar_estado.sql`** para confirmar que o banco está no
estado esperado.

## Arquivos substituídos — não execute isoladamente

| Arquivo | Substituído por | Se rodar por engano |
|---|---|---|
| `schema_protege_identidade.sql` | `schema_protege_identidade2.sql` | Volta a preencher campos vazios do cadastro com dados de terceiros |
| `schema_comprovante.sql` (`fn_registrar_submissao`) | `schema_terceiros.sql` | Para de registrar quem preencheu para terceiros |
| `schema.sql` (`fn_registrar_pessoa`) | `schema_protege_identidade2.sql` | **Reabre a falha**: formulário volta a sobrescrever o cadastro de outra pessoa |

> Se precisar reexecutar `schema.sql` (ex.: recriar tabelas), rode **sempre**
> `schema_protege_identidade2.sql` logo em seguida.

## Utilitários

| Arquivo | Uso |
|---|---|
| `verificar_estado.sql` | Confere se o banco está no estado esperado — rode após qualquer mudança |
| `limpar_dados_teste.sql` | Apaga submissões de teste e zera a numeração (irreversível) |

## Edge Functions

Ficam em `supabase/functions/`. Alterações no Git **não chegam sozinhas** ao
Supabase — é preciso redeploy.

| Função | Redeployar quando |
|---|---|
| `gerar-recibo` | Alterou o PDF, o e-mail ou os anexos do recibo |
| `auth-cpf` | Alterou o login por CPF |
| `sync-bolsistas` | Alterou a leitura da planilha de bolsistas |

## Configuração do site

`assets/js/config.js` guarda a URL do projeto e a chave **anon** (pública por
design — quem protege os dados é o RLS). A chave `service_role` **nunca** pode
ir para o repositório nem para o navegador.

## Segurança (resumo)

- O site público usa a chave anon, que só consegue **inserir** submissões
  (pagamentos, sem login) — não lê respostas nem acessa `pessoas` diretamente.
- Cadastro de pessoas e numeração de recibo rodam em triggers `SECURITY
  DEFINER`, sem expor as tabelas.
- Cadastros com conta de acesso ou de bolsistas **não são alterados** por envio
  de formulário (`schema_protege_identidade2.sql`).
- `submissoes_log` é somente leitura pela API: nem staff apaga o histórico.
- CPF e chave PIX são dados pessoais — a leitura fica restrita ao painel
  autenticado (atenção à LGPD).
