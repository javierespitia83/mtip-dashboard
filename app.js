(() => {
  "use strict";

  const SERVER_GUIDANCE = "Abre el dashboard con un servidor: ejecuta python3 -m http.server en la raíz del proyecto y entra a http://localhost:8000/MTIP_APP/.";
  const GROUP_LABELS = {
    sin_sitio: "Sin sitio",
    revision_manual: "Revisión manual",
    sin_clasificar: "Sin API",
    api_sin_cosecha: "API sin cosecha",
    ok: "Sin acción pendiente",
  };
  const GROUP_COLORS = {
    sin_sitio: "#B4483F",
    revision_manual: "#D69E00",
    sin_clasificar: "#6686a4",
    api_sin_cosecha: "#8876a5",
    ok: "#395B0C",
  };
  const PLATFORM_COLORS = { api: "#6DB500", sin_clasificar: "#7390a8", sin_sitio: "#E0A400" };
  const NUMBER = new Intl.NumberFormat("es-CO");
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let municipalities = [];
  let summary = null;
  let selectedMunicipality = null;
  let suggestionIndex = -1;
  let riskVisible = 100;
  let matrixVisible = 60;

  function node(tag, className = "", text = "") {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined && text !== null) item.textContent = String(text);
    return item;
  }

  function appendText(parent, tag, text, className = "") {
    const item = node(tag, className, text);
    parent.append(item);
    return item;
  }

  function formatNumber(value) {
    return value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
      ? "—" : NUMBER.format(Number(value));
  }

  function formatPercent(value, digits = 1) {
    return `${(Number(value || 0) * 100).toLocaleString("es-CO", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
  }

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  }

  function clear(element) {
    element.replaceChildren();
  }

  function safeUrl(value) {
    if (!value) return "";
    try {
      const parsed = new URL(String(value), window.location.href);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
    } catch (_) {
      return "";
    }
  }

  function addLink(parent, label, value, className = "", newTab = true) {
    const href = safeUrl(value);
    if (!href) return null;
    const anchor = node("a", className, label);
    anchor.href = href;
    if (newTab) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    parent.append(anchor);
    return anchor;
  }

  async function loadData() {
    if (window.location.protocol === "file:") throw new Error(SERVER_GUIDANCE);
    const [municipalityResponse, summaryResponse] = await Promise.all([
      fetch("dashboard_data/municipios.json", { cache: "no-store" }),
      fetch("dashboard_data/resumen.json", { cache: "no-store" }),
    ]);
    if (!municipalityResponse.ok || !summaryResponse.ok) throw new Error(SERVER_GUIDANCE);
    const [items, totals] = await Promise.all([municipalityResponse.json(), summaryResponse.json()]);
    return { municipios: items, resumen: totals };
  }

  const GROUPS = {
    inicio: { label: "Inicio", views: ["novedades", "resumen"] },
    semana: { label: "Esta semana", views: ["semana", "validacion"] },
    municipios: { label: "Municipios", views: ["buscador", "pendientes"] },
    cobertura: { label: "Cobertura", views: ["entregables", "calidad", "salud"] },
  };
  const VIEW_LABELS = { novedades: "Novedades", resumen: "Resumen operativo", entregables: "Entregables", semana: "Cambios de la semana", validacion: "Validar documentos", buscador: "Buscar un municipio", pendientes: "Lista de municipios", calidad: "Plataforma y calidad", salud: "Salud tributaria" };
  const groupOf = (view) => Object.keys(GROUPS).find((key) => GROUPS[key].views.includes(view)) || "inicio";

  // Modo Cliente (lo que se vende) / Operacion (estadisticas internas de recoleccion)
  const OP_VIEWS = new Set(["resumen", "semana", "validacion", "pendientes", "entregables", "calidad", "salud"]);
  let mode = "cliente";
  try { mode = localStorage.getItem("mtip-modo") === "operacion" ? "operacion" : "cliente"; } catch { /* sin almacenamiento */ }
  if (/[?&]modo=operacion/.test(window.location.search)) mode = "operacion";
  const visibleViews = (group) => GROUPS[group].views.filter((v) => mode === "operacion" || !OP_VIEWS.has(v));

  function setMode(next) {
    mode = next === "operacion" ? "operacion" : "cliente";
    document.body.dataset.mode = mode;
    try { localStorage.setItem("mtip-modo", mode); } catch { /* sin almacenamiento */ }
    $$("[data-mode-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modeSet === mode)));
    const current = (window.location.hash || "").replace("#", "").split("/")[0];
    activateTab(current && $(`#view-${current}`) ? current : "novedades");
    if (selectedMunicipality && $("#view-buscador").classList.contains("active")) showMunicipality(selectedMunicipality);
  }

  function activateTab(name) {
    if (mode === "cliente" && OP_VIEWS.has(name)) name = "novedades";
    const view = $(`#view-${name}`);
    if (!view) return;
    const group = groupOf(name);
    $$(".view").forEach((item) => item.classList.toggle("active", item === view));
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.group === group));
    $("#subtabs").hidden = visibleViews(group).length < 2;
    $$(".subtab").forEach((item) => {
      item.hidden = item.dataset.group !== group;
      item.classList.toggle("active", item.dataset.tab === name);
    });
    $("#topbar-section").textContent = visibleViews(group).length < 2 ? GROUPS[group].label : `${GROUPS[group].label} · ${VIEW_LABELS[name]}`;
    const keep = name === "buscador" && selectedMunicipality ? `#buscador/${selectedMunicipality.divipola}` : `#${name}`;
    if (window.location.hash !== keep) history.replaceState(null, "", keep);
    if (name === "pendientes") renderPendingTable();
  }

  function navigatePending(filter) {
    activateTab("pendientes");
    const select = $("#group-filter");
    if (select) select.value = filter || "all";
    renderPendingTable();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function kpiCard({ label, value, foot, color, filter }) {
    const button = node("button", "kpi-card");
    button.type = "button";
    button.style.setProperty("--kpi-color", color);
    button.setAttribute("aria-label", `${label}: ${formatNumber(value)}. Ver municipios relacionados.`);
    const title = node("span", "kpi-label");
    appendText(title, "i", "", "kpi-marker");
    appendText(title, "span", label);
    button.append(title);
    appendText(button, "strong", formatNumber(value), "kpi-value");
    appendText(button, "span", foot, "kpi-foot");
    appendText(button, "span", "↗", "kpi-arrow");
    button.addEventListener("click", () => navigatePending(filter));
    return button;
  }

  function renderKpis() {
    const totals = summary.totales;
    const unclassifiedWork = summary.grupo_trabajo.find((item) => item.nombre === "sin_clasificar")?.cantidad || 0;
    const reviewWork = summary.grupo_trabajo.find((item) => item.nombre === "revision_manual")?.cantidad || 0;
    const unclassifiedFoot = totals.sin_clasificar !== unclassifiedWork
      ? `${formatNumber(totals.sin_clasificar)} sitios; ${formatNumber(reviewWork)} priorizados para revisión manual`
      : "Con sitio; se recolectan con otra técnica";
    const container = $("#summary-kpis");
    clear(container);
    const cards = [
      { label: "Municipios en registro", value: totals.municipios, foot: "Ver cola completa", color: "#395B0C", filter: "all" },
      { label: "Sitio identificado", value: totals.identificados, foot: `${formatPercent(totals.porcentaje_identificados)} del registro`, color: "#6DB500", filter: "identificado" },
      { label: "Sin sitio hallado", value: totals.pendientes, foot: "Revisar candidatos y fuentes", color: "#B4483F", filter: "sin_sitio" },
      { label: "Con API", value: totals.api, foot: `${formatPercent(totals.porcentaje_api)} del registro`, color: "#2D3431", filter: "api" },
      { label: "Sin API", value: totals.sin_clasificar, foot: unclassifiedFoot, color: "#8393a1", filter: "sin_clasificar" },
    ];
    cards.forEach((card) => container.append(kpiCard(card)));
  }

  function renderFunnel() {
    const totals = summary.totales;
    $("#funnel-universe").textContent = `De ${formatNumber(totals.municipios)} municipios`;
    const steps = [
      { label: "Municipios del alcance", value: totals.municipios, color: "#141817", filter: "all" },
      { label: "Con sitio identificado", value: totals.identificados, color: "#528902", filter: "identificado" },
      { label: "Con API Mi Colombia Digital", value: totals.api, color: "#6DB500", filter: "api" },
      { label: "Calendario confirmado", value: totals.calendario_confirmado, color: "#ADFB20", filter: "api" },
    ];
    const container = $("#funnel");
    clear(container);
    for (const step of steps) {
      const row = node("button", "funnel-row");
      row.type = "button";
      row.title = "Ver municipios relacionados en la tabla";
      row.style.width = "100%";
      row.style.padding = "0";
      row.style.border = "0";
      row.style.background = "transparent";
      row.style.textAlign = "left";
      const label = appendText(row, "span", step.label, "funnel-label");
      const track = node("span", "funnel-track");
      const fill = node("span", "funnel-fill");
      fill.style.width = `${totals.municipios ? (step.value / totals.municipios) * 100 : 0}%`;
      fill.style.setProperty("--funnel-color", step.color);
      track.append(fill);
      row.append(track);
      appendText(row, "strong", formatNumber(step.value), "funnel-value");
      row.addEventListener("click", () => navigatePending(step.filter));
      row.setAttribute("aria-label", `${label.textContent}: ${formatNumber(step.value)}; ver relacionados`);
      container.append(row);
    }
  }

  function renderGroupSummary() {
    const container = $("#summary-groups");
    clear(container);
    const pendingGroups = summary.grupo_trabajo.filter((item) => item.nombre !== "ok");
    pendingGroups.forEach((item) => {
      const row = node("button", "group-row");
      row.type = "button";
      row.style.width = "100%";
      row.style.textAlign = "left";
      row.style.background = "transparent";
      row.style.border = "0";
      row.style.cursor = "pointer";
      row.style.setProperty("--group-color", GROUP_COLORS[item.nombre] || "#6DB500");
      appendText(row, "i", "", "group-dot");
      appendText(row, "span", GROUP_LABELS[item.nombre] || item.nombre, "group-label");
      appendText(row, "strong", formatNumber(item.cantidad), "group-count");
      row.addEventListener("click", () => navigatePending(item.nombre));
      container.append(row);
    });
  }

  function renderDepartmentChart() {
    const legend = $("#department-legend");
    clear(legend);
    const categories = [
      { key: "api", label: "Con API", color: "#6DB500" },
      { key: "sin_api", label: "Sitio sin API", color: "#aebec8" },
      { key: "pendientes", label: "Sin sitio", color: "#E0A400" },
    ];
    categories.forEach((item) => {
      const wrapper = node("span", "legend-item");
      const swatch = node("i");
      swatch.style.setProperty("--legend-color", item.color);
      wrapper.append(swatch);
      appendText(wrapper, "span", item.label);
      legend.append(wrapper);
    });

    const data = summary.por_departamento;
    const margin = { left: 150, right: 54, top: 6, bottom: 20 };
    const plotWidth = 540;
    const rowHeight = 19;
    const gap = 6;
    const width = margin.left + plotWidth + margin.right;
    const height = margin.top + data.length * (rowHeight + gap) + margin.bottom;
    const maximum = Math.max(1, ...data.map((item) => item.municipios));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Municipios por departamento, separados por plataforma y estado de sitio");
    svg.classList.add("department-svg");
    const scale = plotWidth / maximum;

    data.forEach((item, index) => {
      const y = margin.top + index * (rowHeight + gap);
      const text = document.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("x", String(margin.left - 10));
      text.setAttribute("y", String(y + 13));
      text.setAttribute("text-anchor", "end");
      text.textContent = item.departamento;
      svg.append(text);
      let x = margin.left;
      const pieces = [
        { count: item.api, color: "#6DB500", title: "Con API" },
        { count: Math.max(0, item.identificados - item.api), color: "#aebec8", title: "Sitio identificado sin API" },
        { count: item.pendientes, color: "#E0A400", title: "Sin sitio hallado" },
      ];
      pieces.forEach((piece) => {
        const barWidth = piece.count * scale;
        if (barWidth <= 0) return;
        const rect = document.createElementNS(svg.namespaceURI, "rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(y + 2));
        rect.setAttribute("width", String(barWidth));
        rect.setAttribute("height", "13");
        rect.setAttribute("rx", "3");
        rect.setAttribute("fill", piece.color);
        const title = document.createElementNS(svg.namespaceURI, "title");
        title.textContent = `${item.departamento}: ${piece.title}, ${formatNumber(piece.count)}`;
        rect.append(title);
        svg.append(rect);
        x += barWidth;
      });
      const total = document.createElementNS(svg.namespaceURI, "text");
      total.setAttribute("x", String(Math.min(width - 4, margin.left + item.municipios * scale + 7)));
      total.setAttribute("y", String(y + 13));
      total.textContent = formatNumber(item.municipios);
      svg.append(total);
    });
    const axis = document.createElementNS(svg.namespaceURI, "text");
    axis.setAttribute("x", String(margin.left));
    axis.setAttribute("y", String(height - 2));
    axis.classList.add("axis-text");
    axis.textContent = "Número de municipios";
    svg.append(axis);
    const container = $("#department-chart");
    clear(container);
    container.append(svg);
  }

  function renderBarList(containerId, rows, options = {}) {
    const container = $(containerId);
    clear(container);
    if (!rows || !rows.length) {
      appendText(container, "p", "Sin datos disponibles.", "panel-description");
      return;
    }
    const max = Math.max(1, ...rows.map((item) => Number(item[options.valueKey || "cantidad"] || 0)));
    rows.forEach((item) => {
      const value = Number(item[options.valueKey || "cantidad"] || 0);
      const row = node("div", "bar-row");
      const labelBox = node("div");
      appendText(labelBox, "span", item[options.labelKey || "nombre"], "bar-label");
      if (item.total !== undefined && options.showPercent) {
        appendText(labelBox, "div", `${formatPercent(item.porcentaje)} del total`, "bar-subtitle");
      }
      row.append(labelBox);
      const track = node("span", "bar-track");
      const fill = node("span", "bar-fill");
      fill.style.width = `${Math.max(0, (value / max) * 100)}%`;
      fill.style.setProperty("--bar-color", item.color || options.color || "#6DB500");
      track.append(fill);
      row.append(track);
      appendText(row, "strong", formatNumber(value) + (options.suffix || ""), "bar-value");
      container.append(row);
    });
  }

  function renderPlatformQuality() {
    const total = summary.totales.municipios;
    const platformRows = [
      { nombre: "Mi Colombia Digital · API", cantidad: summary.totales.api, color: "#6DB500" },
      { nombre: "Sin API (otra técnica)", cantidad: summary.totales.sin_clasificar, color: "#7390a8" },
      { nombre: "Sin sitio hallado", cantidad: summary.totales.pendientes, color: "#E0A400" },
    ];
    renderBarList("#platform-bars", platformRows);
    const breakdown = $("#platform-breakdown");
    clear(breakdown);
    summary.sin_clasificar_desglose.forEach((item) => {
      const chip = node("span", "sub-chip");
      appendText(chip, "span", item.nombre);
      appendText(chip, "strong", formatNumber(item.cantidad));
      breakdown.append(chip);
    });
    const withoutTechnique = (summary.sin_clasificar_desglose.find((item) => item.nombre === "Sin técnica asignada") || {}).cantidad || 0;
    $("#platform-breakdown-note").textContent = `Los ${formatNumber(summary.totales.sin_clasificar)} municipios sin API se agrupan por la técnica con la que se recolectarán (columna «Adaptador» del Excel). ${withoutTechnique ? `${formatNumber(withoutTechnique)} sin técnica asignada.` : "Todos tienen técnica asignada."}`;
    renderBarList("#confidence-bars", summary.por_confianza);
    renderBarList("#method-bars", summary.por_metodo_hallazgo.slice(0, 14));
    renderBarList("#population-bars", summary.por_rango_poblacion);
    $("#platform-bars").setAttribute("aria-label", `Clasificación de plataforma, base de ${formatNumber(total)} municipios`);
  }

  function addRiskTableRows(rows) {
    const body = $("#risk-table-body");
    clear(body);
    rows.slice(0, riskVisible).forEach((row) => {
      const tr = node("tr");
      const nameCell = node("td");
      appendText(nameCell, "strong", `${row.municipio} · ${row.divipola}`, "table-name");
      tr.append(nameCell);
      appendText(tr, "td", row.departamento);
      appendText(tr, "td", row.dias_desde_ultima === null ? "Sin fecha" : `${formatNumber(row.dias_desde_ultima)} días`);
      appendText(tr, "td", row.calendario_vigente || "Sin dato");
      appendText(tr, "td", row.motivos.join(" · "));
      const linkCell = node("td");
      const link = addLink(linkCell, "Normatividad", row.url_normativa || row.sitio_url);
      if (!link) linkCell.textContent = "Sin enlace";
      tr.append(linkCell);
      body.append(tr);
    });
    if (rows.length > riskVisible) {
      const tr = node("tr");
      const td = node("td");
      td.colSpan = 6;
      const more = node("button", "text-button", `Mostrar los siguientes ${formatNumber(Math.min(100, rows.length - riskVisible))}`);
      more.type = "button";
      more.addEventListener("click", () => {
        riskVisible = Math.min(rows.length, riskVisible + 100);
        addRiskTableRows(rows);
      });
      td.append(more);
      tr.append(td);
      body.append(tr);
    }
  }

  function renderHealth() {
    renderBarList("#freshness-bars", summary.por_frescura, { color: "#2D3431" });
    $("#freshness-cutoff").textContent = `Snapshot cutoff: ${summary.fecha_corte_snapshot || "unavailable"}`;
    const calendarColors = { "Sí": "#395B0C", "Probable": "#D69E00", "No": "#7d92a0", "Sin dato": "#bfc9ce" };
    renderBarList("#calendar-bars", summary.por_calendario.map((item) => ({ ...item, color: calendarColors[item.nombre] || "#8899a1" })));
    renderBarList("#coverage-bars", summary.cobertura_contenido.map((item) => ({
      ...item,
      nombre: `${item.nombre} · ${formatPercent(item.porcentaje)}`,
      color: "#528902",
    })));
    const taxDocs = summary.documentos_tributarios || {};
    const taxClasses = taxDocs.por_clase || [];
    const taxCounts = Object.fromEntries(taxClasses.map((item) => [item.nombre, item.cantidad]));
    $("#tax-document-count").textContent = `Documentos totales: ${formatNumber(taxDocs.total)} (referencia Excel: ${formatNumber(taxDocs.referencia_excel)}; incluye todas las clases). Tributario sin clasificar (pendiente de mejorar el clasificador): ${formatNumber(taxCounts.otro || 0)}; sin_clasificar: ${formatNumber(taxCounts.sin_clasificar || 0)}.`;

    const risks = summary.riesgo_tributario || [];
    $("#risk-count").textContent = formatNumber(risks.length);
    riskVisible = 100;
    addRiskTableRows(risks);

    const heatmap = summary.mapa_calor_departamento || [];
    const keys = ["Estatuto", "Norma ICA", "Trámite ICA", "ReteICA"];
    const head = $("#heatmap-head");
    clear(head);
    const hr = node("tr");
    ["Departamento", ...keys, "Con API"].forEach((label) => appendText(hr, "th", label));
    head.append(hr);
    const body = $("#heatmap-body");
    clear(body);
    heatmap.forEach((row) => {
      const tr = node("tr");
      appendText(tr, "td", row.departamento, "table-name");
      keys.forEach((key) => {
        const count = Number(row[key] || 0);
        const ratio = row.total_api ? count / row.total_api : 0;
        const cell = node("td", "heatmap-cell");
        const pill = node("span", "", `${formatNumber(count)} · ${formatPercent(ratio)}`);
        const alpha = Math.min(.4, .06 + ratio * .34);
        pill.style.backgroundColor = `rgba(55, 132, 112, ${alpha})`;
        pill.title = `${key}: ${formatNumber(count)} de ${formatNumber(row.total_api)} municipios con API`;
        cell.append(pill);
        tr.append(cell);
      });
      appendText(tr, "td", formatNumber(row.total_api), "heatmap-total");
      body.append(tr);
    });
  }

  function groupReason(item) {
    switch (item.grupo_trabajo) {
      case "sin_sitio": return item.notas || item.metodo_hallazgo || "No se encontró un sitio; falta localizar y verificar un candidato.";
      case "revision_manual": return item.notas || "El registro requiere confirmación manual.";
      case "sin_clasificar": return `Sin API: se recolecta con otra técnica (${item.tecnica || "sin asignar"}).`;
      case "api_sin_cosecha": return "API identificada; falta la cosecha tributaria local.";
      default: return "Sin acción pendiente registrada.";
    }
  }

  function filterMatches(item, selected) {
    if (!selected || selected === "all") return true;
    if (selected === "identificado") return item.estado === "identificado";
    if (selected === "api") return item.plataforma === "api";
    return item.grupo_trabajo === selected;
  }

  function renderPendingTable() {
    if (!municipalities.length) return;
    const groupSelect = $("#group-filter");
    const departmentSelect = $("#department-filter");
    const sortSelect = $("#population-sort");
    const selectedGroup = groupSelect.value || "sin_sitio";
    const selectedDepartment = departmentSelect.value || "all";
    const direction = sortSelect.value || "desc";
    const rows = municipalities.filter((item) => filterMatches(item, selectedGroup)
      && (selectedDepartment === "all" || item.departamento === selectedDepartment));
    rows.sort((a, b) => {
      const left = a.poblacion;
      const right = b.poblacion;
      if (left === null && right === null) return a.municipio.localeCompare(b.municipio, "es");
      if (left === null) return 1;
      if (right === null) return -1;
      const diff = direction === "asc" ? left - right : right - left;
      return diff || a.municipio.localeCompare(b.municipio, "es");
    });
    $("#pending-result-count").textContent = `${formatNumber(rows.length)} municipios`;
    const body = $("#pending-table-body");
    clear(body);
    rows.forEach((item) => {
      const tr = node("tr");
      appendText(tr, "td", item.divipola, "table-code");
      const nameCell = node("td");
      const nameButton = node("button", "text-button table-name", item.municipio);
      nameButton.type = "button";
      nameButton.addEventListener("click", () => showMunicipality(item));
      nameCell.append(nameButton);
      tr.append(nameCell);
      appendText(tr, "td", item.departamento);
      appendText(tr, "td", formatNumber(item.poblacion), "numeric");
      const reason = appendText(tr, "td", groupReason(item));
      reason.title = reason.textContent;
      appendText(tr, "td", item.confianza || "Sin dato");
      const linkCell = node("td");
      const linkUrl = item.sitio_url || item.url_normativa;
      const link = addLink(linkCell, item.sitio_url ? "Sitio" : item.url_normativa ? "Normatividad" : "Sin candidato", linkUrl);
      if (!link) linkCell.textContent = "Sin candidato";
      tr.append(linkCell);
      body.append(tr);
    });
    $("#pending-empty").hidden = rows.length !== 0;
  }

  function setupPendingFilters() {
    const group = $("#group-filter");
    const options = [
      ["all", "Todos los municipios"],
      ["sin_sitio", "Sin sitio"],
      ["revision_manual", "Revisión manual"],
      ["sin_clasificar", "Sin API"],
      ["api_sin_cosecha", "API sin cosecha"],
      ["ok", "Sin acción pendiente"],
      ["identificado", "Con sitio identificado"],
      ["api", "Con API"],
    ];
    clear(group);
    options.forEach(([value, label]) => {
      const option = node("option", "", label);
      option.value = value;
      group.append(option);
    });
    const department = $("#department-filter");
    clear(department);
    const all = node("option", "", "Todos los departamentos");
    all.value = "all";
    department.append(all);
    [...new Set(municipalities.map((item) => item.departamento).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"))
      .forEach((name) => {
        const option = node("option", "", name);
        option.value = name;
        department.append(option);
      });
    [group, department, $("#population-sort")].forEach((select) => select.addEventListener("change", renderPendingTable));
  }

  function setBadge(parent, label, tone = "") {
    const badge = node("span", `badge${tone ? ` ${tone}` : ""}`, label);
    parent.append(badge);
    return badge;
  }

  function addMeta(parent, label, value) {
    const wrapper = node("div", "meta-item");
    appendText(wrapper, "span", label);
    appendText(wrapper, "strong", value || "Sin dato");
    parent.append(wrapper);
  }

  function addHarvestCell(parent, label, value, small = false) {
    const cell = node("div", "harvest-cell");
    appendText(cell, "span", label);
    appendText(cell, "strong", value === null || value === undefined || value === "" ? "Sin dato" : value, small ? "small" : "");
    parent.append(cell);
  }

  function linkListItem(parent, item, options = {}) {
    const row = node("div", "doc-row");
    const body = node("div");
    appendText(body, "div", item.nombre || "Documento sin título", "doc-name");
    const meta = node("div", "doc-meta");
    if (options.tax) {
      appendText(meta, "span", item.clase || "Documento");
      appendText(meta, "span", item.confianza || "Confianza sin clasificar", `doc-tag ${normalize(item.confianza)}`);
    } else if (item.seccion) {
      appendText(meta, "span", item.seccion, "doc-tag");
    }
    appendText(meta, "span", item.fecha || "Sin fecha");
    const sourceLabel = item.fecha_fuente === "expedicion" ? "fecha de expedición"
      : item.fecha_fuente === "modificacion" ? "fecha de modificación" : "sin fecha de origen";
    appendText(meta, "span", sourceLabel);
    if (item.tipo_contenido) appendText(meta, "span", item.tipo_contenido);
    if (item.entregables && item.entregables.length) appendText(meta, "span", item.entregables.join(" · "), "doc-tag");
    body.append(meta);
    if (item.archivos && item.archivos.length) {
      const files = node("div", "doc-files");
      item.archivos.forEach((file) => {
        const ext = (file.extension || "").replace(".", "").toUpperCase() || "Archivo";
        addLink(files, `${ext}${file.tamano_bytes ? " · " + formatBytes(file.tamano_bytes) : ""}`, file.url, "doc-link file-link");
      });
      body.append(files);
    }
    row.append(body);
    const linkCell = node("div");
    if (item.url_pagina) {
      const text = item.url_tipo === "enlace_general" ? "Enlace general" : "Abrir";
      addLink(linkCell, text, item.url_pagina, "doc-link");
    } else {
      appendText(linkCell, "span", "Sin enlace disponible", "doc-meta");
    }
    row.append(linkCell);
    parent.append(row);
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes >= 1048576) return `${(bytes / 1048576).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function renderDocumentSection(parent, title, docs, hint = "") {
    const header = node("div", "section-title");
    appendText(header, "h3", title);
    if (hint) appendText(header, "span", hint);
    parent.append(header);
    if (!docs || docs.length === 0) {
      appendText(parent, "p", "No hay documentos en esta lista.", "panel-description");
      return;
    }
    const list = node("div", "doc-list");
    docs.forEach((item) => linkListItem(list, item, { tax: title.includes("tributarios") }));
    parent.append(list);
  }

  const CLASE_ROTULO = { calendario: "Calendario", estatuto: "Estatuto", ica: "ICA", reteica: "ReteICA", exogena: "Medios magnéticos" };
  const REGLAS_PREVISTAS = [
    { clase: "ica", entregable: "E1", nombre: "Tarifas de ICA por actividad", valor: "Tarifa (‰ o %) por actividad económica" },
    { clase: "reteica", entregable: "E2", nombre: "Reglas de ReteICA", valor: "Quién retiene, base mínima y tarifa" },
    { clase: "calendario", entregable: "E3", nombre: "Fechas y descuentos del calendario", valor: "Fechas de pago y % de descuento por pronto pago" },
    { clase: "exogena", entregable: "E8", nombre: "Medios magnéticos (exógena)", valor: "Quién reporta, qué información, plazos y formato" },
  ];

  function fichaSection(parent, title, hint = "") {
    const block = node("section", "ficha-section");
    const header = node("div", "section-title");
    appendText(header, "h3", title);
    if (hint) appendText(header, "span", hint);
    block.append(header);
    parent.append(block);
    return block;
  }

  function fichaDetails(parent, title) {
    const details = node("details", "ficha-details");
    appendText(details, "summary", title);
    parent.append(details);
    return details;
  }

  function renderFichaDocs(block, item) {
    const docs = item.documentos_tributarios || [];
    const counts = item.conteo_documentos || {};
    if (!docs.length) {
      appendText(block, "p", "Todavía no hay documentos tributarios para este municipio.", "panel-description");
      return;
    }
    let active = "todos";
    const filters = node("div", "doc-filter");
    const body = node("tbody");
    const table = node("table", "doc-table");
    const head = node("thead");
    const hr = node("tr");
    ["Tipo", "Documento", "Fecha", "Estado", "Abrir"].forEach((label) => appendText(hr, "th", label));
    head.append(hr);
    table.append(head, body);
    const paint = () => {
      clear(body);
      docs.filter((d) => active === "todos" || d.clase === active || (active === "autorretencion" && d.subtipo === "autorretencion")).forEach((doc) => {
        const tr = node("tr");
        const tipo = node("td");
        appendText(tipo, "span", doc.subtipo === "autorretencion" ? "ReteICA · autorretención" : (CLASE_ROTULO[doc.clase] || doc.clase), "doc-type");
        const nombre = node("td");
        appendText(nombre, "div", doc.nombre, "table-name");
        if (doc.entregables && doc.entregables.length) appendText(nombre, "div", `Sirve para: ${doc.entregables.join(" · ")}`, "doc-meta");
        const fecha = node("td", "nowrap", doc.fecha || "Sin fecha");
        const estado = node("td");
        const firme = doc.confianza === "alta" || doc.confianza === "probable";
        appendText(estado, "span", doc.validacion ? `Validación: ${doc.validacion}` : firme ? "Candidato" : "Por revisar", `doc-tag ${doc.validacion === "validado" ? "alta" : firme ? "probable" : ""}`);
        const abrir = node("td", "nowrap");
        if (doc.url_pagina) addLink(abrir, doc.url_tipo === "enlace_general" ? "Enlace general" : "Abrir", doc.url_pagina, "doc-link");
        (doc.archivos || []).forEach((file) => {
          const ext = (file.extension || "").replace(".", "").toUpperCase() || "Archivo";
          addLink(abrir, ext, file.url, "doc-link file-link");
        });
        if (!abrir.childNodes.length) appendText(abrir, "span", "Sin enlace", "doc-meta");
        tr.append(tipo, nombre, fecha, estado, abrir);
        body.append(tr);
      });
    };
    const addFilter = (key, label) => {
      const button = node("button", `filter-chip${key === active ? " active" : ""}`, label);
      button.type = "button";
      button.addEventListener("click", () => {
        active = key;
        filters.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.remove("active"));
        button.classList.add("active");
        paint();
      });
      filters.append(button);
    };
    addFilter("todos", "Todos");
    Object.keys(CLASE_ROTULO).forEach((clase) => {
      if (counts[clase]) addFilter(clase, `${CLASE_ROTULO[clase]} (${formatNumber(counts[clase].total)})`);
      if (clase === "reteica") {
        const nAuto = docs.filter((d) => d.subtipo === "autorretencion").length;
        if (nAuto) addFilter("autorretencion", `Autorretención (${formatNumber(nAuto)})`);
      }
    });
    block.append(filters);
    const wrap = node("div", "table-wrap");
    wrap.append(table);
    block.append(wrap);
    const shown = docs.length;
    const total = Object.values(counts).reduce((sum, c) => sum + c.total, 0);
    if (total > shown) appendText(block, "p", `Se muestran los ${formatNumber(shown)} más recientes (hasta 8 por tipo); en total hay ${formatNumber(total)}.`, "panel-description");
    paint();
  }

  // Detalle de cada municipio en dashboard_data/municipios/DIVIPOLA.json (se pide al abrir la ficha y queda en memoria)
  async function cargarDetalle(item) {
    if (item._detalle) return true;
    try {
      const res = await fetch(`dashboard_data/municipios/${item.divipola}.json`, { cache: "no-store" });
      if (!res.ok) return false;
      Object.assign(item, await res.json());
      item._detalle = true;
      return true;
    } catch { return false; }
  }

  async function showMunicipality(item) {
    selectedMunicipality = item;
    if (!$("#view-buscador").classList.contains("active")) activateTab("buscador");
    history.replaceState(null, "", `#buscador/${item.divipola}`);
    const container = $("#municipality-detail");
    if (!item._detalle) {
      clear(container);
      container.className = "municipality-detail panel";
      appendText(container, "h2", item.municipio);
      appendText(container, "p", "Cargando la ficha…", "panel-description");
      const ok = await cargarDetalle(item);
      if (selectedMunicipality !== item) return;   // el usuario ya abrio otro municipio
      if (!ok) { clear(container); appendText(container, "h2", item.municipio); appendText(container, "p", "No se pudo cargar la ficha. Revise la conexión e intente de nuevo.", "load-error"); return; }
    }
    renderMunicipality(item);
  }

  function renderMunicipality(item) {
    const container = $("#municipality-detail");
    clear(container);
    container.className = "municipality-detail panel";
    const counts = item.conteo_documentos || {};
    const hasDocs = Object.keys(counts).length > 0;
    const collected = Boolean(item.cosecha) || hasDocs;

    const heading = node("div", "detail-header");
    const identity = node("div");
    appendText(identity, "h2", item.municipio);
    appendText(identity, "div", `${item.departamento} · ${formatNumber(item.poblacion)} habitantes`, "detail-location");
    appendText(identity, "div", `DIVIPOLA ${item.divipola}`, "detail-code");
    const ult = item.ultima_actualizacion;
    appendText(identity, "div", ult ? `Última publicación tributaria detectada: ${ult} (${haceTexto(ult)})`
      : item.curaduria ? `Fuentes revisadas a mano el ${item.curaduria.fecha_revision}` : "Sin publicaciones tributarias detectadas todavía", "detail-updated");
    heading.append(identity);
    const clienteBadges = node("div", "badge-row");
    clienteBadges.dataset.mode = "cliente";
    const nNov = (item.novedades_semana || []).length;
    if (nNov) setBadge(clienteBadges, `${formatNumber(nNov)} ${nNov === 1 ? "cambio" : "cambios"} en la última captura`, "success");
    if ((item.alertas || []).length) setBadge(clienteBadges, "Alerta: reforma o nuevas tarifas", "warning");
    if (item.curaduria) setBadge(clienteBadges, "Fuentes revisadas a mano", "");
    heading.append(clienteBadges);
    const badges = node("div", "badge-row");
    badges.dataset.mode = "operacion";
    if (item.estado !== "identificado") setBadge(badges, "Sin sitio hallado", "danger");
    else setBadge(badges, `Se recolecta con: ${item.tecnica || "sin técnica asignada"}`, collected ? "success" : "warning");
    setBadge(badges, collected ? "Con documentos recolectados" : "Sin recolección todavía", collected ? "success" : "danger");
    heading.append(badges);
    container.append(heading);

    const links = node("div", "detail-links");
    if (item.sitio_url) addLink(links, "Sitio municipal", item.sitio_url, "detail-link");
    if (item.url_normativa) addLink(links, "Normatividad", item.url_normativa, "detail-link");
    if (item.url_calendario) addLink(links, "Hacienda / calendario", item.url_calendario, "detail-link");
    if (item.portal_tributario && item.portal_tributario !== item.url_calendario) {
      const rotulo = item.tipo_portal === "pasarela" ? "Pago en línea (pasarela)" : "Portal tributario";
      const sufijo = item.estado_portal === "confirmado" ? "" : " · por confirmar";
      addLink(links, rotulo + sufijo, item.portal_tributario, "detail-link");
    }
    container.append(links);

    (item.alertas || []).forEach((a) => {
      const note = node("div", "detail-note ficha-alerta");
      appendText(note, "strong", "Alerta: ");
      appendText(note, "span", a.texto.charAt(0).toUpperCase() + a.texto.slice(1));
      if (a.url) { appendText(note, "span", " · "); addLink(note, "ver fuente", a.url, "doc-link"); }
      container.append(note);
    });
    renderEsenciales(container, item);
    renderNovedadesFicha(container, item);

    if (item.estado === "pendiente") {
      const notice = node("div", "detail-note");
      notice.dataset.mode = "operacion";
      appendText(notice, "strong", "Motivo: ");
      appendText(notice, "span", item.metodo_hallazgo || "El registro indica que no se encontró un sitio.");
      appendText(notice, "br", "");
      appendText(notice, "strong", "Siguiente acción: ");
      appendText(notice, "span", "Buscar en directorios oficiales y confirmar un candidato con evidencia de la alcaldía.");
      container.append(notice);
    }

    if (!collected && !item.curaduria) {
      const cl = node("div", "detail-note");
      cl.dataset.mode = "cliente";
      appendText(cl, "span", "Aún no hay documentos tributarios recolectados de este municipio. Mientras tanto, consulte los enlaces oficiales de arriba.");
      container.append(cl);
    }
    if (!collected && item.estado === "identificado") {
      const sin = node("div", "detail-note");
      sin.dataset.mode = "operacion";
      appendText(sin, "strong", "Este municipio aún no se recolecta. ");
      appendText(sin, "span", item.plataforma === "api"
        ? "Tiene API de Mi Colombia Digital, pero todavía no aparece en la cosecha."
        : `Técnica prevista: ${item.tecnica || "sin clasificar"}. Mientras no se construya ese adaptador no hay documentos que mostrar.`);
      container.append(sin);
    }

    if (collected) {
      const resumen = fichaSection(container, "En resumen", "Documentos candidatos hallados por nombre o descripción; aún no validados");
      resumen.dataset.mode = "operacion";
      const cards = node("div", "summary-cards");
      Object.keys(CLASE_ROTULO).forEach((clase) => {
        const c = counts[clase] || { total: 0, firmes: 0 };
        const card = node("div", `summary-card${c.firmes ? " has" : ""}`);
        appendText(card, "span", CLASE_ROTULO[clase]);
        appendText(card, "strong", formatNumber(c.firmes));
        let foot = c.firmes ? (c.firmes === 1 ? "documento firme" : "documentos firmes") : c.total ? `${formatNumber(c.total)} por revisar` : "ninguno hallado";
        if (item.cosecha && clase === "estatuto" && item.cosecha.estatuto_estado) foot += ` · estado: ${item.cosecha.estatuto_estado}`;
        if (item.cosecha && clase === "calendario" && item.cosecha.calendario_estado) foot += ` · vigente: ${item.cosecha.calendario_estado}`;
        appendText(card, "small", foot);
        cards.append(card);
      });
      resumen.append(cards);
      const chips = node("div", "entregable-chips");
      if (summary.fase2) {
        summary.fase2.entregables.forEach((entry) => {
          const has = (item.entregables || []).includes(entry.codigo);
          const chip = setBadge(chips, `${entry.codigo} · ${entry.nombre}`, has ? "success" : "muted");
          chip.title = has ? "Hay un documento candidato" : "Sin documento candidato todavía";
        });
      }
      resumen.append(chips);
    }

    const docsBlock = fichaSection(container, "Todos los documentos tributarios", "Calendario, estatuto, ICA, ReteICA y medios magnéticos");
    if (collected) renderFichaDocs(docsBlock, item);
    else appendText(docsBlock, "p", "Sin documentos recolectados todavía.", "panel-description");

    if (collected) {
      const reglas = fichaSection(container, "Reglas extraídas", "Próxima fase: lectura de los documentos");
      const tbl = node("table", "doc-table");
      const th = node("thead");
      const trh = node("tr");
      ["Qué se va a extraer", "Documento fuente candidato", "Valor"].forEach((label) => appendText(trh, "th", label));
      th.append(trh);
      const tb = node("tbody");
      REGLAS_PREVISTAS.forEach((regla) => {
        const tr = node("tr");
        const q = node("td");
        appendText(q, "div", `${regla.entregable} · ${regla.nombre}`, "table-name");
        appendText(q, "div", regla.valor, "doc-meta");
        const fuente = node("td");
        const key = (item.documentos_clave || {})[regla.clase];
        if (key && key.url_pagina) addLink(fuente, key.nombre, key.url_pagina, "doc-link");
        else appendText(fuente, "span", key ? key.nombre : "Sin documento candidato", "doc-meta");
        const valor = node("td");
        appendText(valor, "span", "Pendiente de lectura", "doc-tag");
        tr.append(q, fuente, valor);
        tb.append(tr);
      });
      tbl.append(th, tb);
      const wrap = node("div", "table-wrap");
      wrap.append(tbl);
      reglas.append(wrap);
    }

    const registro = fichaDetails(container, "Datos internos: registro y recolección");
    registro.dataset.mode = "operacion";
    const meta = node("div", "detail-meta");
    addMeta(meta, "Método de hallazgo del sitio", item.metodo_hallazgo);
    addMeta(meta, "Contenido verificado", item.contenido_verificado);
    addMeta(meta, "Última verificación", item.fecha_verificacion);
    addMeta(meta, "Última captura del sitio", item.snapshot ? item.snapshot.fecha_captura : "Sin captura");
    addMeta(meta, "Confianza del sitio", item.confianza);
    if (item.subdominio_api) addMeta(meta, "Subdominio API", item.subdominio_api);
    registro.append(meta);
    if (item.notas) registro.append(node("p", "detail-note", item.notas));
    if (item.cosecha) {
      const harvest = item.cosecha;
      const grid = node("div", "harvest-grid");
      addHarvestCell(grid, "Total de normas", formatNumber(harvest.total_normas));
      addHarvestCell(grid, "Última norma", harvest.ultima_norma_fecha || "Sin fecha", true);
      addHarvestCell(grid, "Días desde la norma", harvest.dias_desde_ultima === null ? "Sin fecha" : formatNumber(harvest.dias_desde_ultima), true);
      addHarvestCell(grid, "Calendario", harvest.calendario_vigente);
      addHarvestCell(grid, "Estatuto", formatNumber(harvest.n_estatuto));
      addHarvestCell(grid, "Documentos ICA", formatNumber(harvest.n_ica));
      addHarvestCell(grid, "ICA · norma / trámite", `${formatNumber(harvest.n_ica_norma)} / ${formatNumber(harvest.n_ica_tramite)}`, true);
      addHarvestCell(grid, "Documentos ReteICA", formatNumber(harvest.n_reteica));
      addHarvestCell(grid, "Fecha de cosecha", harvest.fecha_cosecha, true);
      registro.append(grid);
      if (harvest.ultima_norma_nombre) appendText(registro, "p", `Última norma: ${harvest.ultima_norma_nombre}`, "detail-note");
      if (harvest.mejor_estatuto) appendText(registro, "p", `Estatuto detectado: ${harvest.mejor_estatuto}`, "detail-note");
    }

    const recent = item.documentos_recientes || { normatividad: [], otros: [] };
    if ((recent.normatividad && recent.normatividad.length) || (recent.otros && recent.otros.length)) {
      const recentSection = fichaDetails(container, "Últimas publicaciones del sitio (de cualquier tema)");
      recentSection.dataset.mode = "operacion";
      const normBlock = node("div", "section-block");
      appendText(normBlock, "h4", "Normatividad");
      if (recent.normatividad && recent.normatividad.length) {
        const list = node("div", "doc-list");
        recent.normatividad.forEach((doc) => linkListItem(list, doc));
        normBlock.append(list);
      } else appendText(normBlock, "p", "Sin publicaciones de Normatividad en la muestra local.", "panel-description");
      recentSection.append(normBlock);
      const groups = new Map();
      (recent.otros || []).forEach((doc) => {
        const sec = doc.seccion || "Sin sección";
        if (!groups.has(sec)) groups.set(sec, []);
        groups.get(sec).push(doc);
      });
      [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")).forEach(([sec, docs]) => {
        const block = node("div", "section-block");
        appendText(block, "h4", sec);
        const list = node("div", "doc-list");
        docs.forEach((doc) => linkListItem(list, doc));
        block.append(list);
        recentSection.append(block);
      });
    }
    const fuente = node("p", "ficha-fuente");
    fuente.textContent = "Fuente: sitios oficiales de la alcaldía y su portal tributario. Documentos identificados automáticamente o revisados a mano; información de referencia, verifique siempre con la norma oficial.";
    container.append(fuente);
  }

  function renderSuggestions(query) {
    const box = $("#search-suggestions");
    clear(box);
    suggestionIndex = -1;
    if (!query.trim()) {
      box.hidden = true;
      return;
    }
    const needle = normalize(query);
    const matches = municipalities.map((item) => {
      const name = normalize(item.municipio);
      const department = normalize(item.departamento);
      const code = item.divipola;
      const score = code === query.trim() ? 0 : name === needle ? 1 : name.startsWith(needle) ? 2 : department.startsWith(needle) ? 3 : `${name} ${department} ${code}`.includes(needle) ? 4 : 99;
      return { item, score };
    }).filter((row) => row.score < 99)
      .sort((a, b) => a.score - b.score || a.item.municipio.localeCompare(b.item.municipio, "es"))
      .slice(0, 12);
    if (!matches.length) {
      const empty = node("div", "suggestion", "No se encontraron coincidencias.");
      box.append(empty);
      box.hidden = false;
      return;
    }
    matches.forEach(({ item }, index) => {
      const button = node("button", "suggestion");
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      const identity = node("span");
      appendText(identity, "span", item.municipio, "suggestion-name");
      appendText(identity, "span", `${item.departamento} · ${item.estado === "pendiente" ? "Sin sitio" : item.plataforma === "api" ? "Con API" : "Sin API"}`, "suggestion-meta");
      button.append(identity);
      appendText(button, "span", item.divipola, "suggestion-code");
      button.addEventListener("click", () => {
        $("#municipality-search").value = `${item.municipio} · ${item.divipola}`;
        box.hidden = true;
        showMunicipality(item);
      });
      button.dataset.index = String(index);
      box.append(button);
    });
    box.hidden = false;
  }

  function setupSearch() {
    const input = $("#municipality-search");
    const box = $("#search-suggestions");
    input.addEventListener("input", () => renderSuggestions(input.value));
    input.addEventListener("keydown", (event) => {
      const options = $$(".suggestion[role='option']", box);
      if (event.key === "ArrowDown" && options.length) {
        event.preventDefault();
        suggestionIndex = (suggestionIndex + 1) % options.length;
      } else if (event.key === "ArrowUp" && options.length) {
        event.preventDefault();
        suggestionIndex = (suggestionIndex - 1 + options.length) % options.length;
      } else if (event.key === "Enter" && options.length) {
        event.preventDefault();
        const target = options[Math.max(0, suggestionIndex)];
        target.click();
        return;
      } else if (event.key === "Escape") {
        box.hidden = true;
        return;
      } else return;
      options.forEach((option, index) => {
        const active = index === suggestionIndex;
        option.setAttribute("aria-selected", String(active));
        if (active) option.scrollIntoView({ block: "nearest" });
      });
    });
    $("#clear-search").addEventListener("click", () => {
      input.value = "";
      box.hidden = true;
      clear($("#municipality-detail"));
      const detail = $("#municipality-detail");
      detail.className = "municipality-detail empty-state panel";
      appendText(detail, "span", "⌕", "empty-icon");
      appendText(detail, "h2", "Encuentra un municipio");
      appendText(detail, "p", "Escribe un nombre, departamento o código para ver su ficha y documentos.");
      input.focus();
    });
    document.addEventListener("click", (event) => {
      if (!box.contains(event.target) && !input.contains(event.target)) box.hidden = true;
    });
  }

  function setupTabs() {
    const [hash, codigo] = window.location.hash.replace("#", "").split("/");
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => activateTab(GROUPS[button.dataset.group].views[0])));
    $$(".subtab").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
    $$("[data-mode-set]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.modeSet)));
    document.body.dataset.mode = mode;
    $$("[data-mode-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modeSet === mode)));
    activateTab("novedades");
    $$('[data-go-tab="pendientes"]').forEach((button) => button.addEventListener("click", () => navigatePending("all")));
    if (hash === "buscador" && codigo) {
      const m = municipalities.find((x) => x.divipola === codigo);
      if (m) { showMunicipality(m); return; }
    }
    if (["novedades", "resumen", "entregables", "semana", "validacion", "buscador", "pendientes", "calidad", "salud"].includes(hash)) activateTab(hash);
  }

  function staticKpi({ label, value, foot, color }) {
    const card = node("div", "kpi-card kpi-static");
    card.style.setProperty("--kpi-color", color);
    const title = node("span", "kpi-label");
    appendText(title, "i", "", "kpi-marker");
    appendText(title, "span", label);
    card.append(title);
    appendText(card, "strong", value, "kpi-value");
    appendText(card, "span", foot, "kpi-foot");
    return card;
  }

  function matrixRows() {
    const department = $("#matrix-department").value;
    const missing = $("#matrix-missing").value;
    if ($("#matrix-group").value === "sin_api") {
      return municipalities
        .filter((item) => !item.cosecha && item.plataforma !== "api")
        .filter((item) => department === "all" || item.departamento === department)
        .sort((a, b) => (b.poblacion || 0) - (a.poblacion || 0));
    }
    return municipalities
      .filter((item) => item.cosecha)
      .filter((item) => department === "all" || item.departamento === department)
      .filter((item) => missing === "all" || !(item.entregables || []).includes(missing))
      .sort((a, b) => (b.poblacion || 0) - (a.poblacion || 0));
  }

  function stateBadge(parent, value) {
    const text = value || "sin dato";
    const tone = ["alta", "Sí"].includes(text) ? "success" : ["probable", "Probable"].includes(text) ? "warning" : "danger";
    setBadge(parent, text, tone);
  }

  function renderMatrixHead(sinApi) {
    const head = $("#matrix-head");
    clear(head);
    const headRow = node("tr");
    const f2 = summary.fase2;
    ["Municipio", "Departamento", "Población"].forEach((label) => appendText(headRow, "th", label, label === "Población" ? "numeric" : ""));
    if (sinApi) {
      ["Técnica probable", "Recolección", "Sitio"].forEach((label) => appendText(headRow, "th", label));
    } else {
      f2.entregables.forEach((entry) => { const th = appendText(headRow, "th", entry.codigo); th.title = entry.nombre; });
      ["Estatuto", "Calendario", "Archivos"].forEach((label) => appendText(headRow, "th", label));
    }
    head.append(headRow);
  }

  function renderMatrix() {
    const body = $("#matrix-body");
    clear(body);
    const sinApi = $("#matrix-group").value === "sin_api";
    $("#matrix-missing").disabled = sinApi;
    renderMatrixHead(sinApi);
    const rows = matrixRows();
    $("#matrix-count").textContent = `${formatNumber(rows.length)} municipios`;
    rows.slice(0, matrixVisible).forEach((item) => {
      const tr = node("tr");
      if (sinApi) {
        appendText(tr, "td", item.municipio);
        appendText(tr, "td", item.departamento);
        appendText(tr, "td", formatNumber(item.poblacion), "numeric");
        appendText(tr, "td", item.tecnica || "Sin clasificar");
        const state = node("td");
        setBadge(state, "Sin recolección", "danger");
        tr.append(state);
        const siteCell = node("td");
        if (item.sitio_url) addLink(siteCell, "Sitio", item.sitio_url, "doc-link"); else siteCell.textContent = "—";
        tr.append(siteCell);
        tr.addEventListener("click", (event) => {
          if (event.target.closest("a")) return;
          activateTab("buscador");
          showMunicipality(item);
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        body.append(tr);
        return;
      }
      appendText(tr, "td", item.municipio);
      appendText(tr, "td", item.departamento);
      appendText(tr, "td", formatNumber(item.poblacion), "numeric");
      summary.fase2.entregables.forEach((entry) => {
        const has = (item.entregables || []).includes(entry.codigo);
        const cell = appendText(tr, "td", has ? "✓" : "·", has ? "ev-yes" : "ev-no");
        cell.title = `${entry.codigo} · ${entry.nombre}`;
      });
      const statuteCell = node("td");
      stateBadge(statuteCell, item.cosecha.estatuto_estado);
      tr.append(statuteCell);
      const calendarCell = node("td");
      stateBadge(calendarCell, item.cosecha.calendario_estado);
      tr.append(calendarCell);
      appendText(tr, "td", formatNumber(item.n_archivos), "numeric");
      tr.addEventListener("click", () => {
        activateTab("buscador");
        showMunicipality(item);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      body.append(tr);
    });
    const more = $("#matrix-more");
    clear(more);
    if (rows.length > matrixVisible) {
      const button = node("button", "text-button", `Ver más (${formatNumber(rows.length - matrixVisible)} restantes)`);
      button.type = "button";
      button.addEventListener("click", () => { matrixVisible += 60; renderMatrix(); });
      more.append(button);
    }
  }

  const CLASE_LABELS = { ica: "ICA", reteica: "ReteICA", estatuto: "Estatuto", calendario: "Calendario", exogena: "Medios magnéticos (E8)", norma: "Norma tributaria (posible E4)", otro: "Otro" };
  const CAMBIO_LABELS = { nuevo: "nuevo", modificado: "modificado", desaparecido: "retirado", primera_vista: "primera vista" };
  let weekVisible = 100;

  function weekRows() {
    const week = summary.fase2.cambios;
    if (!week.disponible) return [];
    const kind = $("#wk-clase").value;
    const change = $("#wk-cambio").value;
    const level = $("#wk-nivel").value;
    const text = normalize($("#wk-texto").value);
    return week.filas.filter((row) => {
      if (kind === "tributarias" && (!row.clase || row.clase === "otro")) return false;
      if (!["tributarias", "todas"].includes(kind) && row.clase !== kind) return false;
      if (change !== "all" && row.cambio !== change) return false;
      if (level !== "all" && row.nivel !== level) return false;
      return !text || normalize(`${row.municipio} ${row.nombre}`).includes(text);
    });
  }

  function renderWeekTable() {
    const body = $("#wk-body");
    clear(body);
    const rows = weekRows();
    const totalCambios = summary.fase2 && summary.fase2.cambios ? summary.fase2.cambios.total : rows.length;
    const exportadas = summary.fase2 && summary.fase2.cambios ? (summary.fase2.cambios.filas || []).length : rows.length;
    $("#wk-count").textContent = exportadas < totalCambios
      ? `${formatNumber(rows.length)} cambios (la app recibe ${formatNumber(exportadas)} de ${formatNumber(totalCambios)}: primero los tributarios)`
      : `${formatNumber(rows.length)} cambios`;
    rows.slice(0, weekVisible).forEach((row) => {
      const tr = node("tr");
      appendText(tr, "td", row.municipio);
      appendText(tr, "td", row.nombre);
      appendText(tr, "td", CLASE_LABELS[row.clase] || "Sin clasificar");
      appendText(tr, "td", row.fuente === "SharePoint" ? "SharePoint" : "API");
      appendText(tr, "td", (row.entregables || []).join(" · ") || "—");
      const kindCell = node("td");
      const etiqueta = row.cambio === "modificado" && row.nivel === "solo_fecha" ? "modificado (solo fecha)"
        : row.cambio === "nuevo" && row.nivel === "norma_antigua" ? "nuevo (norma antigua)" : (CAMBIO_LABELS[row.cambio] || row.cambio);
      setBadge(kindCell, etiqueta, row.cambio === "nuevo" ? "success" : row.cambio === "desaparecido" ? "danger" : row.cambio === "primera_vista" ? "muted" : "warning");
      if (row.duplicado_de) kindCell.append(node("div", "panel-description", `Duplicado de la publicación ${row.duplicado_de}`));
      if (row.contenido) {
        const cambio = row.contenido.startsWith("cambió");
        const note = node("div", "panel-description", `Archivo: ${row.contenido}`);
        if (cambio) note.style.fontWeight = "600";
        kindCell.append(note);
      }
      tr.append(kindCell);
      appendText(tr, "td", row.fecha || "—");
      const link = node("td");
      if (row.url) addLink(link, "Abrir", row.url, "doc-link"); else link.textContent = "—";
      tr.append(link);
      body.append(tr);
    });
    const more = $("#wk-more");
    clear(more);
    if (rows.length > weekVisible) {
      const button = node("button", "text-button", `Ver más (${formatNumber(rows.length - weekVisible)} restantes)`);
      button.type = "button";
      button.addEventListener("click", () => { weekVisible += 100; renderWeekTable(); });
      more.append(button);
    }
  }

  function renderSemana() {
    const week = summary.fase2.cambios;
    const kpis = $("#wk-kpis");
    clear(kpis);
    const empty = $("#wk-empty");
    const tools = $("#wk-tools");
    if (!week.disponible) {
      empty.hidden = false;
      tools.hidden = true;
      empty.textContent = `${week.motivo} Cuando exista, aquí se verán los documentos nuevos y modificados de ICA, ReteICA, estatuto y calendario, por municipio.`;
      return;
    }
    empty.hidden = true;
    tools.hidden = false;
    const by = Object.fromEntries(week.por_cambio.map((entry) => [entry.nombre, entry.cantidad]));
    const lvl = Object.fromEntries(week.por_nivel.map((entry) => [entry.nombre, entry.cantidad]));
    const tax = week.filas.filter((row) => row.clase && row.clase !== "otro").length;
    kpis.append(
      staticKpi({ label: "Documentos nuevos", value: formatNumber(by.nuevo || 0), foot: `${week.captura_anterior} → ${week.captura_actual}`, color: "#6DB500" }),
      staticKpi({ label: "Modificados con cambio real", value: formatNumber(lvl.atributos || 0), foot: "Cambió nombre, descripción o archivo", color: "#D69E00" }),
      staticKpi({ label: "Modificados solo de fecha", value: formatNumber(lvl.solo_fecha || 0), foot: "Probable edición sin cambio visible", color: "#8b989e" }),
      staticKpi({ label: "Retirados", value: formatNumber(by.desaparecido || 0), foot: "Dejaron de aparecer", color: "#B4483F" }),
      staticKpi({ label: "Primera vista", value: formatNumber(by.primera_vista || 0), foot: "Ya existían; entraron a la ventana (no cuentan como cambio)", color: "#8b989e" }),
      staticKpi({ label: "Por revisar (tributarios)", value: formatNumber(week.por_revisar ?? tax), foot: week.municipios_monitoreados ? `${formatNumber(week.municipios_por_revisar)} de ${formatNumber(week.municipios_monitoreados)} municipios; ${formatNumber(week.municipios_monitoreados - week.municipios_por_revisar)} sin trabajo esta semana` : "De ICA, ReteICA, estatuto, calendario o norma", color: "#2D3431" }),
    );
    if (!$("#wk-clase").dataset.ready) {
      $("#wk-clase").dataset.ready = "1";
      [["tributarias", "Solo tributarias"], ["todas", "Todas"], ["ica", "ICA"], ["reteica", "ReteICA"], ["estatuto", "Estatuto"], ["calendario", "Calendario"], ["exogena", "Medios magnéticos (E8)"], ["norma", "Norma tributaria (E4)"]].forEach(([value, label]) => $("#wk-clase").append(new Option(label, value)));
      [["all", "Todos"], ["nuevo", "Nuevo"], ["modificado", "Modificado"], ["desaparecido", "Retirado"], ["primera_vista", "Primera vista"]].forEach(([value, label]) => $("#wk-cambio").append(new Option(label, value)));
      [["all", "Todos"], ["atributos", "Cambio real"], ["solo_fecha", "Solo fecha"]].forEach(([value, label]) => $("#wk-nivel").append(new Option(label, value)));
      ["#wk-clase", "#wk-cambio", "#wk-nivel"].forEach((id) => $(id).addEventListener("change", () => { weekVisible = 100; renderWeekTable(); }));
      $("#wk-texto").addEventListener("input", () => { weekVisible = 100; renderWeekTable(); });
    }
    renderWeekTable();
  }

  let queueVisible = 80;

  function queueRows() {
    const kind = $("#vq-tipo").value;
    const state = $("#vq-estado").value;
    const department = $("#vq-depto").value;
    return summary.fase2.cola_validacion.filter((row) => (kind === "all" || row.tipo === kind)
      && (department === "all" || row.departamento === department)
      && (state === "all" || (state === "pendientes" ? !row.validacion : Boolean(row.validacion))));
  }

  async function copyQueueRow(row, button) {
    const doc = row.documento || {};
    const line = [row.divipola, row.municipio, doc.content_id || "", row.clase, doc.nombre || ""].join("\t");
    try {
      await navigator.clipboard.writeText(line);
      button.textContent = "Copiado";
    } catch (_) {
      button.textContent = "No se pudo copiar";
    }
    setTimeout(() => { button.textContent = "Copiar fila"; }, 1800);
  }

  function renderQueueTable() {
    const body = $("#vq-body");
    clear(body);
    const rows = queueRows();
    $("#vq-count").textContent = `${formatNumber(rows.length)} por revisar`;
    rows.slice(0, queueVisible).forEach((row) => {
      const tr = node("tr");
      appendText(tr, "td", row.municipio);
      appendText(tr, "td", row.departamento);
      appendText(tr, "td", formatNumber(row.poblacion), "numeric");
      appendText(tr, "td", row.tipo);
      const docCell = node("td");
      const doc = row.documento;
      if (doc) {
        appendText(docCell, "div", doc.nombre, "doc-name");
        appendText(docCell, "div", `${doc.fecha || "Sin fecha"} · ${doc.confianza}`, "doc-meta");
        const links = node("div", "doc-files");
        if (doc.url_pagina) addLink(links, "Página", doc.url_pagina, "doc-link file-link");
        (doc.archivos || []).forEach((file) => addLink(links, `${(file.extension || "").replace(".", "").toUpperCase() || "Archivo"}${file.tamano_bytes ? " · " + formatBytes(file.tamano_bytes) : ""}`, file.url, "doc-link file-link"));
        docCell.append(links);
      } else docCell.textContent = "Sin documento candidato";
      tr.append(docCell);
      const stateCell = node("td");
      setBadge(stateCell, row.validacion || "pendiente", row.validacion === "validado" ? "success" : row.validacion === "descartado" ? "danger" : row.validacion ? "warning" : "muted");
      tr.append(stateCell);
      const action = node("td");
      const button = node("button", "text-button", "Copiar fila");
      button.type = "button";
      button.addEventListener("click", () => copyQueueRow(row, button));
      action.append(button);
      tr.append(action);
      body.append(tr);
    });
    const more = $("#vq-more");
    clear(more);
    if (rows.length > queueVisible) {
      const button = node("button", "text-button", `Ver más (${formatNumber(rows.length - queueVisible)} restantes)`);
      button.type = "button";
      button.addEventListener("click", () => { queueVisible += 80; renderQueueTable(); });
      more.append(button);
    }
  }

  function renderValidacion() {
    const f2 = summary.fase2;
    const v = f2.validaciones;
    $("#nav-validacion-count").textContent = formatNumber(v.pendientes);
    const kpis = $("#vq-kpis");
    clear(kpis);
    kpis.append(
      staticKpi({ label: "En la cola", value: formatNumber(v.en_cola), foot: "Estatutos y calendarios «probable»", color: "#8876a5" }),
      staticKpi({ label: "Pendientes", value: formatNumber(v.pendientes), foot: "Sin decisión registrada", color: "#D69E00" }),
      staticKpi({ label: "Validados", value: formatNumber(v.validado), foot: "Documento correcto", color: "#6DB500" }),
      staticKpi({ label: "Descartados", value: formatNumber(v.descartado), foot: "No es el documento", color: "#B4483F" }),
      staticKpi({ label: "Por corregir", value: formatNumber(v.corregir), foot: "Clasificación equivocada", color: "#2D3431" }),
    );
    const department = $("#vq-depto");
    if (!department.dataset.ready) {
      department.dataset.ready = "1";
      department.append(new Option("Todos", "all"));
      [...new Set(f2.cola_validacion.map((row) => row.departamento))].sort((a, b) => a.localeCompare(b, "es"))
        .forEach((name) => department.append(new Option(name, name)));
      ["#vq-tipo", "#vq-estado", "#vq-depto"].forEach((id) => $(id).addEventListener("change", () => { queueVisible = 80; renderQueueTable(); }));
    }
    renderQueueTable();
  }

  function renderFase2() {
    const f2 = summary.fase2;
    if (!f2) {
      $("#nav-entregables").hidden = true;
      return;
    }
    const kpis = $("#f2-kpis");
    clear(kpis);
    const pdf = (f2.archivos.por_extension || []).find((entry) => entry.nombre === ".pdf");
    kpis.append(
      staticKpi({ label: "Población en municipios con API", value: formatPercent(f2.pct_poblacion_con_api), foot: `${formatNumber(f2.municipios_sin_api)} municipios sin API suman ${formatPercent(f2.pct_poblacion_sin_api)} de la población`, color: "#6DB500" }),
      ...(f2.sharepoint && f2.sharepoint.municipios ? [staticKpi({ label: "Sin API con documentos (SharePoint)", value: formatNumber(f2.sharepoint.municipios), foot: `${formatPercent(f2.sharepoint.pct_poblacion)} de la población; son candidatos por nombre, sin validar`, color: "#436C08" })] : []),
      staticKpi({ label: "Municipios cosechados", value: formatNumber(f2.municipios_cosechados), foot: "Con documentos tributarios hallados", color: "#2D3431" }),
      staticKpi({ label: "Documentos con archivo", value: formatNumber(f2.archivos.documentos_con_archivo), foot: `${formatNumber(f2.archivos.total)} archivos${pdf ? `; ${formatNumber(pdf.cantidad)} PDF` : ""}`, color: "#D69E00" }),
      staticKpi({ label: "Estatuto por validar", value: formatNumber((f2.estatuto.find((entry) => entry.nombre === "probable") || {}).cantidad || 0), foot: "Candidatos «probable» sin confirmar", color: "#8876a5" }),
      staticKpi({ label: "Cambios de la semana", value: f2.cambios.disponible ? formatNumber(f2.cambios.total) : "—", foot: f2.cambios.disponible ? `${f2.cambios.captura_anterior} → ${f2.cambios.captura_actual}` : "Falta la segunda captura semanal", color: "#B4483F" }),
    );
    const tarifa = f2.e1_con_tarifa;
    $("#f2-municipios-note").textContent = `Sobre ${formatNumber(f2.municipios_cosechados)} municipios cosechados. E1 cuenta cualquier documento de ICA; con un documento de tarifas propiamente dicho hay ${formatNumber(tarifa.municipios)} (${formatPercent(tarifa.pct_cosechados)}). E2 incluye la autorretención (autorreteica): documentos específicos en ${formatNumber(municipalities.filter((m) => m.n_autorreteica > 0).length)} municipios. E8 (medios magnéticos) es clase propia desde el 8-nov.`;
    renderBarList("#f2-ent-municipios", f2.entregables.map((entry) => ({ nombre: `${entry.codigo} · ${entry.nombre}`, cantidad: entry.municipios })));
    renderBarList("#f2-ent-poblacion", f2.entregables.map((entry) => ({ nombre: `${entry.codigo} · ${entry.nombre}`, cantidad: Math.round(entry.pct_poblacion * 1000) / 10 })), { suffix: "%", color: "#2D3431" });
    const stateColors = { alta: "#6DB500", probable: "#D69E00", no: "#B4483F", "Sí": "#6DB500", Probable: "#D69E00", No: "#B4483F" };
    renderBarList("#f2-estatuto", f2.estatuto.map((entry) => ({ ...entry, color: stateColors[entry.nombre] })));
    renderBarList("#f2-calendario", f2.calendario.map((entry) => ({ ...entry, color: stateColors[entry.nombre] })));

    renderBarList("#f2-sin-api", (f2.sin_api_por_tecnica || []).map((entry) => ({ nombre: `${entry.nombre} · ${formatNumber(entry.municipios)} municipios`, cantidad: Math.round(entry.pct_poblacion * 1000) / 10 })), { suffix: "%", color: "#B4483F" });

    renderSemana();
    renderValidacion();

    $("#f2-matrix-note").textContent = `Con API: ${formatNumber(f2.municipios_cosechados)} municipios con recolección. Sin API: ${formatNumber(f2.municipios_sin_api)} municipios; ${formatNumber((f2.sharepoint || {}).municipios || 0)} ya tienen documentos candidatos por SharePoint y el resto aún no se recolecta (cambia el grupo para verlos). Haz clic en una fila para abrir su ficha.`;
    const departmentSelect = $("#matrix-department");
    clear(departmentSelect);
    departmentSelect.append(new Option("Todos", "all"));
    [...new Set(municipalities.map((item) => item.departamento))]
      .sort((a, b) => a.localeCompare(b, "es")).forEach((name) => departmentSelect.append(new Option(name, name)));
    const missingSelect = $("#matrix-missing");
    clear(missingSelect);
    missingSelect.append(new Option("Ninguno", "all"));
    f2.entregables.forEach((entry) => missingSelect.append(new Option(`${entry.codigo} · ${entry.nombre}`, entry.codigo)));
    [departmentSelect, missingSelect, $("#matrix-group")].forEach((select) => select.addEventListener("change", () => { matrixVisible = 60; renderMatrix(); }));
    renderMatrix();
  }

  // ---------- Capa de cliente: novedades, alertas y ficha esencial ----------
  const TIPO_DOC = { calendario: "Calendario", estatuto: "Estatuto", ica: "ICA", reteica: "ReteICA", exogena: "Medios magnéticos", norma: "Norma tributaria" };
  const NO_DATO_RX = /por confirmar|sin datos|no hallado|sin lectura|no publicado|^$/i;
  let novedadesVisibles = 40;

  function contenidoCliente(c) {
    if (!c) return "";
    if (c.startsWith("cambió: mismo archivo")) return "PDF reemplazado";
    if (c.startsWith("cambió: archivo nuevo")) return "archivo nuevo o reemplazado";
    if (c.startsWith("cambió: texto")) return "texto de la publicación actualizado";
    if (c.startsWith("cambió: tamaño")) return "archivo actualizado";
    if (c.startsWith("línea base")) return "documento nuevo";
    return "";
  }

  function diasDesde(fecha) {
    if (!fecha || !summary) return null;
    const ref = new Date(`${String(summary.fecha_generacion || "").slice(0, 10)}T00:00:00`);
    const d = new Date(`${String(fecha).slice(0, 10)}T00:00:00`);
    const n = Math.round((ref - d) / 86400000);
    return Number.isNaN(n) ? null : n;
  }

  function haceTexto(fecha) {
    const n = diasDesde(fecha);
    if (n === null) return "";
    if (n <= 0) return "hoy";
    if (n === 1) return "hace 1 día";
    if (n < 60) return `hace ${n} días`;
    const meses = Math.round(n / 30);
    return meses < 24 ? `hace ${meses} meses` : `hace ${Math.round(n / 365)} años`;
  }

  function recientesTributarios() {
    // Calculadas en el exportador (la app ya no descarga los documentos de todos los municipios al abrir)
    return ((summary.fase2 && summary.fase2.cliente && summary.fase2.cliente.recientes) || []);
  }


  function feedNovedades() {
    const cli = (summary.fase2 && summary.fase2.cliente) || {};
    if ((cli.novedades || []).length) {
      return { tipo: "captura", grupos: cli.novedades.map((g) => ({ ...g, items: g.items.map((i) => ({
        nombre: i.nombre, clase: i.clase, fecha: i.fecha, url: i.url, descripcion: "",
        detalle: [i.cambio === "nuevo" ? "nuevo" : "modificado", contenidoCliente(i.contenido)].filter(Boolean).join(" · ") })) })) };
    }
    return { tipo: "recientes", grupos: recientesTributarios() };
  }

  function abrirMunicipio(divipolaCode) {
    const m = municipalities.find((x) => x.divipola === divipolaCode);
    if (m) { showMunicipality(m); window.scrollTo({ top: 0, behavior: "smooth" }); }
  }

  function renderNovedades() {
    if (!$("#view-novedades")) return;
    const cli = (summary.fase2 && summary.fase2.cliente) || {};
    const camb = (summary.fase2 && summary.fase2.cambios) || {};
    const recientes = recientesTributarios();
    const nRecientes = recientes.reduce((s, g) => s + g.items.length, 0);
    const kpis = $("#nov-kpis");
    clear(kpis);
    kpis.append(
      staticKpi({ label: "Municipios con cambios", value: formatNumber(cli.municipios_con_novedades || 0), foot: cli.captura ? `Última captura: ${cli.captura}` : "Última captura", color: "#6DB500" }),
      staticKpi({ label: "Cambios tributarios", value: formatNumber(cli.novedades_total || 0), foot: "Nuevos o modificados, sin duplicados", color: "#395B0C" }),
      staticKpi({ label: "Publicaciones tributarias (30 días)", value: formatNumber(nRecientes), foot: `En ${formatNumber(recientes.length)} municipios`, color: "#ADFB20" }),
      staticKpi({ label: "Municipios vigilados", value: formatNumber(camb.municipios_monitoreados || 0), foot: "Revisión semanal de los sitios oficiales", color: "#2D3431" }),
      staticKpi({ label: "Alertas", value: formatNumber((cli.alertas || []).length), foot: "Reformas y nuevas tarifas", color: "#D69E00" }),
    );
    const al = $("#nov-alertas");
    clear(al);
    if (!(cli.alertas || []).length) appendText(al, "p", "Sin alertas registradas.", "panel-description");
    (cli.alertas || []).forEach((a) => {
      const row = node("div", "nov-alerta");
      const b = node("button", "link-button", a.municipio);
      b.type = "button";
      b.addEventListener("click", () => abrirMunicipio(a.divipola));
      row.append(b);
      appendText(row, "span", a.departamento, "nov-depto");
      appendText(row, "p", a.texto.charAt(0).toUpperCase() + a.texto.slice(1), "nov-alerta-texto");
      if (a.url) addLink(row, "Ver fuente", a.url, "doc-link");
      al.append(row);
    });
    const feed = feedNovedades();
    const sel = $("#nov-depto");
    if (sel.options.length < 2) {
      [...new Set(municipalities.map((m) => m.departamento))].sort((x, y) => x.localeCompare(y, "es")).forEach((d) => sel.append(new Option(d, d)));
      Object.entries(TIPO_DOC).forEach(([k, v]) => $("#nov-clase").append(new Option(v, k)));
      ["#nov-depto", "#nov-clase"].forEach((id) => $(id).addEventListener("change", () => { novedadesVisibles = 40; renderNovedadesFeed(); }));
      $("#nov-q").addEventListener("input", () => { novedadesVisibles = 40; renderNovedadesFeed(); });
    }
    if (feed.tipo === "captura") {
      $("#nov-feed-eyebrow").textContent = "ÚLTIMA CAPTURA";
      $("#nov-feed-title").textContent = "Cambios tributarios por municipio";
      $("#nov-feed-note").textContent = `Documentos tributarios nuevos o modificados en los sitios oficiales (captura del ${cli.captura}).`;
    } else {
      $("#nov-feed-eyebrow").textContent = "ÚLTIMOS 30 DÍAS";
      $("#nov-feed-title").textContent = "Publicaciones tributarias recientes";
      $("#nov-feed-note").textContent = `La última captura (${cli.captura || "sin fecha"}) no trajo cambios tributarios nuevos. Se muestran los documentos tributarios publicados en los últimos 30 días.`;
    }
    renderNovedadesFeed.feed = feed;
    renderNovedadesFeed();
  }

  function renderNovedadesFeed() {
    const feed = renderNovedadesFeed.feed || { grupos: [] };
    const depto = $("#nov-depto").value;
    const clase = $("#nov-clase").value;
    const q = normalize($("#nov-q").value);
    const grupos = feed.grupos
      .filter((g) => (!depto || g.departamento === depto) && (!q || normalize(g.municipio).includes(q)))
      .map((g) => ({ ...g, items: clase ? g.items.filter((i) => i.clase === clase) : g.items }))
      .filter((g) => g.items.length);
    const box = $("#nov-feed");
    clear(box);
    if (!grupos.length) { appendText(box, "p", "No hay documentos para este filtro.", "panel-description"); return; }
    grupos.slice(0, novedadesVisibles).forEach((g) => {
      const card = node("div", "nov-group");
      const head = node("div", "nov-group-head");
      const b = node("button", "link-button nov-muni", g.municipio);
      b.type = "button";
      b.addEventListener("click", () => abrirMunicipio(g.divipola));
      head.append(b);
      appendText(head, "span", `${g.departamento} · ${formatNumber(g.items.length)} ${g.items.length === 1 ? "documento" : "documentos"}`, "nov-depto");
      card.append(head);
      const list = node("ul", "nov-items");
      g.items.slice(0, 6).forEach((i) => {
        const li = node("li");
        appendText(li, "span", TIPO_DOC[i.clase] || i.clase, `doc-type tipo-${i.clase}`);
        const body = node("div", "nov-item-body");
        if (i.url) addLink(body, i.nombre, i.url, "doc-link");
        else appendText(body, "span", i.nombre);
        if (i.descripcion) appendText(body, "div", i.descripcion, "doc-meta");
        appendText(body, "div", [i.fecha ? `${i.fecha} (${haceTexto(i.fecha)})` : "", i.detalle].filter(Boolean).join(" · "), "doc-meta");
        li.append(body);
        list.append(li);
      });
      if (g.items.length > 6) appendText(list, "li", `y ${formatNumber(g.items.length - 6)} más en la ficha del municipio`, "doc-meta");
      card.append(list);
      box.append(card);
    });
    if (grupos.length > novedadesVisibles) {
      const more = node("button", "text-button", `Mostrar más municipios (${formatNumber(grupos.length - novedadesVisibles)} restantes)`);
      more.type = "button";
      more.addEventListener("click", () => { novedadesVisibles += 40; renderNovedadesFeed(); });
      box.append(more);
    }
  }

  function estadoDoc(doc) {
    if (!doc) return null;
    if (doc.revisado) return ["Revisado a mano", "success"];
    if (doc.validacion === "validado") return ["Verificado", "success"];
    if (doc.confianza === "alta") return ["Candidato", ""];
    return ["Por verificar", "warning"];
  }

  function esencialCard(grid, titulo, codigo, doc, pie) {
    const card = node("div", `esencial-card${doc ? " has" : ""}`);
    const head = node("div", "esencial-head");
    appendText(head, "h4", titulo);
    appendText(head, "span", codigo, "esencial-code");
    card.append(head);
    if (doc) {
      if (doc.url) addLink(card, doc.nombre, doc.url, "doc-link esencial-link");
      else appendText(card, "div", doc.nombre, "table-name");
      if (doc.descripcion) appendText(card, "div", doc.descripcion, "doc-meta");
      const meta = node("div", "esencial-meta");
      const est = estadoDoc(doc);
      if (est) setBadge(meta, est[0], est[1]);
      if (doc.fecha) appendText(meta, "span", `${doc.fecha} · ${haceTexto(doc.fecha)}`, "doc-meta");
      card.append(meta);
    } else appendText(card, "div", "Sin documento identificado todavía", "doc-meta esencial-vacio");
    if (pie) appendText(card, "div", pie, "esencial-pie");
    grid.append(card);
  }

  function claveDoc(item, clase) {
    const k = (item.documentos_clave || {})[clase];
    return k ? { nombre: k.nombre, url: k.url_pagina, descripcion: k.descripcion || "", fecha: k.fecha, confianza: k.confianza, validacion: k.validacion } : null;
  }

  function renderEsenciales(container, item) {
    const sec = fichaSection(container, "Lo esencial", "El documento principal de cada tema, con su fuente oficial");
    const grid = node("div", "esencial-grid");
    const cur = item.curaduria || {};
    const curDoc = (texto, url) => (url && !NO_DATO_RX.test(texto || "") ? { nombre: texto, url, revisado: true, fecha: "" } : null);
    const cal = curDoc(cur.calendario_2026, cur.url_calendario_2026) || claveDoc(item, "calendario");
    const vig = item.cosecha && item.cosecha.calendario_vigente ? `Calendario del año vigente: ${item.cosecha.calendario_vigente}` : "";
    esencialCard(grid, "Calendario tributario", "E3", cal, vig);
    esencialCard(grid, "Estatuto tributario", "E1 · E4", curDoc(cur.estatuto, cur.url_estatuto) || claveDoc(item, "estatuto"), "");
    const tarifa = claveDoc(item, "tarifa");
    const ica = tarifa || claveDoc(item, "ica");
    esencialCard(grid, "Tarifas de ICA", "E1", ica, tarifa ? "" : ica ? "Documento de ICA; aún sin documento específico de tarifas" : "");
    esencialCard(grid, "ReteICA y autorretención", "E2", claveDoc(item, "reteica"), item.n_autorreteica ? `${formatNumber(item.n_autorreteica)} documentos de autorretención` : "");
    esencialCard(grid, "Medios magnéticos", "E8", claveDoc(item, "exogena"), "");
    const portal = item.portal_tributario || (cur.portal_tributario || "");
    const canal = portal ? { nombre: item.tipo_portal === "pasarela" ? "Pago en línea (pasarela)" : "Portal tributario", url: portal,
      revisado: item.estado_portal === "confirmado" || Boolean(cur.portal_tributario), confianza: item.estado_portal === "confirmado" ? "alta" : "probable", fecha: "" } : null;
    esencialCard(grid, "Canal de presentación y pago", "E7", canal, item.url_calendario ? "" : "");
    sec.append(grid);
  }

  function renderNovedadesFicha(container, item) {
    const nov = item.novedades_semana || [];
    if (!nov.length) return;
    const sec = fichaSection(container, "Cambios en la última captura", "Documentos tributarios nuevos o modificados");
    const list = node("ul", "nov-items");
    nov.forEach((i) => {
      const li = node("li");
      appendText(li, "span", TIPO_DOC[i.clase] || i.clase, `doc-type tipo-${i.clase}`);
      const body = node("div", "nov-item-body");
      if (i.url) addLink(body, i.nombre, i.url, "doc-link"); else appendText(body, "span", i.nombre);
      appendText(body, "div", [i.fecha, i.cambio === "nuevo" ? "nuevo" : "modificado", contenidoCliente(i.contenido)].filter(Boolean).join(" · "), "doc-meta");
      li.append(body);
      list.append(li);
    });
    sec.append(list);
  }

  function renderAll() {
    $("#generated-date").textContent = `Datos al ${summary.fecha_generacion}`;
    const groupTotal = summary.grupo_trabajo.filter((item) => item.nombre !== "ok").reduce((sum, item) => sum + item.cantidad, 0);
    $("#nav-pending-count").textContent = formatNumber(groupTotal);
    renderKpis();
    renderFunnel();
    renderGroupSummary();
    renderDepartmentChart();
    renderPlatformQuality();
    renderHealth();
    renderFase2();
    renderNovedades();
    setupPendingFilters();
    setupSearch();
    setupTabs();
    renderPendingTable();
  }

  async function start() {
    try {
      const data = await loadData();
      municipalities = Array.isArray(data.municipios) ? data.municipios : [];
      summary = data.resumen;
      if (!municipalities.length || !summary || !summary.totales) throw new Error("Los archivos de datos están vacíos o tienen un formato inesperado.");
      renderAll();
    } catch {
      const box = $("#load-error");
      box.hidden = false;
      box.textContent = SERVER_GUIDANCE;
      $$(".view").forEach((view) => { view.hidden = true; });
    }
  }

  // ---------- Glosario: entregables (E1 a E10) y términos de la app ----------
  const GLOSARIO_ENTREGABLES = [
    ["E1", "Tarifas de ICA por actividad", "Tarifa (por mil) que cobra el municipio a cada actividad económica, con su código y el artículo que la fija. Alimenta la Matriz ICA y la liquidación del impuesto."],
    ["E2", "Reglas de ReteICA", "Quién es agente de retención o autorretenedor, base mínima, tarifa, periodicidad y formulario."],
    ["E3", "Fechas y descuentos del calendario", "Fechas límite de declaración y pago (por dígito de NIT o tipo de contribuyente) y descuentos por pronto pago."],
    ["E4", "Qué cambió y desde cuándo", "Norma nueva, qué artículo modifica o deroga y desde qué fecha aplica. Base de las alertas de cambio normativo."],
    ["E5", "Beneficios y amnistías", "Descuentos extraordinarios, condonación de intereses o sanciones e incentivos por actividad o zona."],
    ["E6", "Sanciones, plazos de corrección y UVT", "Sanción mínima, intereses, plazo para corregir y valor de la UVT del año."],
    ["E7", "Canal de presentación y pago", "Portal tributario o sede electrónica, formulario, bancos y medio obligatorio."],
    ["E8", "Exógena o medios magnéticos", "Quién debe reportar información de terceros al municipio, qué, cuándo y en qué formato."],
    ["E9", "Territorialidad y régimen SIMPLE", "Dónde se causa el ICA según la actividad y cómo se integra al régimen SIMPLE."],
    ["E10", "Alerta temprana del Concejo", "Proyectos de acuerdo que reformarían el estatuto antes de aprobarse. Aún no se recolecta."],
  ];
  const GLOSARIO_TERMINOS = [
    ["Candidato", "Documento hallado por su nombre o descripción. Todavía no se ha leído ni validado."],
    ["Probable", "Candidato con señales débiles (por ejemplo, un estatuto que solo se menciona). Necesita revisión humana."],
    ["Validado", "Documento que una persona confirmó como correcto en la hoja Validaciones."],
    ["Con API / Sin API", "Con API: el sitio usa Mi Colombia Digital y se consulta sin navegador. Sin API: otra plataforma (SharePoint, Nexura, WordPress…), con su propia técnica."],
    ["Nuevo", "Documento creado desde la captura anterior."],
    ["Primera vista", "Documento que ya existía y apenas entró a la ventana de captura. Se lista, pero no cuenta como cambio."],
    ["Modificado", "Documento ya conocido al que le cambió el nombre, la descripción, el archivo o solo la fecha."],
    ["Retirado", "Documento que estaba en la captura anterior y ya no aparece."],
    ["Por revisar", "Cambio tributario (no noticia), nuevo o modificado, no duplicado, que pide lectura."],
    ["Huella", "Resumen (hash) de un documento o página. Si no cambia, no se vuelve a leer."],
    ["Ventana insuficiente", "La captura no alcanzó a llegar hasta la captura anterior; puede faltar algún cambio de ese sitio."],
    ["Portal tributario", "Aplicación aparte donde el municipio recibe declaraciones y pagos. Pasarela: botón de pago genérico (PSE, Wompi)."],
  ];
  const NOMBRE_ENTREGABLE = Object.fromEntries(GLOSARIO_ENTREGABLES.map(([c, n]) => [c, n]));

  function buildGlossary() {
    const body = document.getElementById("glossary-body");
    if (!body || body.childElementCount) return;
    const seccion = (id, titulo, filas) => {
      const box = node("section", "glossary-section");
      box.id = "glossary-" + id;
      appendText(box, "h3", titulo);
      const dl = node("dl", "glossary-list");
      filas.forEach(([t, n, d]) => {
        const dt = node("dt");
        dt.id = "glossary-item-" + t.replace(/\W+/g, "-").toLowerCase();
        dt.textContent = d ? `${t} · ${n}` : t;
        const dd = node("dd");
        dd.textContent = d || n;
        dl.append(dt, dd);
      });
      box.append(dl);
      body.append(box);
    };
    seccion("entregables", "Entregables (lo que valoran los clientes de Péntica)", GLOSARIO_ENTREGABLES);
    seccion("terminos", "Términos de la app", GLOSARIO_TERMINOS.map(([t, d]) => [t, d]));
  }

  function openGlossary(target) {
    buildGlossary();
    const dlg = document.getElementById("glossary");
    if (!dlg) return;
    if (!dlg.open) dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "");
    const el = target && document.getElementById(target);
    if (el) { el.scrollIntoView({ block: "start" }); el.classList.add("glossary-flash"); setTimeout(() => el.classList.remove("glossary-flash"), 1600); }
  }

  const CODIGOS_RX = /^\s*E(10|[1-9])(\s*[·,]\s*E(10|[1-9]))*\s*$/;
  function annotateCodes(root) {
    root.querySelectorAll("td, th, span, strong, small").forEach((el) => {
      if (el.dataset.codeHint || el.childElementCount) return;
      const txt = el.textContent || "";
      if (txt.length > 40 || !CODIGOS_RX.test(txt)) return;
      const codigos = txt.match(/E(10|[1-9])/g) || [];
      el.dataset.codeHint = "1";
      el.classList.add("code-hint");
      el.title = codigos.map((c) => `${c} · ${NOMBRE_ENTREGABLE[c] || ""}`).join("\n") + "\n(clic para ver el glosario)";
      el.addEventListener("click", (ev) => { ev.stopPropagation(); openGlossary("glossary-item-" + codigos[0].toLowerCase()); });
    });
  }

  function startGlossary() {
    const btn = document.getElementById("open-glossary");
    if (btn) btn.addEventListener("click", () => openGlossary());
    const close = document.getElementById("close-glossary");
    const dlg = document.getElementById("glossary");
    if (close && dlg) close.addEventListener("click", () => (dlg.close ? dlg.close() : dlg.removeAttribute("open")));
    if (dlg) dlg.addEventListener("click", (ev) => { if (ev.target === dlg && dlg.close) dlg.close(); });
    document.querySelectorAll("[data-glossary]").forEach((b) => b.addEventListener("click", () => openGlossary("glossary-" + b.dataset.glossary)));
    const main = document.querySelector(".main-content");
    if (main) {
      let pendiente = null;
      new MutationObserver(() => { clearTimeout(pendiente); pendiente = setTimeout(() => annotateCodes(main), 150); })
        .observe(main, { childList: true, subtree: true });
      annotateCodes(main);
    }
  }

  document.addEventListener("DOMContentLoaded", start);
  document.addEventListener("DOMContentLoaded", startGlossary);
})();
