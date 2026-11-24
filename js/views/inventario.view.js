// js/views/inventario.view.js — VISTAS del inventario.
// Flujo (igual que Productos, para que el modelo mental sea uno solo):
//   1. Lista de PRODUCTOS con su disponible total y si hay que reponer.
//   2. Ficha de inventario del producto: sus VARIANTES (maestro) y, de la
//      variante elegida, su KARDEX y sus LOTES (detalle) en pestanas.
// Asi nadie tiene que recorrer 245 filas de SKU sueltos para encontrar algo.
import { el, enUnidadCompra, formato, nuevoId } from "../core/dom.js";
import { alEscribir, encabezado, insignia, paginacion, pestanas, tabla } from "./componentes.js";

/** "12 rollos + 15 m" o "8 piezas" bajo la cantidad (si el producto tiene unidad de compra o se vende por pieza). */
function equivalente(s, base) {
    const texto = s.compra_descripcion
        ? enUnidadCompra(base, { descripcion: s.compra_descripcion, factor: s.compra_factor, unidad: s.unidad, piezas: s.piezas })
        : s.venta_por_pieza ? `${s.piezas} ${s.piezas === 1 ? "pieza" : "piezas"}` : null;
    return texto ? el("span", { class: "d-block small text-body-secondary" }, texto) : null;
}

const estadoStock = (reponer) => (reponer ? insignia("Reponer", "warning") : insignia("Suficiente", "success"));

// ------------------------------------------------------------------ 1. Lista por producto
export function vistaListaInventario({ estado, acciones, alertas }) {
    const idQ = nuevoId("q");
    const idReponer = nuevoId("reponer");
    // Los filtros se aplican solos (sin boton "Aplicar"): menos pasos y respuesta inmediata.
    const buscar = (form) => {
        const d = new FormData(form);
        acciones.buscar(String(d.get("q")).trim(), d.get("reponer") === "1");
    };
    const form = el("form", {
        role: "search", "aria-label": "Buscar en el inventario", class: "barra-lista",
        onsubmit: (e) => {
            e.preventDefault();
            buscar(e.currentTarget);
        },
    },
        el("div", {},
            el("label", { class: "form-label", for: idQ }, "Buscar producto"),
            el("input", {
                id: idQ, name: "q", type: "search", class: "form-control", value: estado.q, autocomplete: "off",
                "aria-describedby": `${idQ}-ayuda`,
                oninput: alEscribir((e) => buscar(e.target.form)),
            }),
            el("div", { id: `${idQ}-ayuda`, class: "form-text" }, "Por código o nombre. La lista se actualiza mientras escribes.")),
        el("div", { class: "form-check form-switch align-self-center" },
            el("input", { id: idReponer, name: "reponer", type: "checkbox", role: "switch", value: "1", class: "form-check-input", checked: estado.reponer, onchange: (e) => buscar(e.target.form) }),
            el("label", { class: "form-check-label", for: idReponer }, "Solo los que hay que reponer")));

    return el("section", { "aria-labelledby": "tituloVista" },
        encabezado({
            titulo: "Inventario",
            descripcion: "Elige un producto para ver sus variantes, el kárdex y los lotes de cada una.",
        }),
        alertas.nodo,
        form,
        tabla({
            titulo: "Productos en inventario",
            filas: estado.filas,
            orden: acciones.orden,
            vacio: estado.reponer ? "Ningún producto necesita reposición con esa búsqueda." : "No hay productos con esa búsqueda.",
            columnas: [
                { titulo: "Código", clave: "codigo", valor: (p) => p.codigo },
                {
                    titulo: "Producto", clave: "nombre",
                    valor: (p) => [el("a", { href: `#/inventario/producto/${p.idProducto}`, class: "fw-semibold" }, p.nombre),
                        el("span", { class: "d-block small text-body-secondary" }, [p.categoria, p.marca].filter(Boolean).join(" · "))],
                },
                { titulo: "Variantes", numerica: true, clave: "variantes", valor: (p) => formato.numero(p.variantes) },
                { titulo: "Disponible", numerica: true, clave: "disponible", valor: (p) => `${formato.numero(p.disponible)} ${(p.unidad ?? "").toLowerCase()}` },
                { titulo: "Estado", valor: (p) => estadoStock(p.requiereCompra) },
            ],
        }),
        paginacion(estado.meta, acciones.pagina));
}

// ------------------------------------------------------------------ 2. Ficha del producto
export function vistaInventarioProducto({ producto, variantes, idElegida, puede, alertas, acciones, detalle }) {
    const unidad = variantes[0]?.unidad ?? (producto.unidad ?? "").toLowerCase();
    const suma = (k) => variantes.reduce((t, v) => t + Number(v[k] ?? 0), 0);
    const nombreVariante = (v) => v.caracteristicas || v.var_sku;
    return el("section", { "aria-labelledby": "tituloVista" },
        encabezado({
            titulo: producto.nombre,
            descripcion: `${producto.codigo} · ${producto.categoria ?? ""}${producto.marca ? ` · ${producto.marca}` : ""} · inventario en ${unidad}`,
            miga: [{ texto: "Inventario", href: "#/inventario" }, { texto: producto.codigo }],
            acciones: puede.verProducto ? [el("a", { class: "btn btn-outline-secondary", href: `#/productos/${producto.idProducto}` }, "Ficha del producto")] : [],
        }),
        alertas.nodo,
        el("dl", { class: "grilla-indicadores mb-4", "aria-label": "Totales del producto" },
            [["Físico", suma("stock_fisico")], ["Reservado", suma("reservado")], ["Disponible", suma("disponible")], ["En camino", suma("en_camino")]].map(([t, v]) =>
                el("div", { class: "indicador" },
                    el("dt", { class: "small text-body-secondary" }, t),
                    el("dd", { class: "valor mb-0" }, formato.numero(v), el("span", { class: "fs-6 fw-normal text-body-secondary" }, ` ${unidad}`))))),
        el("section", { class: "mb-4", "aria-labelledby": "tituloVariantes" },
            el("h2", { class: "h5", id: "tituloVariantes" }, `Variantes (${variantes.length})`),
            el("p", { class: "small text-body-secondary" }, "Elige una variante para ver su kárdex y sus lotes. Disponible = físico − reservado por pedidos pendientes."),
            tabla({
                titulo: "Variantes del producto",
                filas: variantes,
                vacio: "Este producto no tiene variantes activas.",
                claseFila: (v) => (Number(v.id_variante) === Number(idElegida) ? "fila-elegida" : null),
                columnas: [
                    {
                        titulo: "Variante", clave: "var_sku",
                        valor: (v) => [
                            el("a", {
                                href: `#/inventario/producto/${producto.idProducto}?v=${v.id_variante}`,
                                "aria-current": Number(v.id_variante) === Number(idElegida) ? "true" : null,
                                onclick: (e) => {
                                    e.preventDefault();
                                    acciones.elegir(v.id_variante);
                                },
                            }, nombreVariante(v)),
                            el("span", { class: "d-block small text-body-secondary" }, v.var_sku),
                        ],
                    },
                    { titulo: "Físico", numerica: true, clave: "stock_fisico", valor: (v) => [formato.numero(v.stock_fisico), equivalente(v, v.stock_fisico)] },
                    { titulo: "Reservado", numerica: true, clave: "reservado", valor: (v) => formato.numero(v.reservado) },
                    { titulo: "Disponible", numerica: true, clave: "disponible", valor: (v) => el("strong", {}, formato.numero(v.disponible)) },
                    { titulo: "En camino", numerica: true, clave: "en_camino", valor: (v) => formato.numero(v.en_camino) },
                    { titulo: "Mínimo", numerica: true, clave: "stock_minimo", valor: (v) => formato.numero(v.stock_minimo) },
                    { titulo: "Estado", clave: "requiere_compra", valor: (v) => estadoStock(v.requiere_compra) },
                ],
            })),
        detalle);
}

/** Usuario corto: "inventario@comercialelite.local" -> "inventario" (el correo completo queda en el title). */
const usuarioCorto = (u) => (u ? el("span", { title: u }, String(u).split("@")[0]) : "—");

/** Detalle de la variante elegida: acciones + pestanas Kardex / Lotes. */
export function vistaDetalleVariante({ variante, lotes, kardex, puede, acciones, pestana, alCambiarPestana }) {
    const nombre = variante.caracteristicas || variante.var_sku;
    const unidad = variante.unidad;
    const kardexTabla = () => tabla({
        titulo: `Kárdex de ${variante.var_sku}`,
        filas: kardex,
        vacio: "Esta variante todavía no tiene movimientos.",
        columnas: [
            { titulo: "Fecha", clave: "fecha", valor: (k) => el("span", { class: "fecha-celda" }, formato.fechaHora(k.fecha)) },
            {
                titulo: "Movimiento", clave: "movimiento",
                valor: (k) => [k.movimiento, k.documento ? el("span", { class: "d-block small text-body-secondary" }, k.documento) : null],
            },
            { titulo: "Entrada", numerica: true, clave: "entrada", valor: (k) => (k.entrada ? el("span", { class: "mov-entrada" }, `+${formato.numero(k.entrada)}`) : "") },
            { titulo: "Salida", numerica: true, clave: "salida", valor: (k) => (k.salida ? el("span", { class: "mov-salida" }, `−${formato.numero(k.salida)}`) : "") },
            { titulo: `Saldo (${unidad})`, numerica: true, clave: "saldo", valor: (k) => el("strong", {}, formato.numero(k.saldo)) },
            { titulo: "Valor del saldo", numerica: true, clave: "saldo_valorizado", valor: (k) => formato.dinero(k.saldo_valorizado) },
            { titulo: "Usuario", clave: "usuario", valor: (k) => usuarioCorto(k.usuario) },
        ],
    });
    const lotesTabla = () => [
        el("p", { class: "text-body-secondary small" }, "Cada lote es una entrada de mercadería (en el cuero, una banda medida). Reservado = comprometido en pedidos pendientes."),
        tabla({
            titulo: `Lotes con saldo de ${variante.var_sku}`,
            filas: lotes,
            vacio: "No hay lotes con saldo.",
            columnas: [
                { titulo: "Lote", valor: (l) => [l.codigo ?? `#${l.id_lote}`, l.id_lote_origen ? el("span", { class: "d-block small text-body-secondary" }, `Cortado de #${l.id_lote_origen}`) : null] },
                { titulo: "Saldo", numerica: true, clave: "saldo", valor: (l) => formato.numero(l.saldo) },
                { titulo: "Reservado", numerica: true, clave: "reservado", valor: (l) => formato.numero(l.reservado) },
                { titulo: "Libre", numerica: true, clave: "libre", valor: (l) => el("strong", {}, formato.numero(l.libre)) },
                { titulo: "Costo sin IVA", numerica: true, clave: "costo_unitario", valor: (l) => formato.dinero(l.costo_unitario) },
                { titulo: "Ingreso", clave: "fecha_ingreso", valor: (l) => formato.fecha(l.fecha_ingreso) },
            ],
            acciones: puede.fraccionar || puede.devolver
                ? (l) => [
                      puede.fraccionar ? el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-label": `Fraccionar el lote ${l.codigo ?? l.id_lote}`, onclick: () => acciones.fraccionar(l) }, "Fraccionar") : null,
                      puede.devolver ? el("button", { type: "button", class: "btn btn-sm btn-outline-secondary", "aria-label": `Devolver al proveedor del lote ${l.codigo ?? l.id_lote}`, onclick: () => acciones.devolver(l) }, "Devolver") : null,
                  ]
                : null,
        }),
    ];
    return el("section", { class: "card", "aria-labelledby": "tituloDetalle", id: "detalleVariante" },
        el("div", { class: "card-body" },
            el("div", { class: "d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3" },
                el("div", {},
                    el("h2", { class: "h5 mb-1", id: "tituloDetalle", tabindex: "-1" }, nombre),
                    el("p", { class: "small text-body-secondary mb-0" },
                        `${variante.var_sku} · disponible ${formato.numero(variante.disponible)} ${unidad} de ${formato.numero(variante.stock_fisico)} físicos`)),
                puede.ajustar ? el("button", { type: "button", class: "btn btn-primary", onclick: acciones.ajustar }, "Registrar ajuste") : null),
            pestanas([
                { id: "kardex", titulo: `Kárdex (${kardex.length})`, contenido: kardexTabla },
                { id: "lotes", titulo: `Lotes con saldo (${lotes.length})`, contenido: lotesTabla },
            ], { activa: pestana, alCambiar: alCambiarPestana, etiqueta: `Información de ${variante.var_sku}` })));
}
