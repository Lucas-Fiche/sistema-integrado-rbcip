/* =============================================================
   Componentes de seção reutilizáveis
   -------------------------------------------------------------
   Fonte única de verdade para os blocos padronizados dos
   formulários. A "Seção 1 – Dados do Colaborador" é idêntica nos
   4 formulários, então é definida aqui uma única vez.
   ============================================================= */

const REQ = '<span class="req">*</span>';
const OPC = '<span class="opcional">(opcional)</span>';
// Marca do rótulo e atributo required, conforme o campo seja obrigatório
const marca = (obrig) => (obrig ? REQ : OPC);
const attr = (obrig) => (obrig ? "required " : "");

/* ---------- Campos individuais do bloco de colaborador ---------- */

function campoProjeto() {
  return `
    <div class="field" data-label="Projeto de Referência">
      <label>Escolha o Projeto de Referência ${REQ}</label>
      <select id="projeto" name="projeto" required></select>
      <span class="error"></span>
    </div>`;
}

function campoNomeTexto() {
  return `
    <div class="field" data-label="Nome Completo">
      <label>Nome Completo ${REQ}</label>
      <input type="text" name="nome" required />
      <span class="error"></span>
    </div>`;
}

function campoNomeSelect() {
  // Nome puxado da base de bolsistas (dropdown)
  return `
    <div class="field" data-label="Nome Completo">
      <label>Nome Completo ${REQ}</label>
      <select id="bolsista" name="nome" required></select>
      <span class="error"></span>
    </div>`;
}

function campoEmail(obrig = true) {
  return `
    <div class="field" data-label="Email">
      <label>Email ${marca(obrig)}</label>
      <input type="email" name="email" ${attr(obrig)}/>
      <span class="error"></span>
    </div>`;
}

function campoCPF() {
  return `
    <div class="field" data-label="CPF" data-validate="cpf">
      <label>CPF ${REQ}</label>
      <span class="hint">Por favor, APENAS NÚMEROS.</span>
      <input type="text" name="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" data-mask="cpf" required />
      <span class="error"></span>
    </div>`;
}

function campoRG(obrig = true) {
  return `
    <div class="field" data-label="RG">
      <label>RG ${marca(obrig)}</label>
      <span class="hint">Por favor, digite APENAS LETRAS E NÚMEROS.</span>
      <input type="text" name="rg" data-mask="alnum" ${attr(obrig)}/>
      <span class="error"></span>
    </div>`;
}

function campoOrgaoUF(obrig = true) {
  return `
    <div class="field" data-label="Órgão Emissor / UF" data-validate="orgao-uf">
      <label>Órgão Emissor / UF ${marca(obrig)}</label>
      <span class="hint">Digite seguindo o formato: SSP/DF</span>
      <input type="text" name="orgao_uf" placeholder="SSP/DF" ${attr(obrig)}/>
      <span class="error"></span>
    </div>`;
}

function campoChavePix() {
  return `
    <div class="field" data-label="Chave Pix (CPF)">
      <label>Chave Pix (CPF) ${REQ}</label>
      <span class="hint">Chave do tipo CPF (preenche automaticamente com o CPF acima).</span>
      <input type="text" name="chave_pix" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" data-mask="cpf" required />
      <span class="error"></span>
    </div>`;
}

function campoConfirmacaoPix() {
  return `
    <div class="field" data-label="Confirmação Pix" data-required="true">
      <label>Confirmação Pix ${REQ}</label>
      <span class="hint">Marque todas que se aplicam.</span>
      <div class="confirm-box">
        <label class="option">
          <input type="checkbox" name="confirmacao_pix" value="Ciente da Portaria nº 1-25" />
          <span>Estou ciente de que, conforme a Portaria nº 1-25, os pagamentos referentes
          a este recibo serão realizados exclusivamente por meio de PIX, obrigatoriamente
          utilizando chave do tipo CPF vinculada ao beneficiário, salvo justificativa
          apresentada e previamente aprovada.</span>
        </label>
      </div>
      <span class="error"></span>
    </div>`;
}

/* ---------- Seção 1 – Dados do Colaborador ----------
   opts.nome      : "texto" (padrão) ou "select" (base de bolsistas)
   opts.projeto   : true para incluir o campo Projeto de Referência
   opts.opcionais : lista de campos não obrigatórios
                    (ex.: ["email", "rg", "orgao_uf"] no Pagamento)
*/
function secaoDadosColaborador(opts = {}) {
  const { nome = "texto", projeto = false, opcionais = [] } = opts;
  const obrig = (campo) => !opcionais.includes(campo);
  const campos = [
    projeto ? campoProjeto() : "",
    nome === "select" ? campoNomeSelect() : campoNomeTexto(),
    campoEmail(obrig("email")),
    campoCPF(),
    campoRG(obrig("rg")),
    campoOrgaoUF(obrig("orgao_uf")),
    campoChavePix(),
    campoConfirmacaoPix(),
  ].join("");

  return `
    <section class="form-section">
      <h2 class="section-title"><span class="num">1</span>Dados do Colaborador</h2>
      ${campos}
    </section>`;
}

/* Injeta a Seção 1 no placeholder #secao-colaborador e popula os
   selects necessários. Deve rodar ANTES de ativarFormulario(). */
function montarSecaoColaborador(opts = {}) {
  const alvo = document.getElementById("secao-colaborador");
  if (!alvo) return;
  alvo.innerHTML = secaoDadosColaborador(opts);
  if (opts.projeto) preencherSelect("projeto", PROJETOS, "Selecione o projeto…");
  if (opts.nome === "select") preencherSelect("bolsista", BOLSISTAS, "Selecione o bolsista…");
}
