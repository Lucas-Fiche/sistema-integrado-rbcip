/* =============================================================
   Gera assets/data/municipios.json — base do autocomplete de
   Origem/Destino nos formulários de diárias.

   Fonte: github.com/kelvins/municipios-brasileiros (licença MIT),
   que reúne os municípios do IBGE com latitude/longitude. A API
   oficial do IBGE traz os nomes, mas não as coordenadas — e o mapa
   da rota precisa delas.

   Como atualizar (ex.: quando o IBGE criar um município novo):
     curl -sSLO https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/json/municipios.json
     curl -sSLO https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/json/estados.json
     node tools/gerar-municipios.js municipios.json estados.json

   Formato compacto (o original tem 1,5 MB; este, ~200 KB, ~75 KB
   comprimido na transferência):
     estados:    [[sigla, nome], ...]
     municipios: [[nome, índice do estado, lat, lng, (1 se capital)], ...]
   ============================================================= */
const fs = require("fs");
const path = require("path");

const [arqMun, arqEst] = process.argv.slice(2);
if (!arqMun || !arqEst) {
  console.error("uso: node tools/gerar-municipios.js municipios.json estados.json");
  process.exit(1);
}
const ler = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const mun = ler(arqMun);
const est = ler(arqEst).sort((a, b) => a.uf.localeCompare(b.uf));

const idx = new Map(est.map((e, i) => [e.codigo_uf, i]));
const r4 = (n) => Math.round(n * 1e4) / 1e4; // ~11 m: sobra para um mapa de rota

const municipios = mun
  .filter((m) => idx.has(m.codigo_uf) && Number.isFinite(m.latitude) && Number.isFinite(m.longitude))
  .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
  .map((m) => {
    const linha = [m.nome, idx.get(m.codigo_uf), r4(m.latitude), r4(m.longitude)];
    if (m.capital) linha.push(1);
    return linha;
  });

if (municipios.length < 5500) {
  console.error(`só ${municipios.length} municípios — a fonte parece incompleta, nada foi gravado`);
  process.exit(1);
}

const saida = {
  fonte: "IBGE, via github.com/kelvins/municipios-brasileiros (MIT)",
  gerado_em: new Date().toISOString().slice(0, 10),
  estados: est.map((e) => [e.uf, e.nome]),
  municipios,
};
const destino = path.join(__dirname, "..", "assets", "data", "municipios.json");
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(saida));
console.log(`${municipios.length} municípios, ${est.length} estados -> ${destino} ` +
  `(${(fs.statSync(destino).size / 1024).toFixed(0)} KB)`);
