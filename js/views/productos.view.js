// js/views/productos.view.js
// VISTAS de productos: lista, asistente de alta (3 pasos) y ficha de edicion.
// El alta sigue la logica del modelo: un producto tiene VARIANTES (una por
// combinacion de valores de atributo: color x talla) y cada variante se vende
// en FORMAS DE VENTA (presentaciones) con su contenido en la unidad base, su
// compra minima, su incremento y su precio.
import { anunciar, el, formato, montar, nuevoId } from "../core/dom.js";
import { marcarCampo, mostrarResumen, validarValor } from "../core/validacion.js";
import { alEscribir, campo, encabezado, insignia, notaObligatorios, paginacion, pestanas, resumenErrores, tabla, envolverOrdenable } from "./componentes.js";

// ------------------------------------------------------------------ Lista
/** Como se puede pedir una forma de venta (su incremento). */
export const INCREMENTOS = [
    { valor: 1, etiqueta: "Solo enteros (1, 2, 3…)" },
    { valor: 0.5, etiqueta: "Medios (0,5)" },
    { valor: 0.25, etiqueta: "Cuartos (0,25)" },
    { valor: 0.1, etiqueta: "Décimas (0,1)" },
    { valor: 0.01, etiqueta: "Cualquier decimal" },
];
export function opcionesIncremento(actual) {
    const v = Number(actual ?? 1);
    return INCREMENTOS.some((o) => o.valor === v) ? INCREMENTOS : [...INCREMENTOS, { valor: v, etiqueta: `De a ${String(v).replace(".", ",")}` }];
}

export function vistaLista({ estado, puedeCrear, acciones, alertas }) {
    const idQ = nuevoId("q");
    const idPub = nuevoId("publicado");
    return el("section", { "aria-labelledby": "tituloVista" },
        encabezado({
            titulo: "Productos",
            descripcion: "Catálogo completo: publicados en la tienda y en preparación.",
            acciones: puedeCrear ? [el("a", { class: "btn btn-primary", href: "#/productos/nuevo" }, "Nuevo producto")] : [],
        }),
        alertas.nodo,
        el("form", {
            role: "search", "aria-label": "Buscar productos", class: "barra-lista",
            onsubmit: (e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                acciones.buscar(String(d.get("q")).trim(), d.get("publicado"));
            },
        },
            // filtros instantaneos: sin boton "Aplicar" (un paso menos, respuesta inmediata)
            el("div", {}, el("label", { class: "form-label", for: idQ }, "Buscar por código o nombre"),
                el("input", { id: idQ, name: "q", type: "search", class: "form-control", value: estado.q, autocomplete: "off", oninput: alEscribir((e) => e.target.form.requestSubmit()) })),
            el("div", {}, el("label", { class: "form-label", for: idPub }, "Estado en la tienda"),
                el("select", { id: idPub, name: "publicado", class: "form-select", onchange: (e) => e.target.form.requestSubmit() },
                    [["", "Todos"], ["1", "Publicados"], ["0", "Sin publicar"]].map(([v, t]) => el("option", { value: v, selected: estado.publicado === v }, t))))),
        tabla({
            titulo: "Lista de productos",
            filas: estado.filas,
            orden: acciones.orden,
            vacio: "No hay productos con esos filtros.",
            columnas: [
                { titulo: "Código", clave: "codigo", valor: (p) => el("a", { href: `#/productos/${p.idProducto}` }, p.codigo) },
                { titulo: "Nombre", valor: (p) => el("a", { href: `#/productos/${p.idProducto}`, class: "fw-semibold", tabindex: "-1" }, p.nombre), clave: "nombre" },
                { titulo: "Categoría", valor: (p) => formato.texto(p.categoria), clave: "categoria" },
                { titulo: "Marca", valor: (p) => formato.texto(p.marca), clave: "marca" },
                { titulo: "Variantes", numerica: true, valor: (p) => p.variantes, clave: "variantes" },
                { titulo: "Formas de venta", numerica: true, valor: (p) => p.formasDeVenta, clave: "formasDeVenta" },
                { titulo: "Disponible", numerica: true, clave: "disponible", valor: (p) => [formato.numero(p.disponible), " ", formato.texto(p.unidad).toLowerCase()] },
                { titulo: "Tienda", clave: "publicado", valor: (p) => [p.publicado ? insignia("Publicado", "success") : insignia("Sin publicar", "secondary"), p.requiereCompra ? [" ", insignia("Reponer", "warning")] : null] },
            ],
        }),
        paginacion(estado.meta, acciones.pagina));
}

// ------------------------------------------------------------------ Asistente de alta
/** Producto cartesiano de listas: [[a,b],[c]] -> [[a,c],[b,c]]. */
export const combinaciones = (listas) => listas.reduce((acc, l) => acc.flatMap((x) => l.map((y) => [...x, y])), [[]]);

/**
 * opciones: { categorias, unidades, tarifas, marcas }
 * acciones: { atributosDe(idCategoria) -> Promise<{ propios, otros }>, crear(datos) }
 */
export function vistaAlta({ opciones, acciones, alertas }) {
    const resumen = resumenErrores();
    const reglas = new Map([
        ["nombre", { etiqueta: "Nombre", requerido: true, patron: "nombre", max: 150 }],
        ["idCategoria", { etiqueta: "Categoría", requerido: true }],
        ["idUnidadMedida", { etiqueta: "Unidad de medida", requerido: true }],
        ["idTarifaIva", { etiqueta: "Tarifa de IVA", requerido: true }],
        ["uso", { etiqueta: "Uso típico", patron: "texto", max: 200 }],
        ["descripcion", { etiqueta: "Descripción", patron: "texto", max: 300 }],
        ["imagenUrl", { etiqueta: "Imagen (URL)", patron: "url", max: 500 }],
        ["compraDescripcion", { etiqueta: "Se compra en", patron: "texto", max: 40 }],
        ["compraFactor", { etiqueta: "Contenido de la unidad de compra", patron: "cantidad",
            validar: (v, form) => (Number(v) > 0 ? null : "El contenido debe ser mayor que 0.") }],
    ]);

    // Paso 1: datos generales
    const paso1 = el("section", { class: "paso", "aria-labelledby": "paso1" },
        el("h2", { class: "h5", id: "paso1" }, "Datos generales"),
        el("div", { class: "grilla-form" },
            // el codigo lo genera el servidor: CE-<numero> en el bloque de mil de la linea
            campo({ nombre: "codigo", etiqueta: "Código", lectura: true, valor: "Se genera al crear", ayuda: "Automático: CE- y el número que sigue en la línea (suelas 3xxx, cueros 1xxx…)." }),
            campo({ nombre: "nombre", etiqueta: "Nombre", requerido: true, max: 150 }),
            campo({ nombre: "idCategoria", etiqueta: "Categoría", tipo: "seleccion", requerido: true, opciones: opciones.categorias }),
            campo({ nombre: "idUnidadMedida", etiqueta: "Unidad de medida del inventario", tipo: "seleccion", requerido: true, opciones: opciones.unidades, ayuda: "En qué se cuenta el stock: pie², metro, par, unidad…" }),
            campo({ nombre: "idTarifaIva", etiqueta: "Tarifa de IVA", tipo: "seleccion", requerido: true, opciones: opciones.tarifas, valor: opciones.tarifas.find((t) => /15/.test(t.etiqueta))?.valor }),
            campo({ nombre: "idMarca", etiqueta: "Marca", tipo: "seleccion", opciones: opciones.marcas, ayuda: "Opcional" }),
            // un producto se relaciona con al menos un proveedor (puede tener varios)
            el("fieldset", { class: "ancho-completo mb-3", id: "grupoProveedores", "aria-describedby": "proveedoresAyuda", tabindex: "-1" },
                el("legend", { class: "form-label fs-6 mb-1" }, "Proveedores ", el("span", { class: "text-danger", "aria-hidden": "true" }, "*")),
                el("div", { id: "proveedoresAyuda", class: "form-text mb-1" }, "Quién vende este producto. Marca al menos uno; en la orden de compra aparecerá primero con ellos."),
                el("div", { class: "d-flex flex-wrap gap-3" }, (opciones.proveedores ?? []).map((pv) => {
                    const idc = nuevoId("prov");
                    return el("div", { class: "form-check" },
                        el("input", { class: "form-check-input", type: "checkbox", name: "idsProveedores", value: String(pv.valor), id: idc }),
                        el("label", { class: "form-check-label", for: idc }, pv.etiqueta));
                }))),
            campo({ nombre: "uso", etiqueta: "Uso típico", max: 200, ayuda: "Ej. Calzado formal y marroquinería" }),
            campo({ nombre: "imagenUrl", etiqueta: "Imagen (URL)", tipo: "url", max: 500, ayuda: "Dirección https de la foto" }),
            el("div", { class: "ancho-completo" }, campo({ nombre: "descripcion", etiqueta: "Descripción", tipo: "textoLargo", max: 300 })),
            campo({ nombre: "ventaPorPieza", etiqueta: "Se vende por pieza (cuero en bandas)", tipo: "booleano", valor: false, ayuda: "Cada lote es una pieza física medida; una venta sale de una sola pieza." }),
            campo({ nombre: "cortesEstandar", etiqueta: "Cortes estándar (fibra en planchas)", tipo: "booleano", valor: false, ayuda: "Cada forma de venta es un corte fijo (plancha, 1/2, 1/4, 2 pies…). La base corta la plancha al vender. Implica venta por pieza." }),
            // como se COMPRA (siempre en la unidad mas grande del proveedor)
            campo({ nombre: "compraDescripcion", etiqueta: "Se compra en", max: 40, ayuda: "La unidad del proveedor, ej. Rollo × 30 m, Plancha, Paquete de bandas, Caja × 100 u. Vacío = en la unidad del inventario." }),
            campo({ nombre: "compraFactor", etiqueta: "Contenido de esa unidad (en la unidad del inventario)", tipo: "cantidad", ayuda: "Ej. 30 para un rollo de 30 m. Vacío si cada pieza mide distinto (bandas de cuero: se miden al recibir)." }),
            campo({ nombre: "precioPorVariante", etiqueta: "Precio y costo distinto por color o talla", tipo: "booleano", valor: false,
                ayuda: "Solo para casos como ciertas suelas, donde un color vale distinto. Si no se marca, todas las variantes valen lo mismo (como el cuero)." }),
            campo({ nombre: "publicado", etiqueta: "Publicar en la tienda al crear", tipo: "booleano", valor: false })));

    // Paso 2: variantes por atributos. Los atributos dependen de la CATEGORIA:
    // la base solo acepta los definidos para ella o su linea. Se ofrecen esos
    // primero; los demas van aparte y, si se usan, se agregan a la categoria.
    const elegidos = new Map(); // idAtributo -> { nombre, valores: Map(idValor -> etiqueta), nodo }
    const vistaPrevia = el("p", { class: "mb-0 fw-semibold", role: "status", "aria-live": "polite" });
    const listaValores = el("div", { class: "d-grid gap-3 mt-3" });
    const zonaAtributos = el("div", { "aria-live": "polite" }, el("p", { class: "text-body-secondary mb-0" }, "Elige primero la categoría (paso 1) para ver sus atributos."));
    const pintarVistaPrevia = () => {
        const listas = [...elegidos.values()].filter((a) => a.valores.size).map((a) => [...a.valores.values()]);
        const total = listas.length ? combinaciones(listas).length : 1;
        const nuevos = [...elegidos.values()].filter((a) => a.nuevo).map((a) => a.nombre);
        vistaPrevia.textContent = (listas.length
            ? `Se crearán ${total} variante${total === 1 ? "" : "s"}: ${combinaciones(listas).slice(0, 6).map((c) => c.join(" · ")).join(", ")}${total > 6 ? "…" : ""}`
            : "Sin atributos: se creará una sola variante.")
            + (nuevos.length ? ` Se agregará a la categoría: ${nuevos.join(", ")}.` : "");
    };
    const casilla = (a, nuevo) => {
        const id = nuevoId("atributo");
        const control = el("input", { type: "checkbox", class: "form-check-input", id, value: a.idAtributo });
        control.addEventListener("change", () => {
            if (control.checked) {
                const grupo = { nombre: a.nombre, nuevo, valores: new Map(), nodo: null };
                elegidos.set(a.idAtributo, grupo);
                const idLeyenda = nuevoId("leyenda");
                grupo.nodo = el("fieldset", { class: "border rounded p-3", "aria-describedby": idLeyenda },
                    el("legend", { class: "float-none w-auto px-2 mb-0" }, `Valores de ${a.nombre}`),
                    el("p", { class: "form-text mt-0", id: idLeyenda }, "Marca los que tendrá este producto."),
                    el("div", { class: "d-flex flex-wrap gap-3" }, a.valores.map((v) => {
                        const idv = nuevoId("valor");
                        const cv = el("input", { type: "checkbox", class: "form-check-input", id: idv, value: v.idValorAtributo });
                        cv.addEventListener("change", () => {
                            if (cv.checked) grupo.valores.set(v.idValorAtributo, v.valor);
                            else grupo.valores.delete(v.idValorAtributo);
                            pintarVistaPrevia();
                        });
                        return el("div", { class: "form-check" }, cv, el("label", { class: "form-check-label", for: idv }, v.valor));
                    })),
                    a.valores.length === 0 ? el("p", { class: "text-warning-emphasis mb-0" }, "Este atributo no tiene valores: agrégalos en Productos › Valores de atributo.") : null);
                listaValores.append(grupo.nodo);
            } else {
                elegidos.get(a.idAtributo)?.nodo.remove();
                elegidos.delete(a.idAtributo);
            }
            pintarVistaPrevia();
        });
        return el("div", { class: "form-check form-check-inline" }, control, el("label", { class: "form-check-label", for: id }, a.nombre));
    };
    let pedido = 0; // si cambian rapido de categoria, solo vale la ultima respuesta
    async function cargarAtributos(idCategoria) {
        for (const g of elegidos.values()) g.nodo?.remove();
        elegidos.clear();
        pintarVistaPrevia();
        if (!idCategoria) {
            montar(zonaAtributos, el("p", { class: "text-body-secondary mb-0" }, "Elige primero la categoría (paso 1) para ver sus atributos."));
            return;
        }
        const n = ++pedido;
        montar(zonaAtributos, el("p", { class: "mb-0" }, "Cargando los atributos de la categoría…"));
        let a;
        try {
            a = await acciones.atributosDe(idCategoria);
        } catch (error) {
            if (n === pedido) montar(zonaAtributos, el("p", { class: "text-danger-emphasis mb-0", role: "alert" }, `No se pudieron cargar los atributos: ${error.message}`));
            return;
        }
        if (n !== pedido) return;
        const idOtros = nuevoId("otros");
        montar(zonaAtributos, 
            el("fieldset", {}, el("legend", { class: "h6" }, "Atributos de esta categoría"),
                a.propios.length ? a.propios.map((x) => casilla(x, false)) : el("p", { class: "text-body-secondary mb-0" }, "Esta categoría todavía no tiene atributos.")),
            a.otros.length
                ? el("details", { class: "mt-3" },
                      el("summary", {}, `Otros atributos (${a.otros.length})`),
                      el("fieldset", { class: "mt-2", "aria-describedby": idOtros },
                          el("legend", { class: "visually-hidden" }, "Otros atributos"),
                          el("p", { class: "form-text mt-0", id: idOtros }, "No están definidos para esta categoría. Si usas uno, se le agregará a la categoría al crear el producto."),
                          a.otros.map((x) => casilla(x, true))))
                : null);
    }
    pintarVistaPrevia();
    const paso2 = el("section", { class: "paso", "aria-labelledby": "paso2" },
        el("h2", { class: "h5", id: "paso2" }, "Variantes"),
        el("p", { class: "text-body-secondary" }, "Cada combinación de valores es una variante con su propio stock (por ejemplo, Negro talla 38). Si el producto no tiene variantes, no marques nada."),
        zonaAtributos,
        listaValores,
        el("div", { class: "alert alert-light border mt-3 mb-0" }, vistaPrevia));

    // Paso 3: formas de venta
    const filas = el("tbody");
    const agregarFila = (valores = {}) => {
        const n = filas.children.length + 1;
        const celda = (nombre, etiqueta, valor, ayuda) => {
            const id = nuevoId(nombre);
            const idError = `${id}-error`;
            if (nombre === "incremento") {
                // Como se puede pedir: la tienda y las ventas usan este paso
                const opciones = opcionesIncremento(valor);
                return el("td", {},
                    el("label", { class: "visually-hidden", for: id }, `${etiqueta} de la forma de venta ${n}`),
                    el("select", { id, name: "forma_incremento", class: "form-select", "aria-describedby": idError, dataset: { error: idError } },
                        opciones.map((o) => el("option", { value: String(o.valor), selected: Number(o.valor) === Number(valor ?? 1) }, o.etiqueta))),
                    el("div", { id: idError, class: "invalid-feedback", "aria-live": "polite" }));
            }
            return el("td", {},
                el("label", { class: "visually-hidden", for: id }, `${etiqueta} de la forma de venta ${n}`),
                // prefijo "forma_": el paso 1 ya tiene un campo "descripcion" en el mismo form
                el("input", { id, name: `forma_${nombre}`, class: "form-control", value: valor ?? "", inputmode: nombre === "descripcion" ? null : "decimal", "aria-describedby": idError, dataset: { error: idError }, title: ayuda ?? null }),
                el("div", { id: idError, class: "invalid-feedback", "aria-live": "polite" }));
        };
        const fila = el("tr", {},
            celda("descripcion", "Nombre", valores.descripcion),
            celda("factor", "Contenido en unidad base", valores.factor),
            celda("cantidadMinima", "Compra mínima", valores.cantidadMinima ?? 1),
            celda("incremento", "Cómo se pide", valores.incremento ?? 1),
            celda("precio", "Precio con IVA", valores.precio),
            el("td", {}, el("button", {
                type: "button", class: "btn btn-sm btn-outline-danger", "aria-label": `Quitar la forma de venta ${n}`,
                onclick: () => {
                    if (filas.children.length === 1) return anunciar("Debe quedar al menos una forma de venta.");
                    fila.remove();
                    anunciar("Forma de venta quitada.");
                    filas.querySelector("input")?.focus();
                },
            }, "Quitar")));
        filas.append(fila);
        return fila;
    };
    agregarFila({ descripcion: "Unidad", factor: 1 });
    const paso3 = el("section", { class: "paso", "aria-labelledby": "paso3" },
        el("h2", { class: "h5", id: "paso3" }, "Formas de venta y precios"),
        el("p", { class: "text-body-secondary" }, "Cómo se vende cada variante. El contenido va en la unidad del inventario: una docena = 12 unidades; un rollo de 25 m = 25; el pie² de cuero = 1 (y se pide con «Cualquier decimal»). El precio es CON IVA: lo que paga el cliente."),
        envolverOrdenable(
            el("table", { class: "table align-middle lineas-tabla" },
                el("caption", { class: "visually-hidden" }, "Formas de venta del producto"),
                el("thead", {}, el("tr", {}, ["Nombre", "Contenido (unidad base)", "Compra mínima", "Cómo se pide", "Precio con IVA (USD)", "Acción"].map((t) => el("th", { scope: "col" }, t)))),
                filas),
            { "aria-label": "Formas de venta (desplazable)" }),
        el("button", { type: "button", class: "btn btn-outline-primary", onclick: () => agregarFila().querySelector("input").focus() }, "Agregar forma de venta"));

    const boton = el("button", { type: "submit", class: "btn btn-primary btn-lg" }, "Crear producto");
    const form = el("form", { novalidate: true, class: "pasos" }, resumen, notaObligatorios(), paso1, paso2, paso3,
        el("div", { class: "d-flex flex-wrap gap-2" }, boton, el("a", { class: "btn btn-outline-secondary btn-lg", href: "#/productos" }, "Cancelar")));

    form.elements.namedItem("idCategoria").addEventListener("change", (e) => cargarAtributos(e.target.value));

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errores = [];
        for (const [nombre, regla] of reglas) {
            const control = form.elements.namedItem(nombre);
            const mensaje = validarValor(control.value, regla, form);
            marcarCampo(control, mensaje);
            if (mensaje) errores.push({ control, mensaje });
        }
        // unidad de compra sin contenido: solo para piezas que se miden (venta por pieza)
        const cDesc = form.elements.namedItem("compraDescripcion");
        const cFac = form.elements.namedItem("compraFactor");
        if (cDesc.value.trim() && !cFac.value.trim() && !form.elements.namedItem("ventaPorPieza").checked && !form.elements.namedItem("cortesEstandar").checked) {
            const m = "Escribe el contenido de la unidad de compra (solo los productos por pieza pueden dejarlo vacío).";
            marcarCampo(cFac, m);
            errores.push({ control: cFac, mensaje: m });
        }
        const formas = [...filas.children].map((fila, i) => {
            const leer = (n) => fila.querySelector(`[name=forma_${n}]`);
            const reglasFila = {
                descripcion: { etiqueta: `Forma ${i + 1}: nombre`, requerido: true, patron: "nombre", max: 40 },
                factor: { etiqueta: `Forma ${i + 1}: contenido`, requerido: true, patron: "cantidad" },
                cantidadMinima: { etiqueta: `Forma ${i + 1}: compra mínima`, requerido: true, patron: "cantidad" },
                incremento: { etiqueta: `Forma ${i + 1}: cómo se pide`, requerido: true, patron: "cantidad" },
                precio: { etiqueta: `Forma ${i + 1}: precio con IVA`, requerido: true, patron: "dinero" },
            };
            const datos = {};
            for (const [n, regla] of Object.entries(reglasFila)) {
                const control = leer(n);
                let mensaje = validarValor(control.value, regla, form);
                if (!mensaje && n !== "descripcion" && n !== "precio" && Number(control.value) <= 0) mensaje = `${regla.etiqueta} debe ser mayor que 0.`;
                marcarCampo(control, mensaje);
                if (mensaje) errores.push({ control, mensaje });
                datos[n] = n === "descripcion" ? control.value.trim() : Number(control.value);
            }
            // el precio que se escribe es con IVA; la API lo convierte a la base sin IVA
            const { precio, ...resto } = datos;
            return { ...resto, precioConIva: precio };
        });
        const nombres = formas.map((f) => f.descripcion.toLowerCase());
        if (new Set(nombres).size !== nombres.length) errores.push({ control: null, mensaje: "Hay dos formas de venta con el mismo nombre." });
        const grupos = [...elegidos.values()];
        if (grupos.some((g) => g.valores.size === 0)) errores.push({ control: null, mensaje: "Marca al menos un valor en cada atributo elegido (o desmarca el atributo)." });
        const idsProveedores = [...form.querySelectorAll("input[name=idsProveedores]:checked")].map((c) => Number(c.value));
        if (idsProveedores.length === 0) errores.push({ control: form.querySelector("#grupoProveedores"), mensaje: "Proveedores: marca al menos uno." });
        if (errores.length) return mostrarResumen(resumen, errores);
        mostrarResumen(resumen, []);

        const listas = grupos.map((g) => [...g.valores.keys()]);
        const variantes = listas.length ? combinaciones(listas).map((valores) => ({ valores: valores.map(Number) })) : [];
        const v = (n) => form.elements.namedItem(n).value.trim();
        const datos = {
            nombre: v("nombre"),
            idCategoria: Number(v("idCategoria")),
            idUnidadMedida: v("idUnidadMedida"),
            idTarifaIva: v("idTarifaIva"),
            ...(v("idMarca") ? { idMarca: Number(v("idMarca")) } : {}),
            ...(v("uso") ? { uso: v("uso") } : {}),
            ...(v("descripcion") ? { descripcion: v("descripcion") } : {}),
            ...(v("imagenUrl") ? { imagenUrl: v("imagenUrl") } : {}),
            ventaPorPieza: form.elements.namedItem("ventaPorPieza").checked || form.elements.namedItem("cortesEstandar").checked,
            cortesEstandar: form.elements.namedItem("cortesEstandar").checked,
            ...(v("compraDescripcion") ? { compraDescripcion: v("compraDescripcion"), ...(v("compraFactor") ? { compraFactor: Number(v("compraFactor")) } : {}) } : {}),
            precioPorVariante: form.elements.namedItem("precioPorVariante").checked,
            publicado: form.elements.namedItem("publicado").checked,
            idsProveedores,
            variantes,
            presentaciones: formas,
        };
        boton.disabled = true;
        boton.setAttribute("aria-busy", "true");
        try {
            await acciones.crear(datos, form, resumen);
        } finally {
            boton.disabled = false;
            boton.removeAttribute("aria-busy");
        }
    });

    return el("section", { "aria-labelledby": "tituloVista" },
        encabezado({ titulo: "Nuevo producto", descripcion: "Tres pasos: datos generales, variantes y formas de venta con precio.", miga: [{ texto: "Productos", href: "#/productos" }, { texto: "Nuevo" }] }),
        alertas.nodo,
        form);
}

// ------------------------------------------------------------------ Ficha del producto
/** Formas de venta distintas del producto (iguales en todas las variantes). */
export function formasDeVenta(producto) {
    const mapa = new Map();
    for (const v of producto.variantes) {
        for (const p of v.presentaciones) {
            if (!mapa.has(p.descripcion)) mapa.set(p.descripcion, { ...p, precios: new Set() });
            if (!mapa.get(p.descripcion).preciosConIva) mapa.get(p.descripcion).preciosConIva = new Set();
            if (p.precio !== null) mapa.get(p.descripcion).precios.add(p.precio);
            if (p.precioConIva !== null && p.precioConIva !== undefined) mapa.get(p.descripcion).preciosConIva.add(p.precioConIva);
            if (p.activa) mapa.get(p.descripcion).activa = true;
        }
    }
    return [...mapa.values()].sort((a, b) => a.factor - b.factor);
}

export function vistaFicha({ producto, puede, acciones, alertas, formularioGeneral, pestana = null, alCambiarPestana = null }) {
    const formas = formasDeVenta(producto);
    const unidad = (producto.unidad ?? "").toLowerCase();
    const { panelFormas, panelVariantes, panelDescuentos, panelGeneral } = panelesFicha({ producto, formas, unidad, puede, acciones, formularioGeneral });
    const proveedores = producto.proveedores ?? [];
    const panelProveedores = el("section", { class: "mb-4", "aria-labelledby": "tituloProveedores" },
        el("h2", { class: "h5", id: "tituloProveedores" }, "Proveedores"),
        el("p", { class: "text-body-secondary" }, "Quién vende este producto. Debe tener al menos uno; en la orden de compra aparece primero con ellos."),
        tabla({
            titulo: "Proveedores del producto",
            filas: proveedores,
            columnas: [
                { titulo: "Proveedor", valor: (pv) => [pv.nombre, pv.activo ? null : [" ", insignia("Inactivo", "secondary")]] },
                { titulo: "Código del proveedor", valor: (pv) => pv.codigoProveedor ?? "—" },
                ...(puede.catalogo ? [{ titulo: "Acción", valor: (pv) => el("button", { type: "button", class: "btn btn-sm btn-outline-danger", "aria-label": `Quitar a ${pv.nombre}`, onclick: () => acciones.quitarProveedor(pv) }, "Quitar") }] : []),
            ],
        }),
        puede.catalogo ? el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick: acciones.agregarProveedor }, "Agregar proveedor") : null);
    return el("section", { "aria-labelledby": "tituloVista" },
        encabezado({
            titulo: `${producto.codigo} · ${producto.nombre}`,
            descripcion: `${producto.categoria}${producto.marca ? ` · ${producto.marca}` : ""} · inventario en ${unidad} · ${producto.tarifaIva}`,
            miga: [{ texto: "Productos", href: "#/productos" }, { texto: producto.codigo }],
            acciones: puede.catalogo
                ? [el("button", { type: "button", class: `btn ${producto.publicado ? "btn-outline-secondary" : "btn-primary"}`, onclick: acciones.alternarPublicado },
                      producto.publicado ? "Quitar de la tienda" : "Publicar en la tienda")]
                : [],
        }),
        alertas.nodo,
        el("p", {}, producto.publicado ? insignia("Publicado en la tienda", "success") : insignia("Sin publicar", "secondary"),
            producto.ventaPorPieza ? [" ", insignia("Se vende por pieza", "info")] : null,
            producto.cortesEstandar ? [" ", insignia("Cortes estándar", "info")] : null,
            producto.precioPorVariante ? [" ", insignia("Precio por color o talla", "info")] : null),
        // Ficha en pestanas: antes eran 4 bloques largos uno debajo del otro
        // (divulgacion progresiva: se ve una cosa a la vez, el resto a un clic).
        pestanas([
            { id: "variantes", titulo: `Variantes (${producto.variantes.length})`, contenido: () => panelVariantes },
            { id: "formas", titulo: `Formas de venta y precios (${formas.length})`, contenido: () => panelFormas },
            { id: "proveedores", titulo: `Proveedores (${proveedores.length})`, contenido: () => panelProveedores },
            { id: "descuentos", titulo: "Descuentos y ofertas", contenido: () => panelDescuentos },
            { id: "general", titulo: "Datos generales", contenido: () => panelGeneral },
        ], { activa: pestana, alCambiar: alCambiarPestana, etiqueta: `Secciones de ${producto.codigo}` }));
}

function panelesFicha({ producto, formas, unidad, puede, acciones, formularioGeneral }) {
    const panelFormas =
        el("section", { class: "mb-4", "aria-labelledby": "tituloFormas" },
            el("div", { class: "d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2" },
                el("h2", { class: "h5 mb-0", id: "tituloFormas" }, "Formas de venta y precios"),
                el("div", { class: "d-flex flex-wrap gap-2" },
                    puede.precios && puede.catalogo ? el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick: acciones.nuevaForma }, "Agregar forma de venta") : null,
                    el("button", { type: "button", class: "btn btn-sm btn-outline-secondary", onclick: acciones.historial }, "Historial de precios"))),
            tabla({
                titulo: "Formas de venta",
                filas: formas,
                columnas: [
                    { titulo: "Forma de venta", valor: (f) => f.descripcion, clave: "descripcion" },
                    { titulo: `Contenido (${unidad})`, numerica: true, valor: (f) => formato.numero(f.factor), clave: "factor" },
                    { titulo: "Compra mínima", numerica: true, valor: (f) => formato.numero(f.cantidadMinima), clave: "cantidadMinima" },
                    { titulo: "Cómo se pide", valor: (f) => opcionesIncremento(f.incremento).find((o) => o.valor === Number(f.incremento))?.etiqueta, clave: "incremento" },
                    { titulo: "Precio con IVA", numerica: true, valor: (f) => (f.preciosConIva.size > 1 ? `${[...f.preciosConIva].map(formato.dinero).join(" / ")} (varía por variante)` : formato.dinero([...f.preciosConIva][0])) },
                    { titulo: "Estado", valor: (f) => (f.activa ? insignia("Activa", "success") : insignia("Inactiva", "secondary")) },
                ],
                acciones: (f) => [
                    puede.precios ? el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick: () => acciones.cambiarPrecio(f), "aria-label": `Cambiar precio de ${f.descripcion}` }, "Cambiar precio") : null,
                    puede.catalogo ? el("button", { type: "button", class: "btn btn-sm btn-outline-secondary", onclick: () => acciones.alternarForma(f), "aria-label": `${f.activa ? "Desactivar" : "Activar"} ${f.descripcion}` }, f.activa ? "Desactivar" : "Activar") : null,
                ],
            }));

    const panelVariantes =
        el("section", { class: "mb-4", "aria-labelledby": "tituloVariantes" },
            el("div", { class: "d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2" },
                el("h2", { class: "h5 mb-0", id: "tituloVariantes" }, "Variantes"),
                puede.catalogo ? el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick: acciones.nuevaVariante }, "Agregar variante") : null),
            tabla({
                titulo: "Variantes del producto",
                filas: producto.variantes,
                columnas: [
                    { titulo: "SKU", valor: (v) => v.sku, clave: "sku" },
                    { titulo: "Características", valor: (v) => Object.entries(v.caracteristicas).map(([k, x]) => `${k}: ${x}`).join(" · ") || "—" },
                    { titulo: `Disponible (${unidad})`, numerica: true, valor: (v) => formato.numero(v.stock.disponible) },
                    { titulo: "Existencia mínima", numerica: true, valor: (v) => formato.numero(v.stockMinimo), clave: "stockMinimo" },
                    { titulo: "Estado", valor: (v) => [v.activa ? insignia("Activa", "success") : insignia("Inactiva", "secondary"), v.stock.requiere_compra ? [" ", insignia("Reponer", "warning")] : null] },
                ],
                acciones: (v) => [
                    el("a", { class: "btn btn-sm btn-outline-primary", href: `#/inventario/producto/${producto.idProducto}?v=${v.idVariante}`, "aria-label": `Kárdex de ${v.sku}` }, "Kárdex"),
                    puede.catalogo ? el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick: () => acciones.editarVariante(v), "aria-label": `Editar ${v.sku}` }, "Editar") : null,
                ],
            }));

    const panelDescuentos =
        el("section", { class: "mb-4", "aria-labelledby": "tituloDescuentos" },
            el("h2", { class: "h5", id: "tituloDescuentos" }, "Descuentos por volumen y ofertas"),
            producto.descuentosVolumen.length
                ? el("ul", {}, producto.descuentosVolumen.map((d) => el("li", {}, `${d.porcentaje} % desde ${formato.numero(d.cantidadMinima)} ${unidad} `, d.activo ? insignia("Activo", "success") : insignia("Inactivo", "secondary"))))
                : el("p", {}, "Sin descuentos por volumen."),
            el("p", {}, el("a", { href: `#/r/descuentos-volumen?idProducto=${producto.idProducto}` }, "Administrar descuentos por volumen"), " · ", el("a", { href: "#/ofertas" }, "Administrar ofertas")),
            producto.ofertas.length
                ? tabla({
                      titulo: "Ofertas del producto",
                      filas: producto.ofertas,
                      columnas: [
                          { titulo: "Descuento", valor: (o) => `${o.porcentaje} %` },
                          { titulo: "Desde", valor: (o) => formato.fecha(o.desde), clave: "desde" },
                          { titulo: "Hasta", valor: (o) => formato.fecha(o.hasta), clave: "hasta" },
                          { titulo: "Estado", valor: (o) => o.estado, clave: "estado" },
                      ],
                  })
                : null);

    const panelGeneral =
        el("section", { class: "mb-4", "aria-labelledby": "tituloGeneral" },
            el("h2", { class: "h5", id: "tituloGeneral" }, "Datos generales"),
            puede.catalogo ? el("div", { class: "card" }, el("div", { class: "card-body" }, formularioGeneral)) : el("p", {}, "Solo lectura."));
    return { panelFormas, panelVariantes, panelDescuentos, panelGeneral };
}
