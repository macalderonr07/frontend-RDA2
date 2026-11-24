// js/controllers/reportes.controller.js
// CONTROLADOR de "Reportes y tableros":
//  - #/reportes: periodo, indicadores (KPI) con variacion, el TABLERO general
//    (widgets que la API describe en /reportes/tableros) y el catalogo de
//    reportes por categoria, cada uno con la pregunta que responde;
//  - #/reportes/:id: el reporte con su periodo, totales, grafico, tabla
//    ordenable y descarga CSV.
// El periodo vive en la URL (#/reportes?desde=...&hasta=...): se puede
// compartir el enlace y los widgets enlazan al detalle con el mismo periodo.
import { anunciar, el, montar } from "../core/dom.js";
import { navegar } from "../core/router.js";
import { ReporteModelo } from "../models/negocio.model.js";
import { alerta, cargando, encabezado } from "../views/componentes.js";
import { atajosPeriodo, descargarCsv, filtroPeriodo, grafico, tablaReporte, tarjetaIndicador, totales, widget } from "../views/reportes.view.js";

const contenido = () => document.getElementById("contenido");

function periodoDeUrl(consulta) {
    const porDefecto = atajosPeriodo()["30"];
    return {
        desde: consulta?.get("desde") || porDefecto.desde,
        hasta: consulta?.get("hasta") || porDefecto.hasta,
        agrupar: consulta?.get("agrupar") || undefined,
    };
}
const aQuery = (p) => `?${new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString()}`;

// ------------------------------------------------------------------ Tablero + catalogo
export async function lista({ consulta } = {}) {
    const periodo = periodoDeUrl(consulta);
    montar(contenido(), cargando("Cargando reportes y tableros…"));
    let catalogo, categorias, tablero, kpis;
    try {
        const [cat, tabs, ind] = await Promise.all([ReporteModelo.catalogo(), ReporteModelo.tableros(), ReporteModelo.indicadores(periodo)]);
        catalogo = cat.data;
        categorias = cat.meta.categorias;
        tablero = tabs[0];
        kpis = ind;
    } catch (error) {
        montar(contenido(), encabezado({ titulo: "Reportes y tableros" }), alerta("danger", error.message, { titulo: "No se pudieron cargar los reportes" }));
        return;
    }

    // widgets del tablero: cada uno pide su reporte; si uno falla, los demas siguen
    const zonaWidgets = el("div", { class: "grilla-widgets" });
    const pendientes = (tablero?.widgets ?? []).filter((w) => w.tipo === "reporte");
    for (const w of pendientes) {
        const hueco = el("div", { class: `widget widget-${w.ancho ?? "medio"} card` }, el("div", { class: "card-body" }, el("p", { class: "mb-0" }, "Cargando…")));
        zonaWidgets.append(hueco);
        ReporteModelo.ejecutar(w.reporte, { ...periodo, agrupar: periodo.agrupar })
            .then(({ data, meta }) => hueco.replaceWith(widget({ meta, filas: data, limite: w.limite, ancho: w.ancho, periodoQuery: aQuery({ desde: periodo.desde, hasta: periodo.hasta }) })))
            .catch((error) => montar(hueco, el("div", { class: "card-body" }, alerta("danger", error.message, { titulo: `No se pudo cargar ${w.reporte}` }))));
    }

    montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
        encabezado({ titulo: "Reportes y tableros", descripcion: "Cómo va el negocio y las respuestas a las preguntas de todos los días. Los calcula la base de datos." }),
        filtroPeriodo({ periodo, alAplicar: (p) => navegar(`/reportes${aQuery({ desde: p.desde, hasta: p.hasta })}`) }),

        el("section", { class: "mb-4", "aria-labelledby": "tituloIndicadores" },
            el("h2", { class: "h5", id: "tituloIndicadores" }, "Indicadores del período"),
            el("div", { class: "grilla-indicadores" }, kpis.map(tarjetaIndicador))),

        tablero ? el("section", { class: "mb-4", "aria-labelledby": "tituloTablero" },
            el("h2", { class: "h5 mb-1", id: "tituloTablero" }, tablero.titulo),
            el("p", { class: "text-body-secondary" }, tablero.descripcion),
            zonaWidgets) : null,

        el("section", { "aria-labelledby": "tituloCatalogo" },
            el("h2", { class: "h5", id: "tituloCatalogo" }, "Todos los reportes"),
            categorias.filter((c) => catalogo.some((r) => r.categoria === c)).map((c) =>
                el("section", { class: "mb-3", "aria-labelledby": `cat-${c}` },
                    el("h3", { class: "h6 text-uppercase text-body-secondary", id: `cat-${c}` }, c),
                    tarjetasReportes(catalogo.filter((r) => r.categoria === c), periodo, "h4"))))));
}

// ------------------------------------------------------------------ Reportes de una categoria
/** Tarjetas de reportes (titulo enlazado + la pregunta que responde). */
function tarjetasReportes(lista, periodo, nivel = "h3") {
    return el("ul", { class: "grilla-reportes" }, lista.map((r) =>
        el("li", { class: "card" }, el("div", { class: "card-body" },
            el(nivel, { class: "h6 mb-1" }, el("a", { href: `#/reportes/${r.id}${r.parametros.includes("periodo") ? aQuery({ desde: periodo.desde, hasta: periodo.hasta }) : ""}`, class: "stretched-link" }, r.titulo)),
            el("p", { class: "small mb-0 text-body-secondary" }, r.pregunta)))));
}

export async function categoria({ categoria: nombre, consulta }) {
    const periodo = periodoDeUrl(consulta);
    montar(contenido(), cargando("Cargando reportes…"));
    try {
        const { data } = await ReporteModelo.catalogo();
        const lista = data.filter((r) => r.categoria === nombre);
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({ titulo: `Reportes de ${nombre.toLowerCase()}`, descripcion: "Elige la pregunta que quieres responder.", miga: [{ texto: "Reportes", href: "#/reportes" }, { texto: nombre }] }),
            lista.length
                ? tarjetasReportes(lista, periodo)
                : alerta("info", "No tienes reportes disponibles en esta categoría (dependen de los permisos de tu rol).")));
    } catch (error) {
        montar(contenido(), encabezado({ titulo: "Reportes" }), alerta("danger", error.message, { titulo: "No se pudieron cargar los reportes" }));
    }
}

// ------------------------------------------------------------------ Un reporte
export async function reporte({ nombre, consulta }) {
    const periodo = periodoDeUrl(consulta);
    montar(contenido(), cargando("Cargando el reporte…"));
    let data, meta;
    try {
        ({ data, meta } = await ReporteModelo.ejecutar(nombre, periodo));
    } catch (error) {
        montar(contenido(), encabezado({ titulo: "Reporte", miga: [{ texto: "Reportes", href: "#/reportes" }, { texto: "Reporte" }] }),
            alerta("danger", error.message, { titulo: "No se pudo cargar el reporte" }));
        return;
    }
    const r = meta.reporte;
    const agrupar = meta.parametros?.agrupar;
    const conGrafico = r.visual.tipo !== "tabla";
    montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
        encabezado({
            titulo: r.titulo,
            descripcion: r.pregunta,
            miga: [{ texto: "Reportes", href: "#/reportes" }, { texto: r.titulo }],
            acciones: data.length
                ? [el("button", { type: "button", class: "btn btn-outline-primary", onclick: () => { descargarCsv(r.id, r.columnas, data); anunciar("Se descargó el archivo CSV"); } }, "Descargar CSV (Excel)")]
                : [],
        }),
        r.parametros.includes("periodo")
            ? filtroPeriodo({ periodo: { ...periodo, agrupar }, conAgrupar: r.parametros.includes("agrupar"), alAplicar: (p) => navegar(`/reportes/${r.id}${aQuery(p)}`) })
            : el("p", { class: "small text-body-secondary" }, "Este reporte muestra la situación de hoy (no depende de un período)."),
        el("p", { class: "small text-body-secondary" }, `${data.length} fila${data.length === 1 ? "" : "s"} · generado ${new Date(meta.generado).toLocaleString("es-EC")}`),
        totales(meta),
        conGrafico && data.length
            ? el("section", { class: "card mb-3", "aria-labelledby": "tituloGrafico" }, el("div", { class: "card-body" },
                  el("h2", { class: "h6", id: "tituloGrafico" }, `Gráfico: ${r.columnas.find((c) => c.clave === r.visual.y[0]).titulo} por ${r.columnas.find((c) => c.clave === r.visual.x).titulo.toLowerCase()}`),
                  grafico({ titulo: r.titulo, filas: data, x: r.visual.x, y: r.visual.y[0], columnas: r.columnas, agrupar, limite: 25 })))
            : null,
        el("h2", { class: "h6" }, "Datos"),
        tablaReporte({ titulo: r.titulo, filas: data, columnas: r.columnas, agrupar })));
}
