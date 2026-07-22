# Sistema Integrado RBCIP — Formulários Institucionais

Versão em HTML, CSS e JavaScript (sem dependências externas) dos formulários
institucionais que antes eram Google Forms. O objetivo é ter mais controle
sobre coleta, validação e armazenamento das solicitações.

## Estrutura

```
index.html                          Página inicial — escolha do formulário
forms/
  ├── pagamentos.html               1. Formulário de Pagamentos
  ├── reembolso.html                2. Formulário de Reembolso
  ├── diarias-colaboradores.html    3. Solicitação de Diárias — Colaboradores (PJ)
  └── diarias.html                  4. Solicitação de Diárias (bolsistas)
assets/
  ├── css/styles.css                Estilo compartilhado
  └── js/
      ├── data.js                   Listas de projetos e bolsistas
      └── app.js                    Máscaras, validação e envio
```

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
  pela relação real de colaboradores pré-cadastrados.
- **Integração com backend**: hoje o envio é salvo localmente. Para enviar a um
  servidor/planilha, ajuste o `form.addEventListener("submit", …)` em
  `assets/js/app.js` para fazer um `fetch()` ao endpoint desejado.
