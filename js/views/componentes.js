// js/views/componentes.js
// Piezas de VISTA reutilizables y accesibles: encabezado de vista (recibe el
// foco al navegar), alertas, tabla de datos con <caption> y <th scope>,
// paginacion, campos de formulario con etiqueta/ayuda/error enlazados y
// dialogo de confirmacion (modal de Bootstrap: atrapa el foco y cierra con Esc).
import { anunciar, el, montar, nuevoId } from "../core/dom.js";

/** Titulo de la vista + descripcion + acciones. Mueve el foco al titulo. */
export function encabezado({ titulo, descripcion = null, acciones = [], miga = [] }) {
    document.title = `${titulo} — Administración Comercial Elite`;
    const h1 = el("h1", { class: "h3 mb-1", tabindex: "-1", id: "tituloVista" }, titulo);
    const nodo = el(
        "header",
        { class: "encabezado-vista mb-4" },
        miga.length
            ? el(
                  "nav",
                  { "aria-label": "Ruta de navegación" },
                  el(
                      "ol",
                      { class: "breadcrumb mb-2" },
                      miga.map((m, i) =>
                          el(
                              "li",
                              { class: `breadcrumb-item${i === miga.length - 1 ? " active" : ""}`, ...(i === miga.length - 1 ? { "aria-current": "page" } : {}) },
                              m.href && i < miga.length - 1 ? el("a", { href: m.href }, m.texto) : m.texto
                          )
                      )
                  )
              )
            : null,
        el("div", { class: "d-flex flex-wrap align-items-start justify-content-between gap-3" },
            el("div", {}, h1, descripcion ? el("p", { class: "text-body-secondary mb-0" }, descripcion) : null),
            acciones.length ? el("div", { class: "d-flex flex-wrap gap-2" }, acciones) : null
        )
    );
    window.requestAnimationFrame(() => {
        // Si el foco ya quedo en un campo vivo de la vista (p. ej. el buscador de
        // un filtro instantaneo), no se lo quita: solo se mueve al navegar.
        const a = document.activeElement;
        if (a && a !== document.body && a.isConnected && a.closest("#contenido form[role=search]")) return;
        h1.focus();
    });
    return nodo;
}

/** Alerta: tipo success | danger | warning | info. Los errores van con role="alert". */
export function alerta(tipo, mensaje, { titulo = null } = {}) {
    return el(
        "div",
        { class: `alert alert-${tipo}`, role: tipo === "danger" || tipo === "warning" ? "alert" : "status" },
        titulo ? el("p", { class: "fw-bold mb-1" }, titulo) : null,
        el("p", { class: "mb-0" }, mensaje)
    );
}

/** Contenedor de alertas de la vista (se reemplaza en cada mensaje). */
export function zonaAlertas() {
    const zona = el("div", { class: "zona-alertas" });
    return {
        nodo: zona,
        exito(mensaje) {
            montar(zona, alerta("success", mensaje));
            anunciar(mensaje);
        },
        error(error, titulo = "No se pudo completar la acción") {
            const mensaje = error?.message ?? String(error);
            montar(zona, alerta("danger", mensaje, { titulo }));
        },
        info(mensaje) {
            montar(zona, alerta("info", mensaje));
        },
        limpiar() {
            montar(zona);
        },
    };
}

export const cargando = (texto = "Cargando…") =>
    el("div", { class: "d-flex align-items-center gap-2 my-4", role: "status" },
        el("span", { class: "spinner-border spinner-border-sm", "aria-hidden": "true" }), el("span", {}, texto));

/**
 * Tabla de datos.
 * columnas: [{ titulo, valor: (fila) => texto|Node, numerica?, clave? }]
 * acciones: (fila) => [Node] (botones de la ultima columna)
 */
/** Parametros de orden para la API (solo si hay uno elegido). */
export const paramsOrden = (est) => (est.orden ? { orden: est.orden, dir: est.dir ?? "asc" } : {});
/** `orden` de tabla() para listados paginados: cambia el orden, vuelve a la pagina 1 y recarga. */
export const ordenServidor = (est, recargar) => ({
    clave: est.orden ?? null,
    dir: est.dir ?? "asc",
    alCambiar: (clave, dir) => {
        Object.assign(est, { orden: clave, dir, page: 1 });
        recargar();
    },
});

// ---- Ordenamiento de tablas -------------------------------------------------
// Cada tabla trae un menu "Ordenar por" (un <select> con palabras: "A → Z",
// "más reciente primero"...) y encabezados que se pueden pulsar (aria-sort).
// Las dos vias hacen lo mismo. Con `orden` (listados paginados) ordena el
// SERVIDOR: ordenar solo la pagina visible engañaria. Sin `orden`, la tabla
// tiene todas sus filas y se ordena en el navegador.
const ES_FECHA = /fecha|emisi|venc|desde|hasta|ingreso|acceso|movimiento|registr|creaci/i;
const tipoOrden = (c) => c.tipoOrden ?? (c.numerica ? "numero" : ES_FECHA.test(c.titulo) ? "fecha" : "texto");
const textoDireccion = (c, dir) =>
    ({ numero: dir === "asc" ? "de menor a mayor" : "de mayor a menor",
       fecha: dir === "asc" ? "más antiguo primero" : "más reciente primero",
       texto: dir === "asc" ? "A → Z" : "Z → A" })[tipoOrden(c)];
const textoDe = (v) => (v instanceof Node ? v.textContent : Array.isArray(v) ? v.map(textoDe).join(" ") : String(v ?? ""));
/** Numero de un texto con formato es-EC ("$1.234,50" -> 1234.5); NaN si no hay. */
const numeroDe = (s) => Number(String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
const colador = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

function claveOrden(c, f) {
    const crudo = c.clave !== undefined ? f[c.clave] : undefined;
    if (crudo !== undefined && crudo !== null && typeof crudo !== "object") return crudo;
    const texto = textoDe(c.valor(f)).trim();
    if (tipoOrden(c) === "numero") {
        const n = numeroDe(texto);
        return Number.isNaN(n) ? null : n;
    }
    return texto === "—" ? null : texto;
}
function comparar(a, b) {
    if (a === null || a === undefined || a === "") return 1; // vacios siempre al final
    if (b === null || b === undefined || b === "") return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return colador.compare(String(a), String(b));
}

/**
 * Hace ordenable una tabla armada a mano (filas con campos para escribir:
 * lineas de la venta, de la compra, dialogos por talla). Mueve las <tr> sin
 * recrearlas, asi lo escrito y sus eventos se conservan. Agrega el mismo menu
 * "Ordenar por" y los encabezados-boton (aria-sort) que tabla(). Si el tbody
 * se vuelve a pintar, reaplica el orden elegido.
 * Devuelve el bloque { menu, tabla } para insertarlo en lugar de la tabla.
 */
export function ordenarTablaDom(tablaEl, { excluir = ["Acción", "Acciones"] } = {}) {
    const cuerpo = tablaEl.tBodies[0];
    const ths = [...tablaEl.tHead.rows[0].cells];
    const columnas = ths.map((th, i) => ({ i, titulo: th.textContent.trim() })).filter((c) => c.titulo && !excluir.includes(c.titulo));
    let estado = { i: -1, dir: "asc" };
    let ocupado = false;
    const original = new WeakMap(); // posicion original de cada fila ("Como vienen")
    const valorCelda = (tr, i) => {
        const celda = tr.cells[i];
        if (!celda) return null;
        const control = celda.querySelector("input:not([type=checkbox]):not([type=radio]), select");
        const texto = (control ? control.value : celda.textContent).trim();
        if (texto === "" || texto === "—") return null;
        const n = numeroDe(texto);
        // numero si la celda es basicamente un numero o un monto ("$2,70", "14", "1,1546")
        return /^[\s$\d.,%-]+$/.test(texto) && !Number.isNaN(n) ? n : texto;
    };
    const tipoDe = (i) => ([...cuerpo.rows].some((tr) => typeof valorCelda(tr, i) === "number") ? "numero" : "texto");
    const idSelect = nuevoId("ordenar");
    const selector = el("select", { id: idSelect, class: "form-select form-select-sm w-auto" });
    const anuncio = el("span", { class: "visually-hidden", "aria-live": "polite" });
    function opciones() {
        montar(selector, el("option", { value: "" }, "Como vienen"),
            columnas.flatMap((c) => ["asc", "desc"].map((dir) =>
                el("option", { value: `${c.i}:${dir}`, selected: estado.i === c.i && estado.dir === dir }, `${c.titulo}: ${textoDireccion({ titulo: c.titulo, tipoOrden: tipoDe(c.i) }, dir)}`))));
    }
    function aplicar() {
        ocupado = true;
        const filas = [...cuerpo.rows];
        filas.forEach((tr, n) => { if (!original.has(tr)) original.set(tr, n); });
        const signo = estado.dir === "asc" ? 1 : -1;
        filas.sort((a, b) => {
            if (estado.i < 0) return original.get(a) - original.get(b);
            const ka = valorCelda(a, estado.i);
            const kb = valorCelda(b, estado.i);
            if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
            return signo * comparar(ka, kb) || original.get(a) - original.get(b);
        }).forEach((tr) => cuerpo.append(tr));
        ths.forEach((th, i) => {
            if (!th.querySelector(".btn-orden")) return;
            th.setAttribute("aria-sort", i === estado.i ? (estado.dir === "asc" ? "ascending" : "descending") : "none");
            th.querySelector(".flecha-orden").textContent = i === estado.i ? (estado.dir === "asc" ? " ▲" : " ▼") : " ↕";
        });
        selector.value = estado.i >= 0 ? `${estado.i}:${estado.dir}` : "";
        queueMicrotask(() => (ocupado = false));
    }
    function ordenarPor(i, dir) {
        estado = { i, dir };
        aplicar();
        const c = columnas.find((x) => x.i === i);
        anuncio.textContent = c ? `Ordenado por ${c.titulo}, ${textoDireccion({ titulo: c.titulo, tipoOrden: tipoDe(i) }, dir)}` : "Orden original";
    }
    for (const c of columnas) {
        const th = ths[c.i];
        const flecha = el("span", { "aria-hidden": "true", class: "flecha-orden" }, " ↕");
        const boton = el("button", { type: "button", class: "btn-orden", title: `Ordenar por ${c.titulo}` }, c.titulo, flecha);
        boton.addEventListener("click", () => ordenarPor(c.i, estado.i === c.i && estado.dir === "asc" ? "desc" : "asc"));
        montar(th, boton);
        th.setAttribute("aria-sort", "none");
    }
    selector.addEventListener("focus", opciones); // los tipos dependen de las filas actuales
    selector.addEventListener("change", () => {
        const [i, dir] = selector.value ? selector.value.split(":") : [-1, "asc"];
        ordenarPor(Number(i), dir);
    });
    opciones();
    // el tbody se vuelve a pintar (agregar/quitar lineas): se reaplica el orden elegido
    new MutationObserver(() => { if (!ocupado && estado.i >= 0) aplicar(); }).observe(cuerpo, { childList: true });
    const caption = tablaEl.querySelector("caption");
    if (caption && !/encabezados/.test(caption.textContent)) caption.append(". Los encabezados con botón ordenan la tabla.");
    return el("div", { class: "tabla-con-orden" },
        el("div", { class: "d-flex flex-wrap align-items-center gap-2 mb-2" },
            el("label", { class: "form-label mb-0 small fw-semibold", for: idSelect }, "Ordenar por"), selector, anuncio));
}

/**
 * Tabla accesible y ordenable.
 *  columnas: [{ titulo, valor(fila), numerica?, clave? (dato crudo / clave del servidor), ordenable? }]
 *  orden: { clave, dir, alCambiar(clave, dir) } -> lo ordena el servidor (solo columnas con clave)
 */
export function tabla({ titulo, columnas, filas, acciones = null, vacio = "No hay registros.", orden = null, claseFila = null }) {
    if (filas.length === 0) return el("p", { class: "alert alert-light border", role: "status" }, vacio);
    const servidor = Boolean(orden);
    const ordenables = columnas
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.ordenable !== false && (!servidor || c.clave));
    let estado = servidor
        ? { i: columnas.findIndex((c) => c.clave === orden.clave), dir: orden.dir ?? "asc" }
        : { i: -1, dir: "asc" };

    const cuerpo = el("tbody");
    const encabezados = [];
    const idSelect = nuevoId("ordenar");
    const selector = el("select", { id: idSelect, class: "form-select form-select-sm w-auto" },
        el("option", { value: "" }, servidor ? "Predeterminado" : "Como vienen"),
        ordenables.flatMap(({ c, i }) => ["asc", "desc"].map((dir) =>
            el("option", { value: `${i}:${dir}`, selected: estado.i === i && estado.dir === dir }, `${c.titulo}: ${textoDireccion(c, dir)}`))));
    const anuncio = el("span", { class: "visually-hidden", "aria-live": "polite" });

    function pintarFilas() {
        let lista = filas;
        if (!servidor && estado.i >= 0) {
            const c = columnas[estado.i];
            const signo = estado.dir === "asc" ? 1 : -1;
            lista = [...filas].map((f, n) => ({ f, n, k: claveOrden(c, f) }))
                .sort((a, b) => {
                    const vaciaA = a.k === null || a.k === undefined || a.k === "";
                    const vaciaB = b.k === null || b.k === undefined || b.k === "";
                    if (vaciaA || vaciaB) return vaciaA === vaciaB ? a.n - b.n : vaciaA ? 1 : -1;
                    return signo * comparar(a.k, b.k) || a.n - b.n;
                })
                .map((x) => x.f);
        }
        montar(cuerpo, ...lista.map((f) =>
            el("tr", { class: claseFila?.(f) ?? null },
                columnas.map((c, i) => {
                    const contenido = c.valor(f);
                    const clase = c.numerica ? "text-end" : null;
                    // la primera columna identifica la fila para los lectores de pantalla
                    return i === 0 ? el("th", { scope: "row", class: `${clase ?? ""} fw-normal`.trim() }, contenido) : el("td", { class: clase }, contenido);
                }),
                acciones ? el("td", { class: "text-end" }, el("div", { class: "d-inline-flex flex-wrap gap-1 justify-content-end" }, acciones(f))) : null)));
    }
    function pintarEncabezados() {
        encabezados.forEach(({ th, flecha, i }) => {
            const activo = estado.i === i;
            th.setAttribute("aria-sort", activo ? (estado.dir === "asc" ? "ascending" : "descending") : "none");
            flecha.textContent = activo ? (estado.dir === "asc" ? " ▲" : " ▼") : " ↕";
        });
        selector.value = estado.i >= 0 ? `${estado.i}:${estado.dir}` : "";
    }
    function ordenarPor(i, dir) {
        estado = { i, dir };
        const c = columnas[i];
        if (servidor) {
            orden.alCambiar(i >= 0 ? c.clave : null, dir);
            return;
        }
        pintarEncabezados();
        pintarFilas();
        anuncio.textContent = i >= 0 ? `Ordenado por ${c.titulo}, ${textoDireccion(c, dir)}` : "Orden original";
    }
    selector.addEventListener("change", () => {
        const [i, dir] = selector.value ? selector.value.split(":") : [-1, "asc"];
        ordenarPor(Number(i), dir);
    });

    const filaEncabezado = el("tr", {},
        columnas.map((c, i) => {
            const clase = c.numerica ? "text-end" : null;
            if (!ordenables.some((o) => o.i === i)) return el("th", { scope: "col", class: clase }, c.titulo);
            const flecha = el("span", { "aria-hidden": "true", class: "flecha-orden" });
            const boton = el("button", { type: "button", class: "btn-orden", title: `Ordenar por ${c.titulo}` }, c.titulo, flecha);
            boton.addEventListener("click", () => ordenarPor(i, estado.i === i && estado.dir === "asc" ? "desc" : "asc"));
            const th = el("th", { scope: "col", class: clase }, boton);
            encabezados.push({ th, flecha, i });
            return th;
        }),
        acciones ? el("th", { scope: "col", class: "text-end" }, "Acciones") : null);
    pintarEncabezados();
    pintarFilas();

    return el("div", { class: "tabla-con-orden" },
        anuncio,
        // En escritorio los encabezados-boton ya ordenan: el menu solo se muestra
        // en pantallas chicas (donde la tabla se desplaza y los encabezados no se ven).
        filas.length > 3 && ordenables.length > 0
            ? el("div", { class: "orden-movil align-items-center gap-2 mb-2" },
                  el("label", { class: "form-label mb-0 small fw-semibold", for: idSelect }, "Ordenar por"), selector)
            : null,
        el("div", { class: "table-responsive", tabindex: "0", role: "region", "aria-label": titulo },
            el("table", { class: "table table-hover align-middle tabla-admin" },
                el("caption", { class: "visually-hidden" }, `${titulo}. Los encabezados con botón ordenan la tabla.`),
                el("thead", {}, filaEncabezado),
                cuerpo)));
}

/** Paginacion accesible: nav con aria-label y la pagina actual con aria-current. */
export function paginacion(meta, alCambiar) {
    if (!meta || meta.totalPages <= 1) {
        return meta ? el("p", { class: "text-body-secondary small" }, `${meta.totalItems} registro${meta.totalItems === 1 ? "" : "s"}`) : null;
    }
    const boton = (texto, pagina, deshabilitado, etiqueta) =>
        el("li", { class: `page-item${deshabilitado ? " disabled" : ""}` },
            el("button", { class: "page-link", type: "button", disabled: deshabilitado, "aria-label": etiqueta, onclick: () => alCambiar(pagina) }, texto));
    return el(
        "nav",
        { "aria-label": "Páginas", class: "d-flex flex-wrap align-items-center gap-3" },
        el("ul", { class: "pagination mb-0" },
            boton("Anterior", meta.page - 1, meta.page <= 1, "Página anterior"),
            el("li", { class: "page-item active", "aria-current": "page" }, el("span", { class: "page-link" }, `${meta.page} de ${meta.totalPages}`)),
            boton("Siguiente", meta.page + 1, meta.page >= meta.totalPages, "Página siguiente")),
        el("p", { class: "text-body-secondary small mb-0" }, `${meta.totalItems} registros`)
    );
}

/**
 * Campo de formulario con etiqueta, ayuda y espacio de error enlazados.
 * def: { nombre, etiqueta, tipo, requerido, ayuda, opciones:[{valor, etiqueta}], valor, max, deshabilitado, paso, minimo }
 */
export function campo(def) {
    const id = nuevoId(`campo-${def.nombre}`);
    const idAyuda = def.ayuda ? `${id}-ayuda` : null;
    const idError = `${id}-error`;
    const describe = [idAyuda, idError].filter(Boolean).join(" ");
    const comunes = {
        id,
        name: def.nombre,
        "aria-describedby": describe,
        "aria-required": def.requerido ? "true" : null,
        required: def.requerido || null,
        disabled: def.deshabilitado || null,
        // solo lectura pero enfocable y legible por lector de pantalla (un disabled se salta)
        readonly: def.lectura || null,
        dataset: { error: idError },
    };
    let control;
    if (def.tipo === "booleano") {
        control = el("input", { ...comunes, type: "checkbox", class: "form-check-input", role: "switch", checked: def.valor === true || def.valor === 1 });
        return el("div", { class: "form-check form-switch mb-3" },
            control,
            el("label", { class: "form-check-label", for: id }, def.etiqueta),
            def.ayuda ? el("div", { id: idAyuda, class: "form-text" }, def.ayuda) : null,
            el("div", { id: idError, class: "invalid-feedback d-block", "aria-live": "polite" }));
    }
    if (def.tipo === "seleccion" || def.tipo === "opciones") {
        control = el("select", { ...comunes, class: "form-select" },
            el("option", { value: "" }, def.requerido ? "Elige una opción…" : "(ninguna)"),
            (def.opciones ?? []).map((o) => el("option", { value: o.valor, selected: String(o.valor) === String(def.valor ?? "") }, o.etiqueta)));
    } else if (def.tipo === "textoLargo") {
        control = el("textarea", { ...comunes, class: "form-control", rows: 3, maxlength: def.max ?? null }, def.valor ?? "");
    } else {
        const tipos = { correo: "email", telefono: "tel", url: "url", fecha: "date", entero: "text", cantidad: "text", dinero: "text", porcentaje: "text" };
        const numerico = ["entero", "cantidad", "dinero", "porcentaje"].includes(def.tipo);
        control = el("input", {
            ...comunes,
            type: tipos[def.tipo] ?? "text",
            class: "form-control",
            value: def.valor === null || def.valor === undefined ? "" : def.tipo === "fecha" ? String(def.valor).slice(0, 10) : def.valor,
            maxlength: def.max ?? null,
            inputmode: numerico ? "decimal" : def.tipo === "telefono" ? "tel" : null,
            autocomplete: def.autocompletar ?? "off",
        });
    }
    return el("div", { class: "mb-3" },
        el("label", { class: "form-label", for: id }, def.etiqueta, def.requerido ? el("span", { class: "text-danger", "aria-hidden": "true" }, " *") : null),
        control,
        def.ayuda ? el("div", { id: idAyuda, class: "form-text" }, def.ayuda) : null,
        el("div", { id: idError, class: "invalid-feedback", "aria-live": "polite" }));
}

/** Resumen de errores (vacio y oculto hasta que haga falta). */
export const resumenErrores = () => el("div", { class: "alert alert-danger", role: "alert", tabindex: "-1", hidden: true });

/** Nota de campos obligatorios (una vez por formulario). */
export const notaObligatorios = () => el("p", { class: "small text-body-secondary" }, "Los campos con ", el("span", { class: "text-danger", "aria-hidden": "true" }, "*"), " son obligatorios.");

/**
 * Dialogo modal de Bootstrap. contenido: Node. Devuelve { abrir, cerrar, nodo }.
 * Bootstrap atrapa el foco dentro, cierra con Esc y devuelve el foco al que lo abrio.
 */
export function dialogo({ titulo, contenido, pie = null, grande = false }) {
    const idTitulo = nuevoId("titulo-dialogo");
    const nodo = el("div", { class: "modal fade", tabindex: "-1", "aria-labelledby": idTitulo, "aria-modal": "true", role: "dialog" },
        el("div", { class: `modal-dialog modal-dialog-scrollable${grande ? " modal-lg" : ""}` },
            el("div", { class: "modal-content" },
                el("div", { class: "modal-header" },
                    el("h2", { class: "modal-title h5", id: idTitulo }, titulo),
                    el("button", { type: "button", class: "btn-close", "data-bs-dismiss": "modal", "aria-label": "Cerrar" })),
                el("div", { class: "modal-body" }, contenido),
                pie ? el("div", { class: "modal-footer" }, pie) : null)));
    document.body.append(nodo);
    const modal = new window.bootstrap.Modal(nodo);
    nodo.addEventListener("hidden.bs.modal", () => {
        modal.dispose();
        nodo.remove();
    });
    nodo.addEventListener("shown.bs.modal", () => {
        const primero = nodo.querySelector(".modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea, .modal-body button");
        (primero ?? nodo.querySelector(".btn-close")).focus();
    });
    return { nodo, abrir: () => modal.show(), cerrar: () => modal.hide() };
}

/** Confirmacion antes de una accion destructiva. Resuelve true/false. */
export function confirmar({ titulo, mensaje, textoConfirmar = "Confirmar", peligro = true }) {
    return new Promise((resolver) => {
        let decision = false;
        const botonSi = el("button", { type: "button", class: `btn ${peligro ? "btn-danger" : "btn-primary"}`, onclick: () => { decision = true; d.cerrar(); } }, textoConfirmar);
        const d = dialogo({
            titulo,
            contenido: el("p", { class: "mb-0" }, mensaje),
            pie: [el("button", { type: "button", class: "btn btn-outline-secondary", "data-bs-dismiss": "modal" }, "Cancelar"), botonSi],
        });
        d.nodo.addEventListener("hidden.bs.modal", () => resolver(decision));
        d.abrir();
    });
}

/** Etiqueta de estado (texto visible, el color solo refuerza: WCAG 1.4.1). */
export function insignia(texto, tono = "secondary") {
    return el("span", { class: `badge text-bg-${tono}` }, texto);
}

/** Tabla armada a mano, dentro de su region desplazable y con su menu "Ordenar por". */
export function envolverOrdenable(tablaEl, atributosRegion) {
    return el("div", {}, ordenarTablaDom(tablaEl), el("div", { class: "table-responsive", tabindex: "0", role: "region", ...atributosRegion }, tablaEl));
}

/**
 * Pestanas accesibles (patron ARIA "tabs"): agrupan la informacion de una ficha
 * para no mostrarlo todo a la vez (divulgacion progresiva). Flechas izquierda y
 * derecha, Inicio y Fin mueven entre pestanas; solo la activa esta en el orden
 * de Tab (tabindex movil). paneles: [{ id, titulo, contenido: () => Node }]
 * El contenido se construye al abrir la pestana (no se piden datos de mas).
 */
export function pestanas(paneles, { activa = null, alCambiar = null, etiqueta = "Secciones" } = {}) {
    const base = nuevoId("pestana");
    let actual = paneles.some((p) => p.id === activa) ? activa : paneles[0].id;
    const botones = new Map();
    const zonas = new Map();
    const lista = el("div", { class: "nav nav-tabs mb-3", role: "tablist", "aria-label": etiqueta });
    for (const p of paneles) {
        const boton = el("button", {
            type: "button", class: "nav-link", role: "tab", id: `${base}-${p.id}-tab`,
            "aria-controls": `${base}-${p.id}`,
        }, p.titulo);
        boton.addEventListener("click", () => abrir(p.id, true));
        boton.addEventListener("keydown", (e) => {
            const i = paneles.findIndex((x) => x.id === p.id);
            const destino = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: paneles.length - 1 }[e.key];
            if (destino === undefined) return;
            e.preventDefault();
            const id = paneles[(destino + paneles.length) % paneles.length].id;
            abrir(id, true);
            botones.get(id).focus();
        });
        botones.set(p.id, boton);
        zonas.set(p.id, el("div", { role: "tabpanel", id: `${base}-${p.id}`, "aria-labelledby": `${base}-${p.id}-tab`, tabindex: "0", hidden: true }));
        lista.append(boton);
    }
    function abrir(id, avisar = false) {
        actual = id;
        for (const p of paneles) {
            const sel = p.id === id;
            const b = botones.get(p.id);
            b.classList.toggle("active", sel);
            b.setAttribute("aria-selected", String(sel));
            b.tabIndex = sel ? 0 : -1;
            const z = zonas.get(p.id);
            z.hidden = !sel;
            if (sel && !z.dataset.listo) {
                montar(z, p.contenido());
                z.dataset.listo = "1";
            }
        }
        if (avisar) alCambiar?.(id);
    }
    abrir(actual);
    return el("div", { class: "pestanas" }, lista, ...zonas.values());
}

/** Manejador de "input" con espera (debounce): busca cuando se deja de escribir. */
export function alEscribir(fn, ms = 400) {
    let espera = null;
    return (e) => {
        clearTimeout(espera);
        espera = setTimeout(() => fn(e), ms);
    };
}

/**
 * Re-pintar una lista con filtros instantaneos no debe sacar al usuario del
 * buscador mientras escribe: se devuelve el foco (y el cursor) al mismo campo.
 */
export function conservandoFoco(contenedor, pintar) {
    const activo = document.activeElement;
    const nombre = activo?.name && activo.closest("form[role=search]") ? activo.name : null;
    const cursor = nombre && typeof activo.selectionStart === "number" ? activo.selectionStart : null;
    pintar();
    if (!nombre) return;
    const nuevo = contenedor.querySelector(`form[role=search] [name="${nombre}"]`);
    if (!nuevo) return;
    nuevo.focus({ preventScroll: true });
    if (cursor !== null && typeof nuevo.setSelectionRange === "function") nuevo.setSelectionRange(cursor, cursor);
}
