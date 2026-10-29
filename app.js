(() => {
  "use strict";

  const SERVER_GUIDANCE = "Abre el dashboard con un servidor: ejecuta python3 -m http.server en la raíz del proyecto y entra a http://localhost:8000/MTIP_APP/.";
  const GROUP_LABELS = {
    sin_sitio: "Sin sitio",
    revision_manual: "Revisión manual",
    sin_clasificar: "Sin clasificar",
    api_sin_cosecha: "API sin cosecha",
    ok: "Sin acción pendiente",
  };
  const GROUP_COLORS = {
    sin_sitio: "#bd655b",
    revision_manual: "#be842f",
    sin_clasificar: "#6686a4",
    api_sin_cosecha: "#8876a5",
    ok: "#438574",
  };
  const PLATFORM_COLORS = { api: "#28766a", sin_clasificar: "#7390a8", sin_sitio: "#d59a56" };
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
      fetch("data_dashboard/municipios.json", { cache: "no-store" }),
      fetch("data_dashboard/resumen.json", { cache: "no-store" }),
    ]);
    if (!municipalityResponse.ok || !summaryResponse.ok) throw new Error(SERVER_GUIDANCE);
    const [items, totals] = await Promise.all([municipalityResponse.json(), summaryResponse.json()]);
    return { municipios: items, resumen: totals };
  }

  function activateTab(name) {
    const view = $(`#view-${name}`);
    if (!view) return;
    $$(".view").forEach((item) => item.classList.toggle("active", item === view));
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.tab === name));
    const labels = { resumen: "Resumen", entregables: "Entregables", semana: "Esta semana", validacion: "Validación", buscador: "Buscador", pendientes: "Pendientes", calidad: "Plataforma y calidad", salud: "Salud tributaria" };
    $("#topbar-section").textContent = labels[name] || "Resumen";
    if (window.location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
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
      : "Con sitio, plataforma no confirmada";
    const container = $("#summary-kpis");
    clear(container);
    const cards = [
      { label: "Municipios en registro", value: totals.municipios, foot: "Ver cola completa", color: "#3f7480", filter: "all" },
      { label: "Sitio identificado", value: totals.identificados, foot: `${formatPercent(totals.porcentaje_identificados)} del registro`, color: "#28766a", filter: "identificado" },
      { label: "Sin sitio hallado", value: totals.pendientes, foot: "Revisar candidatos y fuentes", color: "#c16d5f", filter: "sin_sitio" },
      { label: "Con API", value: totals.api, foot: `${formatPercent(totals.porcentaje_api)} del registro`, color: "#4e7eaa", filter: "api" },
      { label: "Sin clasificar", value: totals.sin_clasificar, foot: unclassifiedFoot, color: "#8393a1", filter: "sin_clasificar" },
    ];
    cards.forEach((card) => container.append(kpiCard(card)));
  }

  function renderFunnel() {
    const totals = summary.totales;
    $("#funnel-universe").textContent = `De ${formatNumber(totals.municipios)} municipios`;
    const steps = [
      { label: "Municipios del alcance", value: totals.municipios, color: "#27465a", filter: "all" },
      { label: "Con sitio identificado", value: totals.identificados, color: "#4d8190", filter: "identificado" },
      { label: "Con API Mi Colombia Digital", value: totals.api, color: "#28766a", filter: "api" },
      { label: "Calendario confirmado", value: totals.calendario_confirmado, color: "#92ae68", filter: "api" },
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
      row.style.setProperty("--group-color", GROUP_COLORS[item.nombre] || "#28766a");
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
      { key: "api", label: "Con API", color: "#28766a" },
      { key: "sin_api", label: "Sitio sin API", color: "#aebec8" },
      { key: "pendientes", label: "Sin sitio", color: "#d59655" },
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
        { count: item.api, color: "#28766a", title: "Con API" },
        { count: Math.max(0, item.identificados - item.api), color: "#aebec8", title: "Sitio identificado sin API" },
        { count: item.pendientes, color: "#d59655", title: "Sin sitio hallado" },
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
      fill.style.setProperty("--bar-color", item.color || options.color || "#28766a");
      track.append(fill);
      row.append(track);
      appendText(row, "strong", formatNumber(value) + (options.suffix || ""), "bar-value");
      container.append(row);
    });
  }

  function renderPlatformQuality() {
    const total = summary.totales.municipios;
    const platformRows = [
      { nombre: "Mi Colombia Digital · API", cantidad: summary.totales.api, color: "#28766a" },
      { nombre: "Sin clasificar", cantidad: summary.totales.sin_clasificar, color: "#7390a8" },
      { nombre: "Sin sitio hallado", cantidad: summary.totales.pendientes, color: "#d59655" },
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
    const platformCounts = Object.fromEntries(summary.sin_clasificar_desglose.map((item) => [item.nombre, item.cantidad]));
    const excelPlatformCount = (platformCounts["Otra (sin confirmar)"] || 0) + (platformCounts["No responde"] || 0);
    const noPlatformData = platformCounts["Sin dato en Registro"] || 0;
    $("#platform-breakdown-note").textContent = `El Excel informa ${formatNumber(excelPlatformCount)} (${formatNumber(platformCounts["Otra (sin confirmar)"] || 0)} “Otra” + ${formatNumber(platformCounts["No responde"] || 0)} “No responde”); el tablero agrega ${formatNumber(noPlatformData)} registros sin dato en Registro, para un total de ${formatNumber(summary.totales.sin_clasificar)}.`;
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
    renderBarList("#freshness-bars", summary.por_frescura, { color: "#4e7eaa" });
    $("#freshness-cutoff").textContent = `Snapshot cutoff: ${summary.fecha_corte_snapshot || "unavailable"}`;
    const calendarColors = { "Sí": "#438574", "Probable": "#d09a4b", "No": "#7d92a0", "Sin dato": "#bfc9ce" };
    renderBarList("#calendar-bars", summary.por_calendario.map((item) => ({ ...item, color: calendarColors[item.nombre] || "#8899a1" })));
    renderBarList("#coverage-bars", summary.cobertura_contenido.map((item) => ({
      ...item,
      nombre: `${item.nombre} · ${formatPercent(item.porcentaje)}`,
      color: "#4e8d7f",
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
      case "sin_clasificar": return `Sitio identificado; plataforma sin confirmar (${item.plataforma_origen.replaceAll("_", " ")}).`;
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
      ["sin_clasificar", "Sin clasificar"],
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

  function showMunicipality(item) {
    selectedMunicipality = item;
    const container = $("#municipality-detail");
    clear(container);
    container.className = "municipality-detail panel";

    const heading = node("div", "detail-header");
    const identity = node("div");
    appendText(identity, "h2", item.municipio);
    appendText(identity, "div", `${item.departamento} · ${formatNumber(item.poblacion)} habitantes`, "detail-location");
    appendText(identity, "div", `DIVIPOLA ${item.divipola}`, "detail-code");
    heading.append(identity);
    const badges = node("div", "badge-row");
    setBadge(badges, item.estado === "identificado" ? "Sitio identificado" : "Sin sitio hallado", item.estado === "identificado" ? "success" : "danger");
    const platformLabel = item.plataforma === "api" ? "Mi Colombia Digital · API"
      : item.plataforma === "sin_clasificar" ? "Sin clasificar" : "Sin sitio";
    setBadge(badges, platformLabel, item.plataforma === "api" ? "success" : item.plataforma === "sin_clasificar" ? "warning" : "danger");
    setBadge(badges, `Confianza ${item.confianza}`, normalize(item.confianza) === "alta" ? "success" : normalize(item.confianza) === "pendiente de revision" ? "warning" : "");
    heading.append(badges);
    container.append(heading);

    const links = node("div", "detail-links");
    if (item.sitio_url) addLink(links, "Sitio municipal", item.sitio_url, "detail-link");
    if (item.url_normativa) addLink(links, "Normatividad", item.url_normativa, "detail-link");
    if (item.url_calendario) addLink(links, "Hacienda / calendario", item.url_calendario, "detail-link");
    if (item.subdominio_api) appendText(links, "span", `API: ${item.subdominio_api}`, "badge");
    container.append(links);

    const meta = node("div", "detail-meta");
    addMeta(meta, "Método de hallazgo", item.metodo_hallazgo);
    addMeta(meta, "Contenido verificado", item.contenido_verificado);
    addMeta(meta, "Última verificación", item.fecha_verificacion);
    addMeta(meta, "Última captura del sitio", item.snapshot ? item.snapshot.fecha_captura : "Sin captura");
    container.append(meta);

    if (item.notas) {
      const note = node("p", "detail-note", item.notas);
      container.append(note);
    }

    if (item.estado === "pendiente") {
      const notice = node("div", "detail-note");
      appendText(notice, "strong", "Motivo: ");
      appendText(notice, "span", item.metodo_hallazgo || "El registro indica que no se encontró un sitio.");
      appendText(notice, "br", "");
      appendText(notice, "strong", "Siguiente acción: ");
      appendText(notice, "span", "Buscar en directorios oficiales y confirmar un candidato con evidencia de la alcaldía.");
      container.append(notice);
    }

    if (!item.cosecha && item.plataforma !== "api") {
      appendText(container, "p", `Sin recolección todavía. Técnica probable: ${item.tecnica || "sin clasificar"}.`, "detail-note");
    }

    if (!item.cosecha && item.plataforma === "api") {
      appendText(container, "p", "Pendiente de cosecha: la plataforma tiene API, pero este municipio no aparece en el archivo local de cosecha.", "detail-note");
    }

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
      container.append(grid);
      if (harvest.ultima_norma_nombre) appendText(container, "p", `Última norma: ${harvest.ultima_norma_nombre}`, "detail-note");
    }

    if (item.cosecha && summary.fase2) {
      const evidence = node("section");
      const evHeader = node("div", "section-title");
      appendText(evHeader, "h3", "Entregables con documento candidato");
      appendText(evHeader, "span", "Hallado por nombre o descripción; aún no validado");
      evidence.append(evHeader);
      const chips = node("div", "entregable-chips");
      summary.fase2.entregables.forEach((entry) => {
        const has = (item.entregables || []).includes(entry.codigo);
        const chip = setBadge(chips, `${entry.codigo} · ${entry.nombre}`, has ? "success" : "muted");
        chip.title = has ? "Hay un documento candidato" : "Sin documento candidato todavía";
      });
      const statute = item.cosecha.estatuto_estado || "sin dato";
      setBadge(chips, `Estatuto: ${statute}`, statute === "alta" ? "success" : statute === "probable" ? "warning" : "danger");
      if (item.cosecha.calendario_estado) setBadge(chips, `Calendario: ${item.cosecha.calendario_estado}`, item.cosecha.calendario_estado === "Sí" ? "success" : item.cosecha.calendario_estado === "Probable" ? "warning" : "danger");
      evidence.append(chips);
      if (item.cosecha.mejor_estatuto) appendText(evidence, "p", `Estatuto detectado: ${item.cosecha.mejor_estatuto}`, "detail-note");
      if (item.cosecha.estatuto_estado === "probable") appendText(evidence, "p", "Este estatuto es un candidato por palabras clave; confírmalo antes de usarlo.", "detail-note");
      container.append(evidence);
      const keyDocs = Object.values(item.documentos_clave || {});
      const keySection = node("section");
      renderDocumentSection(keySection, "Documentos tributarios clave", keyDocs, `${formatNumber(item.n_archivos)} archivos adjuntos en total`);
      container.append(keySection);
    }

    const tax = node("section");
    renderDocumentSection(tax, "Últimos documentos tributarios", item.documentos_tributarios, "Clasificación provisional; revisar confianza");
    container.append(tax);

    const recent = item.documentos_recientes || { normatividad: [], otros: [] };
    const recentSection = node("section");
    const recentHeader = node("div", "section-title");
    appendText(recentHeader, "h3", "Últimos publicados en el sitio");
    recentSection.append(recentHeader);
    appendText(recentSection, "p", "Ordenados por fecha disponible en el archivo local; Normatividad aparece por separado.", "panel-description");
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
      const section = doc.seccion || "Sin sección";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(doc);
    });
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")).forEach(([section, docs]) => {
      const block = node("div", "section-block");
      appendText(block, "h4", section);
      const list = node("div", "doc-list");
      docs.forEach((doc) => linkListItem(list, doc));
      block.append(list);
      recentSection.append(block);
    });
    container.append(recentSection);
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
      appendText(identity, "span", `${item.departamento} · ${item.estado === "pendiente" ? "Sin sitio" : item.plataforma === "api" ? "Con API" : "Sin clasificar"}`, "suggestion-meta");
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
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
    $$('[data-go-tab="pendientes"]').forEach((button) => button.addEventListener("click", () => navigatePending("all")));
    const hash = window.location.hash.replace("#", "");
    if (["resumen", "entregables", "semana", "validacion", "buscador", "pendientes", "calidad", "salud"].includes(hash)) activateTab(hash);
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

  const CLASE_LABELS = { ica: "ICA", reteica: "ReteICA", estatuto: "Estatuto", calendario: "Calendario", otro: "Otro" };
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
    $("#wk-count").textContent = `${formatNumber(rows.length)} cambios`;
    rows.slice(0, weekVisible).forEach((row) => {
      const tr = node("tr");
      appendText(tr, "td", row.municipio);
      appendText(tr, "td", row.nombre);
      appendText(tr, "td", CLASE_LABELS[row.clase] || "Sin clasificar");
      appendText(tr, "td", (row.entregables || []).join(" · ") || "—");
      const kindCell = node("td");
      setBadge(kindCell, row.cambio === "modificado" && row.nivel === "solo_fecha" ? "modificado (solo fecha)" : row.cambio, row.cambio === "nuevo" ? "success" : row.cambio === "desaparecido" ? "danger" : "warning");
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
      staticKpi({ label: "Documentos nuevos", value: formatNumber(by.nuevo || 0), foot: `${week.captura_anterior} → ${week.captura_actual}`, color: "#28766a" }),
      staticKpi({ label: "Modificados con cambio real", value: formatNumber(lvl.atributos || 0), foot: "Cambió nombre, descripción o archivo", color: "#be842f" }),
      staticKpi({ label: "Modificados solo de fecha", value: formatNumber(lvl.solo_fecha || 0), foot: "Probable edición sin cambio visible", color: "#8b989e" }),
      staticKpi({ label: "Retirados", value: formatNumber(by.desaparecido || 0), foot: "Dejaron de aparecer", color: "#bd655b" }),
      staticKpi({ label: "Tributarios en la lista", value: formatNumber(tax), foot: week.municipios_sin_captura ? `${formatNumber(week.municipios_sin_captura)} municipios sin captura buena` : "De ICA, ReteICA, estatuto o calendario", color: "#4e7eaa" }),
    );
    if (!$("#wk-clase").dataset.ready) {
      $("#wk-clase").dataset.ready = "1";
      [["tributarias", "Solo tributarias"], ["todas", "Todas"], ["ica", "ICA"], ["reteica", "ReteICA"], ["estatuto", "Estatuto"], ["calendario", "Calendario"]].forEach(([value, label]) => $("#wk-clase").append(new Option(label, value)));
      [["all", "Todos"], ["nuevo", "Nuevo"], ["modificado", "Modificado"], ["desaparecido", "Retirado"]].forEach(([value, label]) => $("#wk-cambio").append(new Option(label, value)));
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
      staticKpi({ label: "Pendientes", value: formatNumber(v.pendientes), foot: "Sin decisión registrada", color: "#be842f" }),
      staticKpi({ label: "Validados", value: formatNumber(v.validado), foot: "Documento correcto", color: "#28766a" }),
      staticKpi({ label: "Descartados", value: formatNumber(v.descartado), foot: "No es el documento", color: "#bd655b" }),
      staticKpi({ label: "Por corregir", value: formatNumber(v.corregir), foot: "Clasificación equivocada", color: "#4e7eaa" }),
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
      staticKpi({ label: "Población en municipios con API", value: formatPercent(f2.pct_poblacion_con_api), foot: `${formatNumber(f2.municipios_sin_api)} municipios sin API suman ${formatPercent(f2.pct_poblacion_sin_api)} de la población`, color: "#28766a" }),
      ...(f2.sharepoint && f2.sharepoint.municipios ? [staticKpi({ label: "Sin API con documentos (SharePoint)", value: formatNumber(f2.sharepoint.municipios), foot: `${formatPercent(f2.sharepoint.pct_poblacion)} de la población; son candidatos por nombre, sin validar`, color: "#6b8f3a" })] : []),
      staticKpi({ label: "Municipios cosechados", value: formatNumber(f2.municipios_cosechados), foot: "Con documentos tributarios hallados", color: "#4e7eaa" }),
      staticKpi({ label: "Documentos con archivo", value: formatNumber(f2.archivos.documentos_con_archivo), foot: `${formatNumber(f2.archivos.total)} archivos${pdf ? `; ${formatNumber(pdf.cantidad)} PDF` : ""}`, color: "#be842f" }),
      staticKpi({ label: "Estatuto por validar", value: formatNumber((f2.estatuto.find((entry) => entry.nombre === "probable") || {}).cantidad || 0), foot: "Candidatos «probable» sin confirmar", color: "#8876a5" }),
      staticKpi({ label: "Cambios de la semana", value: f2.cambios.disponible ? formatNumber(f2.cambios.total) : "—", foot: f2.cambios.disponible ? `${f2.cambios.captura_anterior} → ${f2.cambios.captura_actual}` : "Falta la segunda captura semanal", color: "#bd655b" }),
    );
    const tarifa = f2.e1_con_tarifa;
    $("#f2-municipios-note").textContent = `Sobre ${formatNumber(f2.municipios_cosechados)} municipios cosechados. E1 cuenta cualquier documento de ICA; con un documento de tarifas propiamente dicho hay ${formatNumber(tarifa.municipios)} (${formatPercent(tarifa.pct_cosechados)}).`;
    renderBarList("#f2-ent-municipios", f2.entregables.map((entry) => ({ nombre: `${entry.codigo} · ${entry.nombre}`, cantidad: entry.municipios })));
    renderBarList("#f2-ent-poblacion", f2.entregables.map((entry) => ({ nombre: `${entry.codigo} · ${entry.nombre}`, cantidad: Math.round(entry.pct_poblacion * 1000) / 10 })), { suffix: "%", color: "#4e7eaa" });
    const stateColors = { alta: "#28766a", probable: "#be842f", no: "#bd655b", "Sí": "#28766a", Probable: "#be842f", No: "#bd655b" };
    renderBarList("#f2-estatuto", f2.estatuto.map((entry) => ({ ...entry, color: stateColors[entry.nombre] })));
    renderBarList("#f2-calendario", f2.calendario.map((entry) => ({ ...entry, color: stateColors[entry.nombre] })));

    renderBarList("#f2-sin-api", (f2.sin_api_por_tecnica || []).map((entry) => ({ nombre: `${entry.nombre} · ${formatNumber(entry.municipios)} municipios`, cantidad: Math.round(entry.pct_poblacion * 1000) / 10 })), { suffix: "%", color: "#bd655b" });

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

  document.addEventListener("DOMContentLoaded", start);
})();
