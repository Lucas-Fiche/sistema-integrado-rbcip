# Sistema Integrado RBCIP — Formulários Institucionais

Versão em HTML, CSS e JavaScript (sem dependências externas) dos formulários
institucionais que antes eram Google Forms. O objetivo é ter mais controle
sobre coleta, validação e armazenamento das solicitações.

## Estrutura

```
index.html                          Página inicial — escolha do formulário
forms/
  ├── pagamentos.html               Formulário de Pagamento
  ├── reembolso.html                Formulário de Reembolso
  ├── diarias-colaboradores.html    Solicitação de Diárias para Colaboradores
  └── diarias-bolsistas.html        Solicitação de Diárias para Bolsistas
assets/
  ├── css/styles.css                Estilo compartilhado
  └── js/
      ├── data.js                   Listas de projetos e bolsistas
      ├── components.js             Seções reutilizáveis (bloco padrão)
      └── app.js                    Máscaras, validação e envio
```

## Padronização por seções

Todos os formulários seguem a mesma organização em seções, o que facilita a
manutenção e o crescimento do sistema:

- **Seção 1 – Dados do Colaborador** — bloco **idêntico e compartilhado** entre
  os 4 formulários (Nome, Email, CPF, RG, Órgão/UF, Chave Pix e Confirmação Pix).
  Definido uma única vez em `assets/js/components.js` (`secaoDadosColaborador`) e
  injetado em cada formulário no `<div id="secao-colaborador">`. Alterar esse
  bloco em um lugar reflete automaticamente em todos os formulários.
- **Demais seções** (Detalhes da Atividade / Despesa / Comprovação) são
  específicas de cada formulário e ficam no próprio HTML.

Os formulários de diárias iniciam a Seção 1 com o campo **Projeto de Referência**;
o de bolsistas usa um **dropdown de nomes** no lugar do campo de texto.

## Como usar

Por serem arquivos estáticos, basta abrir `index.html` no navegador — ou
publicar a pasta em qualquer hospedagem estática (GitHub Pages, Netlify, etc.).

## Recursos

- **Validação**: campos obrigatórios, e-mail, CPF (com dígitos verificadores),
  valor monetário e formato de Órgão Emissor/UF (`SSP/DF`).
- **Máscaras**: CPF/PIX (apenas números), RG do reembolso (letras e números) e
  valor em reais (`1.234,56`).
- **Armazenamento local**: cada envio é guardado no `localStorage` do navegador
  e pode ser baixado em JSON como comprovante.

## Personalização

- **Projetos e bolsistas**: edite as listas `PROJETOS` e `BOLSISTAS` em
  `assets/js/data.js`. A lista de bolsistas contém apenas exemplos — substitua
  pela relação real de colaboradores pré-cadastrados. (A criação de uma base de
  dados de pessoas com preenchimento automático fica prevista para uma etapa
  futura.)
- **Bloco padrão de colaborador**: para incluir/alterar um campo em todos os
  formulários de uma vez, edite `secaoDadosColaborador` em `assets/js/components.js`.
- **Integração com backend**: hoje o envio é salvo localmente. Para enviar a um
  servidor/planilha, ajuste o `form.addEventListener("submit", …)` em
  `assets/js/app.js` para fazer um `fetch()` ao endpoint desejado.
