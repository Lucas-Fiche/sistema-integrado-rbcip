/* =============================================================
   Dados compartilhados dos formulários
   ============================================================= */

// Projetos de referência (formulários de diárias)
const PROJETOS = [
  "PROJ1-2024-FAPEC",
  "PROJ2-2024-OPAS",
  "PROJ3-2024-INAC",
  "PROJ4-2024-PARANA1",
  "PROJ5-2024-PARANA2",
  "PROJ6-2024-RIBAS",
  "PROJ7.1-2024-Rondônia",
  "PROJ8-2024-Carreta_Digital",
  "PROJ9-2024-SAPIENS",
  "PROJ7.2-2024-Rondônia",
  "PROJ10-2024-SAPIENS",
  "PROJ1-2025-UNOPS-P2",
  "PROJ2-2025-UNOPS-P3",
  "PROJ3-2025-FAPEC-DOURADOS",
  "RBCIP-SÃO PAULO",
  "RBCIP-LEI_DO_BEM",
  "JFCE-PNUD",
];

/*
  Lista de bolsistas / colaboradores pré-cadastrados (Formulário 4).
  No documento original esta é uma "lista extensiva". Abaixo há alguns
  exemplos representativos — substitua/complemente com a relação real da
  instituição.
*/
const BOLSISTAS = [
  "Acacia dos Santos",
  "Ademir Barbosa Júnior",
  "Zilma Ribeiro da Silva",
];

// Preenche um <select> a partir de uma lista de strings
function preencherSelect(id, itens, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  if (placeholder) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
  }
  itens.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    sel.appendChild(opt);
  });
}
