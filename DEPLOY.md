# Deploy na Vercel

O projeto é um **site estático** (HTML/CSS/JS, sem build). A Vercel publica
direto, sem passo de compilação.

## 1. Preparar a branch

Recomendado publicar a partir da `main`. Se o trabalho está na branch de
desenvolvimento, faça o merge antes:

```bash
git checkout main
git merge claude/google-forms-html-css-js-r43aay
git push origin main
```

## 2. Importar na Vercel

1. Acesse <https://vercel.com> → **Add New… → Project**.
2. Importe o repositório `sistema-integrado-rbcip` do GitHub.
3. Configure:
   - **Framework Preset:** `Other` (site estático).
   - **Root Directory:** a raiz do repositório (onde está `index.html`).
   - **Build Command:** deixe **vazio**.
   - **Output Directory:** deixe **vazio** (serve a raiz).
4. Clique em **Deploy**. Em segundos o site estará no ar em uma URL
   `https://SEU-PROJETO.vercel.app` (depois dá para apontar um domínio próprio).

> Não é preciso configurar variáveis de ambiente na Vercel: o `assets/js/config.js`
> traz apenas a URL e a chave **pública** do Supabase (protegida por RLS). Os
> segredos ficam todos no Supabase.

## 3. Configuração pós-deploy no Supabase (importante)

1. **Authentication → URL Configuration:**
   - **Site URL:** `https://SEU-PROJETO.vercel.app`
   - **Redirect URLs:** adicione `https://SEU-PROJETO.vercel.app/admin/redefinir.html`
     (sem isso, o "definir senha" do painel não funciona em produção).
2. **Edge Functions → `gerar-recibo` → Secrets:** troque `RECIBO_DESTINATARIOS`
   para os **e-mails reais do financeiro** (separados por vírgula).

## 3.1 Limpar os dados de teste (antes de valer para produção)

Durante o desenvolvimento o banco acumula submissões de teste e a numeração
dos recibos avança. Para começar a produção com a contagem limpa (o primeiro
recibo de cada formulário vira `SIGLA-1/ANO`), rode no **SQL Editor** o arquivo
[`supabase/limpar_dados_teste.sql`](supabase/limpar_dados_teste.sql).

> ⚠️ Ele **apaga todas as submissões** e zera os contadores de recibo — não há
> como desfazer. Rode apenas quando tiver certeza de que os registros são de
> teste. Os arquivos físicos do Storage (buckets `comprovantes` e `recibos`)
> podem ser removidos pelo painel **Storage → Delete**.

## 4. Conferir

- Abra a URL da Vercel, envie um **Pagamento** (público) e confirme:
  - a solicitação aparece no **Dashboard de Gestão**;
  - o **recibo** chega ao e-mail do financeiro.
- Faça login no painel (`/admin/`) com e-mail + senha.

## Atualizações futuras

Cada `git push` na branch publicada dispara um novo deploy automático na Vercel.
O `vercel.json` já define cache que revalida os arquivos, então os usuários
pegam a versão nova sem precisar limpar o cache manualmente.

## Observações
- **E-mail:** o envio usa Gmail/Workspace (limites de envio). Para volume maior,
  migrar para um provedor transacional (Resend/SendGrid).
- **Anti-spam:** os formulários têm honeypot + tempo mínimo de preenchimento
  contra robôs. Para proteção adicional em escala, considerar rate limiting.
