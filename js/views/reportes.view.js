// js/views/reportes.view.js
// VISTAS de reportes y tableros. Todo se pinta a partir de los METADATOS que
// manda la API (tipo de cada columna, visual sugerido, totales), asi un
// reporte o un tablero nuevo no necesita una pantalla nueva:
//  - filtroPeriodo: periodo con atajos (ultimos 30 dias, este mes...) o fechas;
//  - tarjetaIndicador: KPI con su variacion frente al periodo anterior, en texto;
//  - grafico: barras horizontales accesibles (cada barra dice su valor en texto);
//  - widget: un reporte dentro de un tablero (grafico o tabla, segun su visual).
import { el, formato, nuevoId } from "../core/dom.js";
import { tabla } from "./componentes.js";

// ---------------------------------------------------------------- Formato por tipo
const mesAnio = new Intl.DateTimeFormat("es-EC", { month: "long", year: "numeric" });
const diaMes = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short" });

export function valorPorTipo(tipo, v, { agrupar } = {}) {
    if (v === null || v === undefined || v === "") return "—";
    if (tipo === "dinero") return formato.dinero(v);
    if (tipo === "numero") return formato.numero(v);
    if (tipo === "porcentaje") return `${formato.numero(v)} %`;
    if (tipo === "fecha") {
        if (agrupar === "mes") return mesAnio.format(new Date(v));
        if (agrupar === "semana") return `Semana del ${diaMes.format(new Date(v))}`;
        return formato.fecha(v);
    }
    return String(v);
}

// ---------------------------------------------------------------- Periodo
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function atajosPeriodo(hoy = new Date()) {
    const d = (y, m, dia) => new Date(y, m, dia);
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const restar = (n) => new Date(hoy.getTime() - n * 864e5);
    return {
        "7": { texto: "Últimos 7 días", desde: iso(restar(6)), hasta: iso(hoy) },
        "30": { texto: "Últimos 30 días", desde: iso(restar(29)), hasta: iso(hoy) },
        mes: { texto: "Este mes", desde: iso(d(y, m, 1)), hasta: iso(hoy) },
        anterior: { texto: "Mes anterior", desde: iso(d(y, m - 1, 1)), hasta: iso(d(y, m, 0)) },
        anio: { texto: "Este año", desde: iso(d(y, 0, 1)), hasta: iso(hoy) },
    };
}

/**
 * Filtro de periodo. periodo: { desde, hasta, agrupar? }; conAgrupar muestra
 * "Agrupar por". alAplicar({ desde, hasta, agrupar }).
 */
export function filtroPeriodo({ periodo, conAgrupar = false, alAplicar }) {
    const atajos = atajosPeriodo();
    const actual = Object.entries(atajos).find(([, a]) => a.desde === periodo.desde && a.hasta === periodo.hasta)?.[0] ?? "otro";
    const ids = { atajo: nuevoId("atajo"), desde: nuevoId("desde"), hasta: nuevoId("hasta"), agrupar: nuevoId("agrupar"), error: nuevoId("error-periodo") };
    const atajo = el("select", { id: ids.atajo, class: "form-select" },
        Object.entries(atajos).map(([k, a]) => el("option", { value: k, selected: k === actual }, a.texto)),
        el("option", { value: "otro", selected: actual === "otro" }, "Otras fechas…"));
    const desde = el("input", { id: ids.desde, type: "date", class: "form-control", value: periodo.desde, "aria-describedby": ids.error });
    const hasta = el("input", { id: ids.hasta, type: "date", class: "form-control", value: periodo.hasta, "aria-describedby": ids.error });
    // cada fecha es su propia celda de la barra (un contenedor d-flex ignoraria "hidden")
    const fechas = [
        el("div", { hidden: actual !== "otro" }, el("label", { class: "form-label", for: ids.desde }, "Desde"), desde),
        el("div", { hidden: actual !== "otro" }, el("label", { class: "form-label", for: ids.hasta }, "Hasta"), hasta),
    ];
    atajo.addEventListener("change", () => {
        fechas.forEach((f) => (f.hidden = atajo.value !== "otro"));
        if (atajo.value !== "otro") {
            desde.value = atajos[atajo.value].desde;
            hasta.value = atajos[atajo.value].hasta;
        }
    });
    const agrupar = conAgrupar
        ? el("div", {}, el("label", { class: "form-label", for: ids.agrupar }, "Agrupar por"),
              el("select", { id: ids.agrupar, class: "form-select" },
                  [["dia", "Día"], ["semana", "Semana"], ["mes", "Mes"]].map(([v, t]) => el("option", { value: v, selected: periodo.agrupar === v }, t))))
        : null;
    const error = el("p", { id: ids.error, class: "text-danger-emphasis small mb-0 w-100", "aria-live": "polite" });
    const form = el("form", { class: "barra-lista filtro-periodo", "aria-label": "Período del reporte" },
        el("div", {}, el("label", { class: "form-label", for: ids.atajo }, "Período"), atajo),
        fechas, agrupar,
        el("div", {}, el("button", { type: "submit", class: "btn btn-outline-primary w-100" }, "Aplicar")),
        error);
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        error.textContent = "";
        desde.removeAttribute("aria-invalid");
        if (!desde.value || !hasta.value) {
            error.textContent = "Elige las dos fechas.";
            (desde.value ? hasta : desde).setAttribute("aria-invalid", "true");
            (desde.value ? hasta : desde).focus();
            return;
        }
        if (desde.value > hasta.value) {
            error.textContent = "«Desde» debe ser anterior o igual a «Hasta».";
            desde.setAttribute("aria-invalid", "true");
            desde.focus();
            return;
        }
        alAplicar({ desde: desde.value, hasta: hasta.value, agrupar: conAgrupar ? form.querySelector(`#${ids.agrupar}`).value : undefined });
    });
    return form;
}

// ---------------------------------------------------------------- Indicadores
/** KPI: valor grande y su variacion EN TEXTO (subio/bajo, y si eso es bueno). */
export function tarjetaIndicador(k) {
    let comparacion = null;
    if (k.anterior !== null) {
        if (k.variacion === null) {
            comparacion = el("p", { class: "small mb-1 text-body-secondary" }, "Sin datos en el período anterior para comparar.");
        } else if (k.variacion === 0) {
            comparacion = el("p", { class: "small mb-1" }, "Igual que en el período anterior.");
        } else {
            const sube = k.variacion > 0;
            const bueno = sube === (k.mejorSi === "sube");
            comparacion = el("p", { class: `small mb-1 variacion ${bueno ? "buena" : "mala"}` },
                el("span", { "aria-hidden": "true" }, sube ? "▲ " : "▼ "),
                `${sube ? "Subió" : "Bajó"} ${formato.numero(Math.abs(k.variacion))} % frente al período anterior`,
                el("span", { class: "visually-hidden" }, bueno ? " (favorable)" : " (desfavorable)"));
        }
    }
    return el("article", { class: "indicador" },
        el("h3", { class: "h6 text-body-secondary mb-1" }, k.titulo),
        el("p", { class: "valor mb-1" }, valorPorTipo(k.tipo, k.valor)),
        comparacion,
        k.ayuda ? el("p", { class: "small mb-1 text-body-secondary" }, k.ayuda) : null,
        k.enlace ? el("a", { href: `#${k.enlace}`, class: "small" }, "Ver detalle", el("span", { class: "visually-hidden" }, `: ${k.titulo}`)) : null);
}

// ---------------------------------------------------------------- Grafico
/**
 * Barras horizontales accesibles. Cada barra es un elemento de lista con su
 * etiqueta y su valor en TEXTO (el lector de pantalla lee "Cueros: $1.122,58");
 * la barra es solo refuerzo visual (aria-hidden). Funciona igual para series
 * (una barra por dia, semana o mes) y para categorias.
 */
export function grafico({ titulo, filas, x, y, columnas, agrupar, limite = null }) {
    const colX = columnas.find((c) => c.clave === x);
    const colY = columnas.find((c) => c.clave === y);
    const lista = limite ? filas.slice(0, limite) : filas;
    const max = Math.max(...lista.map((f) => Math.abs(Number(f[y]) || 0)), 0);
    if (lista.length === 0) return el("p", { class: "alert alert-light border mb-0", role: "status" }, "Sin datos en este período.");
    return el("figure", { class: "grafico mb-0" },
        el("figcaption", { class: "visually-hidden" }, `${titulo}: ${colY.titulo} por ${colX.titulo.toLowerCase()}`),
        el("ul", { class: "grafico-barras" }, lista.map((f) => {
            const valor = Number(f[y]) || 0;
            const ancho = max ? Math.max(2, Math.round((Math.abs(valor) / max) * 100)) : 0;
            return el("li", {},
                el("span", { class: "grafico-etiqueta" }, valorPorTipo(colX.tipo, f[x], { agrupar })),
                el("span", { class: "grafico-pista", "aria-hidden": "true" }, el("span", { class: "grafico-barra", style: `width: ${ancho}%` })),
                el("span", { class: "grafico-valor" }, el("span", { class: "visually-hidden" }, ": "), valorPorTipo(colY.tipo, f[y])));
        })),
        limite && filas.length > limite ? el("p", { class: "small text-body-secondary mt-2 mb-0" }, `Se muestran los primeros ${limite} de ${filas.length}.`) : null);
}

/** Tabla de un reporte con formato por tipo de columna (ordenable). */
export function tablaReporte({ titulo, filas, columnas, agrupar }) {
    return tabla({
        titulo,
        filas,
        vacio: "Sin datos en este período.",
        columnas: columnas.map((c) => ({
            titulo: c.titulo,
            clave: c.clave,
            numerica: ["dinero", "numero", "porcentaje"].includes(c.tipo),
            tipoOrden: c.tipo === "fecha" ? "fecha" : ["dinero", "numero", "porcentaje"].includes(c.tipo) ? "numero" : "texto",
            valor: (f) => valorPorTipo(c.tipo, f[c.clave], { agrupar }),
        })),
    });
}

/** Fila de totales en texto ("Vendido: $340,26 · Pedidos: 22"). */
export function totales(meta) {
    const cols = meta.reporte.columnas.filter((c) => c.clave in (meta.totales ?? {}));
    if (!cols.length) return null;
    return el("p", { class: "totales-reporte", role: "status" },
        el("span", { class: "fw-semibold" }, "Totales: "),
        cols.map((c) => `${c.titulo}: ${valorPorTipo(c.tipo, meta.totales[c.clave])}`).join(" · "));
}

/** CSV (separado por ; para Excel en español) generado en el navegador con los datos ya cargados. */
export function descargarCsv(nombre, columnas, filas) {
    const celda = (v) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lineas = [columnas.map((c) => celda(c.titulo)).join(";"), ...filas.map((f) => columnas.map((c) => celda(f[c.clave])).join(";"))];
    const blob = new Blob([`﻿${lineas.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `${nombre}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Un reporte dentro de un tablero: titulo, pregunta, grafico o tabla y enlace al detalle. */
export function widget({ meta, filas, limite, ancho = "medio", periodoQuery }) {
    const r = meta.reporte;
    const idTitulo = nuevoId("widget");
    const cuerpo = r.visual.tipo === "tabla"
        ? tablaReporte({ titulo: r.titulo, filas: limite ? filas.slice(0, limite) : filas, columnas: r.columnas, agrupar: meta.parametros?.agrupar })
        : grafico({ titulo: r.titulo, filas, x: r.visual.x, y: r.visual.y[0], columnas: r.columnas, agrupar: meta.parametros?.agrupar, limite });
    return el("section", { class: `widget widget-${ancho} card`, "aria-labelledby": idTitulo },
        el("div", { class: "card-body" },
            el("h3", { class: "h5 mb-1", id: idTitulo }, r.titulo),
            el("p", { class: "small text-body-secondary" }, r.pregunta),
            cuerpo,
            totales(meta),
            el("a", { class: "small", href: `#/reportes/${r.id}${periodoQuery}` }, "Ver el reporte completo", el("span", { class: "visually-hidden" }, `: ${r.titulo}`))));
}
