/* =============================================================
   Formulários de diárias:
     1. Origem/Destino com autocomplete de municípios (IBGE)
     2. Mapa da rota, com marcadores e seta do deslocamento
     3. Prévia do valor por pernoite do período

   Origem e destino continuam gravados como TEXTO, no formato que o
   formulário sempre pediu ("Estado, Município"). Recibo, e-mail e
   painel leem esse texto — nada a jusante muda. O que muda é que o
   texto passa a vir de uma lista: sem erro de digitação, sem
   ambiguidade (232 nomes de cidade existem em mais de um estado).
   ============================================================= */
(function () {
  "use strict";

  // Caminhos relativos a ESTE arquivo: funciona de qualquer pasta
  const SCRIPT = document.currentScript ? document.currentScript.src : location.href;
  const URL_BASE = new URL("../data/municipios.json", SCRIPT).href;
  const URL_LEAFLET_JS = new URL("../vendor/leaflet/leaflet.js", SCRIPT).href;
  const URL_LEAFLET_CSS = new URL("../vendor/leaflet/leaflet.css", SCRIPT).href;

  const COR = { primaria: "#1f668d", roxo: "#30256a" }; // paleta do site RBCIP

  /* ---------- utilidades ---------- */
  const norm = (s) => String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const rotulo = (m) => `${m.nome}/${m.uf}`;

  /* ---------- base de municípios ---------- */
  let _base = null;
  function carregarBase() {
    if (!_base) {
      _base = fetch(URL_BASE)
        .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then((j) => {
          const estados = j.estados.map(([sigla, nome]) => ({ sigla, nome }));
          const lista = j.municipios.map(([nome, ie, lat, lng, cap]) => {
            const e = estados[ie];
            const nNome = norm(nome);
            return {
              nome, uf: e.sigla, estado: e.nome, lat, lng, capital: !!cap,
              valor: `${e.nome}, ${nome}`,           // o que é gravado
              nNome,
              pNome: nNome.split(" "),
              palavras: norm(`${nome} ${e.nome} ${e.sigla}`).split(" "),
              nEstado: norm(e.nome),
            };
          });
          const homonimos = {};
          lista.forEach((m) => { homonimos[m.nNome] = (homonimos[m.nNome] || 0) + 1; });
          return { lista, homonimos };
        });
    }
    return _base;
  }

  /* Busca: cada palavra digitada precisa iniciar alguma palavra do nome,
     do estado ou da sigla. "sao luis", "luis ma" e "maranhao, sao luis"
     (o formato antigo) encontram a mesma cidade. Nome que começa com o
     que foi digitado vem antes; capitais desempatam. */
  function buscar(base, consulta, max) {
    const q = norm(consulta);
    if (!q) return [];
    const tokens = q.split(" ");
    const achados = [];
    for (const m of base.lista) {
      if (!tokens.every((t) => m.palavras.some((p) => p.startsWith(t)))) continue;
      const nota = m.nNome === q ? 0
        : m.nNome.startsWith(q) ? 1
        : tokens.every((t) => m.pNome.some((p) => p.startsWith(t))) ? 2 : 3;
      achados.push([nota, m]);
    }
    // Homônimos (mesmo nome) desempatam pelo estado, em ordem alfabética
    achados.sort((a, b) => a[0] - b[0] || b[1].capital - a[1].capital ||
      a[1].nome.localeCompare(b[1].nome, "pt-BR") || a[1].estado.localeCompare(b[1].estado, "pt-BR"));
    return achados.slice(0, max || 8).map((a) => a[1]);
  }

  /* Texto digitado sem escolher na lista: aceita só se for inequívoco.
     Cobre rascunhos antigos ("Maranhão, Codo") e quem digita o nome
     inteiro e sai do campo. */
  function resolver(base, texto) {
    const q = norm(texto);
    if (!q) return null;
    const exatos = base.lista.filter((m) =>
      q === `${m.nEstado} ${m.nNome}` || q === `${m.nNome} ${m.nEstado}` ||
      q === `${m.nNome} ${m.uf.toLowerCase()}`);
    if (exatos.length === 1) return exatos[0];
    const soNome = base.lista.filter((m) => m.nNome === q);
    return soNome.length === 1 ? soNome[0] : null;
  }

  /* ---------- autocomplete (padrão ARIA combobox) ---------- */
  function criarAutocomplete(input, form, aoMudar) {
    const field = input.closest(".field");
    const wrap = document.createElement("div");
    wrap.className = "ac";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const lista = document.createElement("ul");
    lista.className = "ac-lista";
    lista.id = `${input.name}-opcoes`;
    lista.setAttribute("role", "listbox");
    lista.hidden = true;
    wrap.appendChild(lista);

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", lista.id);
    input.setAttribute("autocomplete", "off");
    input.spellcheck = false;

    let base = null;
    let resultados = [];
    let ativo = -1;
    let selecionado = null;
    let programatico = false;

    function abrir() { lista.hidden = false; input.setAttribute("aria-expanded", "true"); }
    function fechar() {
      lista.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      ativo = -1;
    }

    function marcarAtivo(i) {
      ativo = i;
      [...lista.children].forEach((li, k) => li.setAttribute("aria-selected", k === i ? "true" : "false"));
      const li = lista.children[i];
      if (li && li.id) {
        input.setAttribute("aria-activedescendant", li.id);
        // Rola só a lista. scrollIntoView rolaria a página inteira — no
        // celular, com o teclado aberto, a tela pularia a cada seta.
        if (li.offsetTop < lista.scrollTop) lista.scrollTop = li.offsetTop;
        else if (li.offsetTop + li.offsetHeight > lista.scrollTop + lista.clientHeight) {
          lista.scrollTop = li.offsetTop + li.offsetHeight - lista.clientHeight;
        }
      }
    }

    function aviso(texto) {
      lista.innerHTML = "";
      const li = document.createElement("li");
      li.className = "ac-vazio";
      li.textContent = texto;
      lista.appendChild(li);
      resultados = [];
      abrir();
    }

    function renderizar() {
      lista.innerHTML = "";
      resultados.forEach((m, i) => {
        const li = document.createElement("li");
        li.id = `${lista.id}-${i}`;
        li.setAttribute("role", "option");
        const cidade = document.createElement("span");
        cidade.className = "ac-cidade";
        cidade.textContent = m.nome;
        const uf = document.createElement("span");
        uf.className = "ac-uf";
        uf.textContent = `${m.estado} · ${m.uf}`;
        li.append(cidade, uf);
        if (m.capital) {
          const tag = document.createElement("span");
          tag.className = "ac-tag";
          tag.textContent = "capital";
          li.appendChild(tag);
        }
        // mousedown + preventDefault: escolhe sem o campo perder o foco
        li.addEventListener("mousedown", (e) => { e.preventDefault(); selecionar(m); });
        lista.appendChild(li);
      });
      abrir();
      marcarAtivo(resultados.length ? 0 : -1);
    }

    function selecionar(m, silencioso) {
      selecionado = m;
      input.dataset.municipio = `${m.uf}|${m.nome}`;
      delete input.dataset.municipioErro;
      programatico = true;
      input.value = m.valor;
      // Avisa o restante do formulário (rascunho e validação do app.js)
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      programatico = false;
      fechar();
      if (!silencioso) validarCampo(field, form);
      aoMudar(m);
    }

    function limpar() {
      selecionado = null;
      delete input.dataset.municipio;
      aoMudar(null);
    }

    async function pesquisar() {
      const texto = input.value;
      if (!norm(texto)) { fechar(); return; }
      if (!base) {
        aviso("Carregando cidades…");
        try { base = await carregarBase(); } catch (_) { return; }
        if (input.value !== texto) return; // a pessoa continuou digitando
      }
      resultados = buscar(base, texto, 8);
      if (resultados.length) renderizar();
      else aviso("Nenhuma cidade encontrada. Confira a grafia.");
    }

    // Captura: roda ANTES da revalidação do app.js, para ela já ver a
    // seleção desfeita quando a pessoa edita o texto.
    input.addEventListener("input", () => {
      if (programatico) return;
      delete input.dataset.municipioErro;
      if (selecionado) limpar();
      pesquisar();
    }, true);

    input.addEventListener("keydown", (e) => {
      const aberto = !lista.hidden && resultados.length > 0;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!aberto) { pesquisar(); return; }
        marcarAtivo(Math.min(ativo + 1, resultados.length - 1));
      } else if (e.key === "ArrowUp") {
        if (!aberto) return;
        e.preventDefault();
        marcarAtivo(Math.max(ativo - 1, 0));
      } else if (e.key === "Enter") {
        // Com a lista aberta, Enter escolhe — não envia o formulário
        if (aberto && ativo >= 0) { e.preventDefault(); selecionar(resultados[ativo]); }
      } else if (e.key === "Escape") {
        if (!lista.hidden) { e.preventDefault(); fechar(); }
      } else if (e.key === "Tab") {
        if (aberto && ativo >= 0) selecionar(resultados[ativo]);
      }
    });

    input.addEventListener("blur", () => {
      fechar();
      if (!selecionado && base && input.value.trim()) {
        const m = resolver(base, input.value);
        if (m) { selecionar(m); return; }
        const n = base.homonimos[norm(input.value)];
        if (n > 1) input.dataset.municipioErro = `Há ${n} cidades com esse nome — escolha o estado certo na lista.`;
      }
      // O app.js valida no blur antes deste ponto; revalida com o estado final
      validarCampo(field, form);
    });

    return {
      // Rascunho restaurado: tenta reconhecer o texto já preenchido
      async iniciar() {
        try { base = await carregarBase(); } catch (_) { return; }
        if (!selecionado && input.value.trim()) {
          const m = resolver(base, input.value);
          if (m) selecionar(m, true);
        }
      },
      // Base indisponível: volta ao texto livre para não travar o envio
      liberarTextoLivre() {
        input.dataset.municipioLivre = "1";
        const hint = field.querySelector(".hint");
        if (hint) hint.textContent = "Não foi possível carregar a lista de cidades. Digite no formato: Estado, Município.";
      },
      limpar() { fechar(); limpar(); delete input.dataset.municipioErro; },
    };
  }

  /* ---------- mapa da rota ---------- */
  let _leaflet = null;
  function carregarLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!_leaflet) {
      _leaflet = new Promise((ok, falha) => {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = URL_LEAFLET_CSS;
        document.head.appendChild(css);
        const s = document.createElement("script");
        s.src = URL_LEAFLET_JS;
        s.onload = () => (window.L ? ok(window.L) : falha(new Error("Leaflet ausente")));
        s.onerror = () => falha(new Error("falha ao carregar o Leaflet"));
        document.head.appendChild(s);
      });
    }
    return _leaflet;
  }

  function criarRota(depoisDe) {
    const box = document.createElement("div");
    box.className = "rota";
    box.hidden = true;
    box.innerHTML =
      '<div class="rota-cab"><span class="rota-trecho"></span><span class="rota-nota"></span></div>' +
      '<div class="rota-mapa" role="img"></div>';
    depoisDe.insertAdjacentElement("afterend", box);
    const trecho = box.querySelector(".rota-trecho");
    const nota = box.querySelector(".rota-nota");
    const div = box.querySelector(".rota-mapa");

    let mapa = null, camada = null, enquadrar = () => {};
    let origem = null, destino = null;
    let semMapa = false;

    function montarMapa(L) {
      mapa = L.map(div, {
        scrollWheelZoom: false,          // rolar a página não dá zoom no mapa
        dragging: !L.Browser.mobile,     // no celular, um dedo rola a página
        zoomSnap: 0.25,
      });
      // Mosaicos do próprio OpenStreetMap: dispensam chave de API. A política
      // de uso aceita sites de baixo volume que exibem o crédito abaixo.
      // (O CARTO, usado antes, passou a exigir chave.)
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(mapa);
      camada = L.layerGroup().addTo(mapa);
      // Vista inicial obrigatória: sem ela o Leaflet adia a criação das
      // camadas, e o avião nasceria sem elemento para girar.
      mapa.setView([-14.2, -51.9], 4, { animate: false });
      // O formulário pode começar oculto (tela de login) e o mapa nasce
      // sem tamanho; recalcula sempre que a área muda.
      if (window.ResizeObserver) {
        new ResizeObserver(() => { mapa.invalidateSize(); enquadrar(); }).observe(div);
      }
      // Animação só enquanto o mapa está na tela: fora dela, nada roda
      // (poupa bateria no celular).
      if (window.IntersectionObserver) {
        new IntersectionObserver(([e]) => {
          emTela = e.isIntersecting;
          if (emTela) rodarVoo(); else pararVoo();
        }).observe(div);
      }
    }

    // Arco suave entre os pontos (curva de Bézier no plano do mapa) —
    // separa visualmente a rota de estradas e rios do fundo. Devolve os
    // pontos da linha e, para o avião, a posição e a direção em cada t.
    function curva(L, a, b) {
      const z = 8;
      const pa = mapa.project([a.lat, a.lng], z), pb = mapa.project([b.lat, b.lng], z);
      const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy);
      let nx = -dy / d, ny = dx / d;
      if (ny > 0) { nx = -nx; ny = -ny; }               // curva sempre para cima
      const c = L.point((pa.x + pb.x) / 2 + nx * d * 0.2, (pa.y + pb.y) / 2 + ny * d * 0.2);
      const ponto = (t) => {
        const u = 1 - t;
        return mapa.unproject(L.point(
          u * u * pa.x + 2 * u * t * c.x + t * t * pb.x,
          u * u * pa.y + 2 * u * t * c.y + t * t * pb.y), z);
      };
      // Direção = derivada da curva. No plano do mapa o ângulo não muda
      // com o zoom, então serve em qualquer aproximação.
      const angulo = (t) => {
        const tx = 2 * (1 - t) * (c.x - pa.x) + 2 * t * (pb.x - c.x);
        const ty = 2 * (1 - t) * (c.y - pa.y) + 2 * t * (pb.y - c.y);
        return (Math.atan2(ty, tx) * 180) / Math.PI;
      };
      const pts = [];
      for (let i = 0; i <= 48; i++) pts.push(ponto(i / 48));
      return { pts, ponto, angulo };
    }

    /* ---------- avião: percorre o arco da origem ao destino ----------
       Ícone "flight" do Material Design (Apache 2.0), com o nariz para
       cima — daí o +90° na rotação. */
    const SVG_AVIAO =
      '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">' +
      '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>' +
      "</svg>";
    const VOO_MS = 3400;     // duração da travessia
    const PAUSA_MS = 800;    // intervalo antes de decolar de novo
    let voo = null;          // { curva, marcador, svg, quadro }
    let emTela = true;

    function pararVoo() {
      if (voo && voo.quadro) cancelAnimationFrame(voo.quadro);
      if (voo) voo.quadro = null;
    }

    function posicionarAviao(t, opacidade) {
      voo.marcador.setLatLng(voo.curva.ponto(t));
      voo.svg.style.transform = `rotate(${voo.curva.angulo(t) + 90}deg)`;
      voo.marcador.setOpacity(opacidade);
    }

    function rodarVoo() {
      if (!voo || voo.quadro || voo.estatico || !emTela) return;
      let inicio = null;
      const quadro = (agora) => {
        if (inicio === null) inicio = agora;
        const decorrido = (agora - inicio) % (VOO_MS + PAUSA_MS);
        if (decorrido >= VOO_MS) {
          voo.marcador.setOpacity(0);               // pousou: espera e decola
        } else {
          const p = decorrido / VOO_MS;
          // Acelera na decolagem e desacelera no pouso
          const t = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          // Surge na origem e some ao chegar ao destino
          posicionarAviao(t, Math.max(0, Math.min(1, p / 0.08, (1 - p) / 0.12)));
        }
        voo.quadro = requestAnimationFrame(quadro);
      };
      voo.quadro = requestAnimationFrame(quadro);
    }

    function iniciarVoo(L, c) {
      const marcador = L.marker(c.ponto(0.5), {
        icon: L.divIcon({ className: "rota-aviao", html: SVG_AVIAO, iconSize: [30, 30], iconAnchor: [15, 15] }),
        interactive: false, keyboard: false, zIndexOffset: 1000,
      }).addTo(camada);
      voo = { curva: c, marcador, svg: marcador.getElement().firstElementChild, quadro: null };
      // Quem pede menos movimento no sistema vê o avião parado no meio da
      // rota, ainda indicando o sentido da viagem.
      const reduzir = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduzir) { voo.estatico = true; posicionarAviao(0.5, 1); return; }
      rodarVoo();
    }

    function desenhar(L) {
      pararVoo();
      voo = null;
      camada.clearLayers();
      const pontos = [origem, destino].filter(Boolean);
      const mesmo = origem && destino && origem.uf === destino.uf && origem.nome === destino.nome;

      let htmlO = origem ? `<small>Origem</small>${esc(rotulo(origem))}` : "";
      let htmlD = destino ? `<small>Destino</small>${esc(rotulo(destino))}` : "";
      let classeRotulo = "rota-rotulo";
      // Sem espaço para o nome por extenso, o rótulo diz só o papel do
      // ponto — o nome completo já está no cabeçalho, logo acima do mapa.
      const encurtar = () => {
        htmlO = "<small>Origem</small>";
        htmlD = "<small>Destino</small>";
        classeRotulo = "rota-rotulo rota-rotulo--curto";
      };
      // Largura real de um rótulo, medida antes de posicioná-lo
      const larguraRotulo = (html) => {
        const s = document.createElement("div");
        s.className = "leaflet-tooltip rota-rotulo";
        s.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0";
        s.innerHTML = html;
        div.appendChild(s);
        const w = s.offsetWidth;
        s.remove();
        return w;
      };

      // Rótulos do lado oposto à rota, para não cobrirem o trajeto do avião
      const deslocar = (lado) => ({ left: [-9, 0], right: [9, 0], top: [0, -9], bottom: [0, 9] })[lado];
      let ladoO = "top", ladoD = "top"; // um ponto só: rótulo centrado acima
      if (origem && destino && !mesmo) {
        const pa = mapa.project([origem.lat, origem.lng], 8), pb = mapa.project([destino.lat, destino.lng], 8);
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const W = div.clientWidth;
        if (Math.abs(dx) >= Math.abs(dy)) {
          // Rota horizontal: rótulos nas pontas, lado a lado
          if (larguraRotulo(htmlO) + larguraRotulo(htmlD) + 90 > W) encurtar();
          ladoO = dx > 0 ? "left" : "right";
          ladoD = dx > 0 ? "right" : "left";
        } else {
          // Rota vertical: rótulos acima e abaixo, centrados no ponto
          if (Math.max(larguraRotulo(htmlO), larguraRotulo(htmlD)) > W * 0.8) encurtar();
          ladoO = dy > 0 ? "top" : "bottom";
          ladoD = dy > 0 ? "bottom" : "top";
        }
      } else if (origem || destino) {
        // Um ponto só (ou o mesmo município): rótulo centrado acima
        if (larguraRotulo(htmlO || htmlD) > div.clientWidth * 0.8) encurtar();
      }

      const rotulos = []; // { tip, lado } — medidos no enquadramento
      let pts = pontos.map((m) => L.latLng(m.lat, m.lng));
      if (origem && destino && !mesmo) {
        const c = curva(L, origem, destino);
        pts = c.pts;
        L.polyline(pts, {
          color: COR.primaria, weight: 3, opacity: 0.75, dashArray: "8 7",
          lineCap: "round", interactive: false, noClip: true,
        }).addTo(camada);
        iniciarVoo(L, c);
      }
      if (origem) {
        const mo = L.circleMarker([origem.lat, origem.lng], {
          radius: 7, color: COR.primaria, weight: 3, fillColor: "#ffffff", fillOpacity: 1,
        }).bindTooltip(htmlO, {
          permanent: true, direction: ladoO, offset: deslocar(ladoO),
          className: classeRotulo,
        }).addTo(camada);
        rotulos.push({ tip: mo.getTooltip(), lado: ladoO });
      }
      if (destino && !mesmo) {
        const md = L.circleMarker([destino.lat, destino.lng], {
          radius: 7, color: "#ffffff", weight: 3, fillColor: COR.roxo, fillOpacity: 1,
        }).bindTooltip(htmlD, {
          permanent: true, direction: ladoD, offset: deslocar(ladoD),
          className: classeRotulo + " rota-rotulo--destino",
        }).addTo(camada);
        rotulos.push({ tip: md.getTooltip(), lado: ladoD });
      }

      enquadrar = () => {
        // Oculto (tela de login, ou caixa recolhida): tamanho zero faria o
        // fitBounds calcular zoom inválido. O ResizeObserver chama de novo.
        if (!pts.length || !div.clientWidth || !div.clientHeight) return;
        if (pts.length === 1) { mapa.setView(pts[0], 7, { animate: false }); return; }
        // Reserva nas bordas o tamanho REAL de cada rótulo, do lado em que
        // ele fica — margem fixa cortava nomes longos e rotas verticais.
        const pad = { top: 24, bottom: 24, left: 24, right: 24 };
        rotulos.forEach(({ tip, lado }) => {
          const el = tip && tip.getElement();
          if (!el) return;
          const w = el.offsetWidth + 18, h = el.offsetHeight + 18;
          if (lado === "left" || lado === "right") {
            pad[lado] = Math.max(pad[lado], w);
            pad.top = Math.max(pad.top, h / 2);       // rótulo lateral é centrado na vertical
            pad.bottom = Math.max(pad.bottom, h / 2);
          } else {
            pad[lado] = Math.max(pad[lado], h);
            pad.left = Math.max(pad.left, w / 2);     // e o de cima/baixo, na horizontal
            pad.right = Math.max(pad.right, w / 2);
          }
        });
        const mx = div.clientWidth * 0.42, my = div.clientHeight * 0.42;
        mapa.fitBounds(L.latLngBounds(pts), {
          paddingTopLeft: [Math.min(pad.left, mx), Math.min(pad.top, my)],
          paddingBottomRight: [Math.min(pad.right, mx), Math.min(pad.bottom, my)],
          maxZoom: 12, animate: false,   // cidades vizinhas ganham zoom para se separar
        });
      };
      enquadrar();
    }

    function atualizarTexto() {
      const mesmo = origem && destino && origem.uf === destino.uf && origem.nome === destino.nome;
      if (origem && destino) {
        trecho.innerHTML = `<b>${esc(rotulo(origem))}</b> <span class="rota-flecha" aria-hidden="true">→</span> <b>${esc(rotulo(destino))}</b>`;
        nota.textContent = mesmo ? "Origem e destino são o mesmo município." : "";
        div.setAttribute("aria-label", `Mapa da rota de ${rotulo(origem)} a ${rotulo(destino)}`);
      } else {
        const m = origem || destino;
        trecho.innerHTML = `<b>${esc(rotulo(m))}</b>`;
        nota.textContent = origem ? "Informe o destino para ver a rota." : "Informe a origem para ver a rota.";
        div.setAttribute("aria-label", `Mapa com ${rotulo(m)}`);
      }
    }

    function atualizar() {
      if (!origem && !destino) { box.hidden = true; return; }
      box.hidden = false;
      atualizarTexto();
      if (semMapa) return;
      carregarLeaflet().then((L) => {
        if (!mapa) montarMapa(L);
        desenhar(L);
      }).catch((e) => {
        // Sem a biblioteca, fica o trecho em texto no cabeçalho
        console.error("mapa da rota:", e);
        semMapa = true;
        div.hidden = true;
      });
    }

    return {
      origem(m) { origem = m; atualizar(); },
      destino(m) { destino = m; atualizar(); },
    };
  }

  /* ---------- resumo da distribuição das diárias ---------- */
  const brl = (cent) => (cent / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // "2026-11-18" é data de calendário: trata em UTC para não voltar um
  // dia na conversão de fuso (o mesmo cuidado do recibo).
  function lerData(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const DIA = 86400000;
  // Sem o ano: ele já está nos campos de período, e a coluna precisa
  // caber na largura do celular.
  const fmtDia = (t) => new Date(t).toLocaleDateString("pt-BR", {
    timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit",
  });

  /* Divide o total igualmente pelos pernoites, em centavos. Quando a
     divisão não é exata (R$ 1.000 em 3 noites), os centavos que sobram vão
     um a um para as primeiras noites: a soma bate EXATAMENTE com o valor
     informado e nenhuma noite difere mais de 1 centavo das outras. */
  function distribuir(totalCent, n) {
    const base = Math.floor(totalCent / n);
    const sobra = totalCent - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < sobra ? 1 : 0));
  }

  /* Prévia para a pessoa ter noção do valor por pernoite. Não entra nos
     dados da solicitação: fica fora de qualquer .field.
     Pernoites = data final menos data inicial: de 18 a 22/11 são 4 noites
     (18, 19, 20 e 21). Cada linha é identificada pela data em que a noite
     começa, como nas reservas de hotel. */
  function criarResumo(form, depoisDe) {
    const ini = form.querySelector('[name="periodo_inicial"]');
    const fim = form.querySelector('[name="periodo_final"]');
    const valor = form.querySelector('[name="valor"]');
    if (!ini || !fim || !valor) return { atualizar() {} };

    const box = document.createElement("div");
    box.className = "resumo-diarias";
    box.hidden = true;
    box.innerHTML =
      "<h3>Resumo das diárias</h3>" +
      '<p class="rd-linha" aria-live="polite"></p>' +
      '<div class="rd-tabela-wrap"><table class="rd-tabela"><thead><tr>' +
      '<th scope="col" class="c-num">Nº</th><th scope="col">Noite de</th><th scope="col" class="num">Valor</th>' +
      "</tr></thead><tbody></tbody><tfoot></tfoot></table></div>" +
      '<p class="rd-nota">Prévia para conferência — o valor enviado é o total informado acima.</p>';
    depoisDe.insertAdjacentElement("afterend", box);

    const linha = box.querySelector(".rd-linha");
    const wrapTabela = box.querySelector(".rd-tabela-wrap");
    const tbody = box.querySelector("tbody");
    const tfoot = box.querySelector("tfoot");

    function mensagem(texto) {
      linha.textContent = texto;
      linha.classList.add("rd-linha--aviso");
      wrapTabela.hidden = true;
    }

    function atualizar() {
      const v = (valor.value || "").trim();
      // Aparece quando o valor total é preenchido
      if (!/^\d{1,3}(\.\d{3})*,\d{2}$/.test(v) || !/[1-9]/.test(v)) { box.hidden = true; return; }
      box.hidden = false;
      linha.classList.remove("rd-linha--aviso");
      const totalCent = parseInt(v.replace(/\D/g, ""), 10);

      const a = lerData(ini.value), b = lerData(fim.value);
      if (a == null || b == null) { mensagem("Informe o período inicial e final para ver a distribuição por pernoite."); return; }
      if (b < a) { mensagem("A data final está antes da inicial — confira o período."); return; }
      const n = Math.round((b - a) / DIA);
      if (n === 0) { mensagem("Ida e volta no mesmo dia: não há pernoite para distribuir o valor."); return; }
      if (n > 92) { mensagem(`O período tem ${n} pernoites. Confira as datas informadas.`); return; }

      wrapTabela.hidden = false;
      const valores = distribuir(totalCent, n);
      const exato = totalCent % n === 0;
      linha.textContent =
        `${n} ${n === 1 ? "pernoite" : "pernoites"} · ${exato ? "" : "≈ "}${brl(Math.round(totalCent / n))} por pernoite`;

      tbody.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const t = a + i * DIA;
        const dow = new Date(t).getUTCDay();
        const tr = document.createElement("tr");
        if (dow === 0 || dow === 6) tr.className = "rd-fds";
        tr.innerHTML =
          `<td class="c-num">${i + 1}</td><td>${esc(fmtDia(t))}</td>` +
          `<td class="num">${esc(brl(valores[i]))}</td>`;
        tbody.appendChild(tr);
      }
      // Sem colspan: a coluna Nº some no celular, e colspan desalinharia
      tfoot.innerHTML =
        `<tr><td class="c-num"></td><th scope="row">Total</th>` +
        `<td class="num">${esc(brl(totalCent))}</td></tr>`;
    }

    [ini, fim, valor].forEach((el) => {
      el.addEventListener("input", atualizar);
      el.addEventListener("change", atualizar);
    });
    return { atualizar };
  }

  /* ---------- ponto de entrada ---------- */
  window.ativarDiarias = function () {
    const form = document.getElementById("form");
    if (!form) return;
    const inOrigem = form.querySelector('[name="origem"]');
    const inDestino = form.querySelector('[name="destino"]');

    let rota = null;
    const acs = [];
    if (inOrigem && inDestino) {
      rota = criarRota(inDestino.closest(".field"));
      acs.push(criarAutocomplete(inOrigem, form, (m) => rota.origem(m)));
      acs.push(criarAutocomplete(inDestino, form, (m) => rota.destino(m)));
      // A base é pequena (~75 KB comprimida) e este formulário depende
      // dela: carrega já, para a primeira tecla não esperar.
      carregarBase()
        .then(() => acs.forEach((ac) => ac.iniciar()))
        .catch((e) => {
          console.error("base de municípios:", e);
          acs.forEach((ac) => ac.liberarTextoLivre());
        });
    }

    const campoValor = form.querySelector('[name="valor"]');
    const resumo = criarResumo(form, campoValor ? campoValor.closest(".field") : form.lastElementChild);
    resumo.atualizar(); // rascunho restaurado

    // "Limpar": o reset nativo só zera os campos; o resto acompanha
    form.addEventListener("reset", () => {
      setTimeout(() => {
        acs.forEach((ac) => ac.limpar());
        resumo.atualizar();
      }, 0);
    });
  };
})();
