// js/controllers/compras.controller.js
// CONTROLADOR de compras: ordenes (borrador -> emitida -> recepcion en bodega)
// y facturas de proveedores. Las vistas de este modulo son pequenas y se
// arman aqui con los componentes compartidos (views/componentes.js).
import { anunciar, el, enUnidadCompra, formato, montar, nombreCompra, nuevoId, plural } from "../core/dom.js";
import { navegar } from "../core/router.js";
import { sesion } from "../core/sesion.js";
import { aplicarErroresApi, marcarCampo, mostrarResumen, validarValor } from "../core/validacion.js";
import { CompraModelo } from "../models/negocio.model.js";
import { RecursoModelo } from "../models/recurso.model.js";
import { InventarioModelo } from "../models/negocio.model.js";
import { ordenServidor, paramsOrden, alerta, campo, cargando, confirmar, dialogo, encabezado, insignia, notaObligatorios, paginacion, resumenErrores, tabla, zonaAlertas, envolverOrdenable } from "../views/componentes.js";
import { formulario } from "../views/formulario.js";
import { aNumero, bandasPorPaquete, dialogoCompra } from "../views/compra.view.js";

const contenido = () => document.getElementById("contenido");
const TONO = { BORRADOR: "secondary", EMITIDA: "primary", CERRADA: "success", ANULADA: "danger" };
const estado = { page: 1, estado: "", filas: [], meta: null };

// ------------------------------------------------------------------ Lista de ordenes
export async function ordenes() {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando órdenes de compra…"));
    const idEstado = nuevoId("estado");
    async function cargar() {
        try {
            const { data, meta } = await CompraModelo.ordenes({ page: estado.page, limit: 20, estado: estado.estado, ...paramsOrden(estado) });
            Object.assign(estado, { filas: data, meta });
        } catch (error) {
            alertas.error(error, "No se pudieron cargar las órdenes");
        }
        montar(contenido(),
            el("section", { "aria-labelledby": "tituloVista" },
                encabezado({
                    titulo: "Órdenes de compra",
                    descripcion: "Pedido al proveedor → se emite → bodega recibe (crea los lotes con su costo).",
                    acciones: sesion.puede("COMPRA_GESTIONAR") ? [el("a", { class: "btn btn-primary", href: "#/compras/nueva" }, "Nueva orden de compra")] : [],
                }),
                alertas.nodo,
                el("form", { role: "search", "aria-label": "Filtrar órdenes", class: "barra-lista", onsubmit: (e) => { e.preventDefault(); estado.estado = new FormData(e.currentTarget).get("estado"); estado.page = 1; cargar().then(() => anunciar(`${estado.meta?.totalItems ?? 0} órdenes`)); } },
                    el("div", {}, el("label", { class: "form-label", for: idEstado }, "Estado"),
                        el("select", { id: idEstado, name: "estado", class: "form-select" },
                            [["", "Todos"], ["BORRADOR", "Borrador"], ["EMITIDA", "Emitida"], ["CERRADA", "Cerrada"], ["ANULADA", "Anulada"]].map(([v, t]) => el("option", { value: v, selected: estado.estado === v }, t)))),
                    el("div", {}, el("button", { type: "submit", class: "btn btn-outline-primary w-100" }, "Aplicar"))),
                tabla({
                    titulo: "Órdenes de compra",
                    filas: estado.filas,
                    orden: ordenServidor(estado, cargar),
                    vacio: "No hay órdenes de compra.",
                    columnas: [
                        { titulo: "N.º", valor: (o) => el("a", { href: `#/compras/${o.id_orden_compra}` }, `OC-${o.id_orden_compra}`), clave: "id_orden_compra" },
                        { titulo: "Proveedor", valor: (o) => o.proveedor, clave: "proveedor" },
                        { titulo: "Fecha", valor: (o) => formato.fecha(o.oc_fecha), clave: "oc_fecha" },
                        { titulo: "Entrega esperada", valor: (o) => formato.fecha(o.oc_fecha_entrega_esperada), clave: "oc_fecha_entrega_esperada" },
                        { titulo: "Valor pactado", numerica: true, valor: (o) => formato.dinero(o.valor_pactado), clave: "valor_pactado" },
                        { titulo: "Estado", clave: "oc_estado", valor: (o) => [insignia(o.oc_estado, TONO[o.oc_estado]), " ", formato.texto(o.estado_recepcion), o.atrasada ? [" ", insignia("Atrasada", "warning")] : null] },
                    ],
                }),
                paginacion(estado.meta, (n) => { estado.page = n; cargar(); })));
    }
    await cargar();
}

// ------------------------------------------------------------------ Nueva orden
// Misma logica que la venta: 1. proveedor, 2. productos (se busca el producto
// y se especifican sus variantes con cantidad y costo), 3. guardar borrador.
export async function nueva() {
    if (!sesion.puede("COMPRA_GESTIONAR")) {
        montar(contenido(), encabezado({ titulo: "Nueva orden de compra" }), alerta("warning", "No tienes permiso para gestionar compras."));
        return;
    }
    montar(contenido(), cargando());
    const proveedores = await RecursoModelo.opciones("proveedores");
    const resumen = resumenErrores();
    const lineas = []; // { variante, producto, unidad, entero, cantidad, costo, detalle }
    const cuerpo = el("tbody");
    const total = el("p", { class: "fs-5 fw-bold", role: "status", "aria-live": "polite" });
    const resultados = el("div", { class: "mt-2", "aria-live": "polite" });

    const pintarTotal = () => {
        const t = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (aNumero(l.costo) || 0), 0);
        montar(total, lineas.length ? `Total pactado: ${formato.dinero(t)} sin IVA` : "Agrega productos a la orden.");
    };
    function pintarLineas() {
        montar(cuerpo, ...lineas.map((l, i) => {
            const idC = nuevoId("cant");
            const idK = nuevoId("costo");
            const enUnidades = l.factor > 1 || Boolean(l.unidadCompra);
            l.control = el("input", { id: idC, type: "number", class: "form-control", min: 0, step: l.entero || enUnidades ? 1 : 0.01, inputmode: l.entero || enUnidades ? "numeric" : "decimal",
                value: l.cantidad, "aria-describedby": `${idC}-ayuda ${idC}-e`, dataset: { error: `${idC}-e` },
                oninput: (e) => { l.cantidad = e.target.value; montar(ayudaCantidad, textoCantidad()); pintarTotal(); } });
            const textoCantidad = () => (enUnidades ? `${plural(l.unidadCompra)} de ${formato.numero(l.factor)} ${l.unidad} (= ${formato.numero((Number(l.cantidad) || 0) * l.factor)} ${l.unidad})` : l.unidad);
            const ayudaCantidad = el("div", { id: `${idC}-ayuda`, class: "form-text" }, textoCantidad());
            l.controlCosto = el("input", { id: idK, type: "text", class: "form-control", inputmode: "decimal", autocomplete: "off",
                value: String(l.costo).replace(".", ","), "aria-describedby": `${idK}-e`, dataset: { error: `${idK}-e` },
                oninput: (e) => {
                    l.costo = e.target.value;
                    // sin costo por variante, el costo es uno para todo el producto: se copia a sus otras lineas
                    if (!l.costoPorVariante) for (const otra of lineas) if (otra !== l && otra.idProducto === l.idProducto) { otra.costo = l.costo; if (otra.controlCosto) otra.controlCosto.value = l.costo; }
                    pintarTotal();
                } });
            return el("tr", {},
                el("th", { scope: "row", class: "fw-normal" }, l.producto, el("span", { class: "d-block small text-body-secondary" }, [l.detalle, l.variante.sku].filter(Boolean).join(" · "))),
                el("td", {}, el("label", { class: "visually-hidden", for: idC }, `Cantidad de ${l.producto} ${l.detalle}`), l.control,
                    ayudaCantidad,
                    el("div", { id: `${idC}-e`, class: "invalid-feedback", "aria-live": "polite" })),
                el("td", {}, el("label", { class: "visually-hidden", for: idK }, `Costo sin IVA de ${l.producto} ${l.detalle}`), l.controlCosto,
                    el("div", { id: `${idK}-e`, class: "invalid-feedback", "aria-live": "polite" })),
                el("td", {}, el("button", { type: "button", class: "btn btn-sm btn-outline-danger", "aria-label": `Quitar ${l.producto} ${l.detalle}`,
                    onclick: () => { lineas.splice(i, 1); pintarLineas(); anunciar("Línea quitada"); } }, "Quitar")));
        }));
        pintarTotal();
    }

    async function especificar(idProducto) {
        try {
            const p = await CompraModelo.producto(idProducto);
            dialogoCompra({
                p,
                alAgregar: (nuevas) => {
                    for (const n of nuevas) {
                        const igual = lineas.find((l) => l.variante.idVariante === n.variante.idVariante);
                        if (igual) {
                            igual.cantidad = Number(igual.cantidad) + n.cantidad;
                            igual.costo = n.costo;
                        } else {
                            if (!p.costoPorVariante) for (const otra of lineas) if (otra.idProducto === p.idProducto) otra.costo = n.costo;
                            lineas.push({ ...n, producto: p.nombre, idProducto: p.idProducto, costoPorVariante: p.costoPorVariante, unidad: p.unidad, entero: p.entero });
                        }
                    }
                    pintarLineas();
                },
            }).abrir();
        } catch (error) {
            resultados.prepend(alerta("danger", error.message));
        }
    }

    const idBusca = nuevoId("busca");
    const buscar = el("form", { role: "search", "aria-label": "Buscar productos para la orden", class: "d-flex flex-wrap gap-2 align-items-end",
        onsubmit: async (e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q").trim();
            try {
                const idProv = Number(tarjetaProveedor.querySelector("[name=idProveedor]")?.value) || null;
                const encontrados = await CompraModelo.productos(q, idProv);
                montar(resultados, encontrados.length
                    ? el("ul", { class: "list-group", "aria-label": `Productos encontrados: ${encontrados.length}` }, encontrados.map((x) =>
                          el("li", { class: "list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2" },
                              el("span", { class: "d-flex align-items-center gap-3" },
                                  x.imagen_url ? el("img", { src: x.imagen_url, alt: "", width: 48, height: 48, class: "rounded object-fit-cover", loading: "lazy" }) : null,
                                  el("span", {}, el("span", { class: "fw-semibold" }, x.prd_nombre),
                                      idProv ? (x.del_proveedor ? [" ", insignia("De este proveedor", "success")] : el("span", { class: "d-block small text-warning-emphasis" }, "No registrado con este proveedor")) : null,
                                      el("span", { class: "d-block small text-body-secondary" },
                                          [x.prd_codigo, x.categoria, `en ${x.unidad}`, x.variantes > 1 ? `${x.variantes} variantes` : null,
                                              x.a_reponer ? `${x.a_reponer} bajo el mínimo` : null].filter(Boolean).join(" · ")))),
                              el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-label": `Elegir ${x.prd_nombre}`, onclick: () => especificar(x.id_producto) }, "Elegir"))))
                    : el("p", { role: "status" }, "Sin resultados."));
            } catch (error) {
                montar(resultados, alerta("danger", error.message));
            }
        } },
        el("div", { class: "flex-grow-1" }, el("label", { class: "form-label", for: idBusca }, "Buscar producto"),
            el("input", { id: idBusca, name: "q", type: "search", class: "form-control", placeholder: "Nombre, código o categoría (vacío = los que hay que reponer primero)",
                "aria-describedby": `${idBusca}-error`, dataset: { error: `${idBusca}-error` } }),
            el("div", { id: `${idBusca}-error`, class: "invalid-feedback", "aria-live": "polite" })),
        el("button", { type: "submit", class: "btn btn-outline-primary" }, "Buscar"));

    const tarjetaProveedor = el("section", { class: "card mb-3", "aria-labelledby": "tituloProveedor" }, el("div", { class: "card-body" },
        el("h2", { class: "h5", id: "tituloProveedor" }, "1. Proveedor"),
        el("div", { class: "grilla-form" },
            campo({ nombre: "idProveedor", etiqueta: "Proveedor", tipo: "seleccion", requerido: true, opciones: proveedores }),
            campo({ nombre: "fechaEntregaEsperada", etiqueta: "Entrega esperada", tipo: "fecha" }))));
    const tarjetaProductos = el("section", { class: "card mb-3", "aria-labelledby": "tituloProductosOc" }, el("div", { class: "card-body" },
        el("h2", { class: "h5", id: "tituloProductosOc" }, "2. Productos"),
        buscar, resultados,
        el("div", { class: "mt-3" }, envolverOrdenable(
            el("table", { class: "table align-middle lineas-tabla" },
                el("caption", { class: "visually-hidden" }, "Líneas de la orden de compra"),
                el("thead", {}, el("tr", {}, ["Producto", "Cantidad", "Costo sin IVA por unidad pedida (USD)", "Acción"].map((t) => el("th", { scope: "col" }, t)))),
                cuerpo),
            { "aria-label": "Líneas de la orden (desplazable)" })),
        total));
    const form = el("form", { novalidate: true, class: "card", "aria-labelledby": "tituloGuardarOc" }, el("div", { class: "card-body" },
        el("h2", { class: "h5", id: "tituloGuardarOc" }, "3. Guardar"),
        resumen, notaObligatorios(),
        campo({ nombre: "observacion", etiqueta: "Observación", tipo: "textoLargo", max: 250 }),
        el("div", { class: "d-flex flex-wrap gap-2" },
            el("button", { type: "submit", class: "btn btn-primary" }, "Guardar como borrador"),
            el("a", { class: "btn btn-outline-secondary", href: "#/compras" }, "Cancelar"))));

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errores = [];
        const prov = tarjetaProveedor.querySelector("[name=idProveedor]");
        const mProv = prov.value ? null : "Elige el proveedor.";
        marcarCampo(prov, mProv);
        if (mProv) errores.push({ control: prov, mensaje: mProv });
        const obs = form.elements.namedItem("observacion");
        const mObs = validarValor(obs.value, { etiqueta: "Observación", patron: "texto", max: 250 });
        marcarCampo(obs, mObs);
        if (mObs) errores.push({ control: obs, mensaje: mObs });
        const buscaProd = document.getElementById(idBusca);
        if (buscaProd) marcarCampo(buscaProd, lineas.length ? null : "Agrega al menos un producto.");
        if (lineas.length === 0) errores.push({ control: buscaProd, mensaje: "Agrega al menos un producto." });
        for (const l of lineas) {
            const c = Number(l.cantidad);
            const k = aNumero(l.costo);
            const m1 = !(c > 0) ? "La cantidad debe ser mayor que 0." : (l.entero || l.factor > 1) && !Number.isInteger(c) ? `Se compra en ${l.unidadCompra ? plural(l.unidadCompra) : l.unidad} enteros.` : null;
            const m2 = !(k > 0) ? (Number.isNaN(k) && l.costo !== "" ? "Escribe el costo con números (ej. 1,15)." : "Escribe el costo sin IVA.") : null;
            marcarCampo(l.control, m1);
            marcarCampo(l.controlCosto, m2);
            if (m1) errores.push({ control: l.control, mensaje: `${l.producto} ${l.detalle}: ${m1}` });
            if (m2) errores.push({ control: l.controlCosto, mensaje: `${l.producto} ${l.detalle}: ${m2}` });
        }
        if (errores.length) return mostrarResumen(resumen, errores);
        mostrarResumen(resumen, []);
        try {
            const fecha = tarjetaProveedor.querySelector("[name=fechaEntregaEsperada]").value;
            const oc = await CompraModelo.crearOrden({
                idProveedor: Number(prov.value),
                ...(fecha ? { fechaEntregaEsperada: fecha } : {}),
                ...(obs.value.trim() ? { observacion: obs.value.trim() } : {}),
                // la orden se guarda en la unidad del inventario: 3 rollos de 30 m = 90 m a costo/30
                lineas: lineas.map((l) => ({
                    idVariante: l.variante.idVariante,
                    cantidad: Math.round(Number(l.cantidad) * (l.factor ?? 1) * 1000) / 1000,
                    costoUnitario: Math.round((aNumero(l.costo) / (l.factor ?? 1)) * 10000) / 10000,
                })),
            });
            sessionStorage.setItem("ce_admin_mensaje", `Se guardó la OC-${oc.idOrdenCompra} como borrador. Revísala y emítela al proveedor.`);
            navegar(`/compras/${oc.idOrdenCompra}`);
        } catch (error) {
            aplicarErroresApi(form, resumen, error);
        }
    });

    pintarLineas();
    montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
        encabezado({ titulo: "Nueva orden de compra", descripcion: "Primero el proveedor, luego los productos: cada producto se especifica por talla, color o medida.", miga: [{ texto: "Órdenes de compra", href: "#/compras" }, { texto: "Nueva" }] }),
        tarjetaProveedor, tarjetaProductos, form));
}

/** "90 m" y debajo "3 rollos" (si el producto tiene unidad de compra). */
const cantidadCompra = (l, base) => [`${formato.numero(base)} ${l.unidad}`,
    l.compra_factor ? el("span", { class: "d-block small text-body-secondary" }, enUnidadCompra(base, { descripcion: l.compra_descripcion, factor: l.compra_factor, unidad: l.unidad })) : null];

// ------------------------------------------------------------------ Ficha de la orden
export async function orden({ id }) {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando la orden…"));
    async function pintar(mensaje) {
        let oc;
        try {
            oc = await CompraModelo.orden(id);
        } catch (error) {
            montar(contenido(), encabezado({ titulo: "Orden de compra" }), alerta("danger", error.message, { titulo: "No se pudo abrir la orden" }));
            return;
        }
        const gestionar = sesion.puede("COMPRA_GESTIONAR");
        const pendiente = oc.lineas.some((l) => l.cantidad_pendiente > 0);
        const acciones = [];
        if (gestionar && oc.estado === "BORRADOR") acciones.push(el("button", { type: "button", class: "btn btn-primary", onclick: () => cambiar("EMITIDA", "Emitir al proveedor", "La orden queda emitida y bodega podrá recibirla.") }, "Emitir al proveedor"));
        if (sesion.puede("INV_RECEPCIONAR") && oc.estado === "EMITIDA" && pendiente) acciones.push(el("button", { type: "button", class: "btn btn-primary", onclick: () => recibir(oc) }, "Registrar recepción"));
        if (gestionar && oc.estado === "EMITIDA") acciones.push(el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => cambiar("CERRADA", "Cerrar la orden", "No se recibirá lo pendiente.") }, "Cerrar"));
        if (gestionar && ["BORRADOR", "EMITIDA"].includes(oc.estado)) acciones.push(el("button", { type: "button", class: "btn btn-outline-danger", onclick: () => cambiar("ANULADA", "Anular la orden", "La anulación no se puede deshacer.") }, "Anular"));
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: `Orden de compra OC-${oc.idOrdenCompra}`,
                descripcion: `${oc.proveedor?.nombre ?? ""} · ${formato.fecha(oc.fecha)}${oc.fechaEntregaEsperada ? ` · entrega esperada ${formato.fecha(oc.fechaEntregaEsperada)}` : ""}`,
                miga: [{ texto: "Órdenes de compra", href: "#/compras" }, { texto: `OC-${oc.idOrdenCompra}` }],
                acciones,
            }),
            alertas.nodo,
            el("p", {}, "Estado: ", insignia(oc.estado, TONO[oc.estado]), " · Total pactado: ", el("strong", {}, formato.dinero(oc.total))),
            oc.observacion ? el("p", { class: "text-body-secondary" }, oc.observacion) : null,
            tabla({
                titulo: "Líneas de la orden",
                filas: oc.lineas,
                columnas: [
                    { titulo: "SKU", valor: (l) => l.var_sku, clave: "var_sku" },
                    { titulo: "Producto", valor: (l) => l.prd_nombre, clave: "prd_nombre" },
                    // cantidades en la unidad del inventario y, debajo, en la del proveedor (rollos, planchas...)
                    { titulo: "Pedido", numerica: true, clave: "cantidad_pedida", valor: (l) => cantidadCompra(l, l.cantidad_pedida) },
                    { titulo: "Costo sin IVA", numerica: true, clave: "costo_pactado", valor: (l) => [formato.dinero(l.costo_pactado), ` /${l.unidad}`,
                        l.compra_factor ? el("span", { class: "d-block small text-body-secondary" }, `${formato.dinero(l.costo_pactado * l.compra_factor)} por ${plural(nombreCompra(l.compra_descripcion), 1)}`) : null] },
                    { titulo: "Recibido", numerica: true, valor: (l) => cantidadCompra(l, l.cantidad_recibida), clave: "cantidad_recibida" },
                    { titulo: "Pendiente", numerica: true, valor: (l) => cantidadCompra(l, l.cantidad_pendiente), clave: "cantidad_pendiente" },
                ],
            })));
        if (mensaje) alertas.exito(mensaje);
    }
    async function cambiar(nuevo, titulo, mensaje) {
        if (!(await confirmar({ titulo, mensaje: `${mensaje} ¿Continuar?`, textoConfirmar: titulo, peligro: nuevo === "ANULADA" }))) return;
        try {
            await CompraModelo.cambiarEstado(id, nuevo);
            await pintar(`La orden quedó ${nuevo.toLowerCase()}.`);
        } catch (error) {
            alertas.error(error);
        }
    }
    function recibir(oc) {
        const pendientes = oc.lineas.filter((l) => l.cantidad_pendiente > 0);
        // Cada linea se recibe en SU unidad de compra:
        //  - rollos, conos, galones (contenido fijo): se cuentan; entra la cantidad x contenido;
        //  - planchas (contenido fijo, cada una es una pieza): se cuentan; entra un lote por plancha;
        //  - paquete de bandas (cada pieza mide distinto): se escribe la medida de cada banda;
        //  - sin unidad de compra: la cantidad en la unidad del inventario.
        const modo = (l) => (l.compra_descripcion && l.compra_factor ? (l.por_pieza ? "piezasFijas" : "unidades") : l.por_pieza ? "medidas" : "base");
        const nombre = (l) => nombreCompra(l.compra_descripcion);
        const pendienteTexto = (l) => `Pendiente: ${formato.numero(l.cantidad_pendiente)} ${l.unidad}${l.compra_factor ? ` (${enUnidadCompra(l.cantidad_pendiente, { descripcion: l.compra_descripcion, factor: l.compra_factor, unidad: l.unidad })})` : ""}.`;
        // El codigo de cada lote lo genera la base (OC<orden>-<n>): no se escribe.
        const campos = pendientes.map((l) => {
            const id = l.id_detalle_orden_compra;
            const m = modo(l);
            if (m === "medidas") {
                return { nombre: `b${id}`, etiqueta: `${l.var_sku}: ${l.compra_descripcion ? "bandas que llegaron en el paquete" : "piezas que llegaron"}`, tipo: "entero", paso: 1,
                    ayuda: `${pendienteTexto(l)} Escribe cuántas y después la medida de cada una. Vacío o 0 = no llegó.` };
            }
            if (m === "base") return { nombre: `c${id}`, etiqueta: `${l.var_sku}: cantidad recibida (${l.unidad})`, tipo: "cantidad", paso: l.paso ?? 1, ayuda: `${pendienteTexto(l)} Vacío o 0 = no llegó.` };
            return { nombre: `u${id}`, etiqueta: `${l.var_sku}: ${plural(nombre(l))} recibidos (de ${formato.numero(l.compra_factor)} ${l.unidad})`, tipo: "entero", paso: 1,
                ayuda: `${pendienteTexto(l)}${m === "piezasFijas" ? ` Cada ${plural(nombre(l), 1)} entra como su propio lote.` : ""} Vacío o 0 = no llegó.` };
        });
        const valores = Object.fromEntries(pendientes.flatMap((l) => {
            const m = modo(l);
            if (m === "base") return [[`c${l.id_detalle_orden_compra}`, l.cantidad_pendiente]];
            if (m === "unidades" || m === "piezasFijas") return [[`u${l.id_detalle_orden_compra}`, Math.floor((l.cantidad_pendiente + 1e-9) / l.compra_factor)]];
            return [];
        }));
        let d;
        const bandas = new Map(); // id de linea -> medidas() de sus bandas
        const { form, reglas } = formulario({
            campos,
            valores,
            textoEnviar: "Registrar recepción",
            alCancelar: () => d.cerrar(),
            alEnviar: async (datos) => {
                const lineas = pendientes
                    .flatMap((l) => {
                        const id = l.id_detalle_orden_compra;
                        const m = modo(l);
                        if (m === "base") return [{ idDetalleOrdenCompra: id, cantidad: Number(datos[`c${id}`] ?? 0) }];
                        if (m === "unidades") return [{ idDetalleOrdenCompra: id, cantidad: Math.round(Number(datos[`u${id}`] ?? 0) * l.compra_factor * 1000) / 1000 }];
                        // piezas: una linea (un lote) por plancha o por banda
                        const medidas = m === "piezasFijas"
                            ? Array.from({ length: Number(datos[`u${id}`] ?? 0) }, () => l.compra_factor)
                            : bandas.get(id).medidas();
                        return medidas.map((cantidad) => ({ idDetalleOrdenCompra: id, cantidad }));
                    })
                    .filter((l) => l.cantidad > 0);
                if (lineas.length === 0) {
                    const e = new Error("Indica la cantidad recibida de al menos un producto.");
                    e.detalles = [];
                    throw e;
                }
                // las bandas de un paquete no pueden sumar mas de lo pendiente
                for (const l of pendientes.filter((x) => modo(x) === "medidas")) {
                    const total = bandas.get(l.id_detalle_orden_compra).medidas().reduce((s, x) => s + x, 0);
                    if (total > l.cantidad_pendiente + 1e-9) {
                        const e = new Error(`${l.var_sku}: las bandas suman ${formato.numero(total)} ${l.unidad} y solo quedan ${formato.numero(l.cantidad_pendiente)} pendientes.`);
                        e.detalles = [{ campo: `b${l.id_detalle_orden_compra}`, mensaje: "Las bandas suman más de lo pendiente." }];
                        throw e;
                    }
                }
                await CompraModelo.recepcionar(oc.idOrdenCompra, { lineas });
                d.cerrar();
                await pintar("Recepción registrada: los lotes entraron al inventario con su costo.");
            },
        });
        for (const l of pendientes.filter((x) => modo(x) === "medidas")) {
            bandas.set(l.id_detalle_orden_compra, bandasPorPaquete({ form, reglas, id: l.id_detalle_orden_compra, unidad: l.unidad, pendiente: l.cantidad_pendiente }));
        }
        d = dialogo({ titulo: `Recepción de la OC-${oc.idOrdenCompra}`, contenido: [el("p", { class: "text-body-secondary" }, "Cuenta lo que llegó en la unidad del proveedor: rollos, planchas, conos… En un paquete de bandas indica cuántas llegaron y la medida de cada una. Cada banda y cada plancha entra como su propio lote, con un código que se genera solo (por ejemplo, OC21-1)."), form], grande: true });
        d.abrir();
    }
    await pintar(sessionStorage.getItem("ce_admin_mensaje"));
    sessionStorage.removeItem("ce_admin_mensaje");
}

// ------------------------------------------------------------------ Facturas de proveedores
export async function comprobantes() {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando facturas de proveedores…"));
    const proveedores = await RecursoModelo.opciones("proveedores");
    const est = { page: 1 };
    async function pintar(mensaje) {
        let datos = { data: [], meta: null };
        try {
            datos = await CompraModelo.comprobantes({ page: est.page, limit: 20, ...paramsOrden(est) });
        } catch (error) {
            alertas.error(error);
        }
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: "Facturas de proveedores",
                descripcion: "Cuentas por pagar: lo facturado por cada proveedor, lo pagado y el saldo.",
                acciones: sesion.puede("COMPRA_GESTIONAR") ? [el("button", { type: "button", class: "btn btn-primary", onclick: nuevo }, "Registrar factura")] : [],
            }),
            alertas.nodo,
            tabla({
                titulo: "Facturas de proveedores",
                filas: datos.data,
                orden: ordenServidor(est, pintar),
                vacio: "No hay facturas registradas.",
                columnas: [
                    { titulo: "Número", valor: (c) => c.numero, clave: "numero" },
                    { titulo: "Proveedor", valor: (c) => c.proveedor, clave: "proveedor" },
                    { titulo: "Emisión", valor: (c) => formato.fecha(c.emision), clave: "emision" },
                    { titulo: "Vence", valor: (c) => formato.fecha(c.vencimiento), clave: "vencimiento" },
                    { titulo: "Total", numerica: true, valor: (c) => formato.dinero(c.total), clave: "total" },
                    { titulo: "Saldo", numerica: true, valor: (c) => formato.dinero(c.saldo), clave: "saldo" },
                    { titulo: "Estado", valor: (c) => (c.saldo <= 0 ? insignia("Pagada", "success") : c.vencida ? insignia("Vencida", "danger") : insignia("Por pagar", "warning")) },
                ],
            }),
            paginacion(datos.meta, (n) => { est.page = n; pintar(); })));
        if (mensaje) alertas.exito(mensaje);
    }
    function nuevo() {
        let d;
        const { form } = formulario({
            campos: [
                { nombre: "idProveedor", etiqueta: "Proveedor", tipo: "seleccion", requerido: true, opciones: proveedores },
                { nombre: "tipo", etiqueta: "Tipo", tipo: "opciones", requerido: true, opciones: [{ valor: "01", etiqueta: "Factura" }, { valor: "02", etiqueta: "Nota de venta (RIMPE)" }, { valor: "00", etiqueta: "Recibo (sin comprobante)" }] },
                { nombre: "numero", etiqueta: "Número", tipo: "texto", requerido: true, max: 20, ayuda: "001-001-000000123. En un recibo se genera solo (REC-000001…)." },
                { nombre: "fechaEmision", etiqueta: "Fecha de emisión", tipo: "fecha", requerido: true },
                { nombre: "fechaVencimiento", etiqueta: "Fecha de vencimiento", tipo: "fecha", requerido: true },
                { nombre: "subtotal0", etiqueta: "Subtotal 0 %", tipo: "dinero" },
                { nombre: "subtotalGravado", etiqueta: "Subtotal gravado", tipo: "dinero" },
                { nombre: "iva", etiqueta: "IVA", tipo: "dinero" },
            ],
            textoEnviar: "Registrar",
            alCancelar: () => d.cerrar(),
            alEnviar: async (datos) => {
                // recibo: el numero lo genera el servidor y no lleva IVA
                if (datos.tipo === "00") {
                    delete datos.numero;
                    datos.subtotalGravado = 0;
                    datos.iva = 0;
                }
                const r = await CompraModelo.registrarComprobante({ ...datos, idProveedor: Number(datos.idProveedor) });
                d.cerrar();
                await pintar(datos.tipo === "00" ? "Recibo registrado: el número se generó solo." : "Factura del proveedor registrada.");
            },
        });
        // al elegir "Recibo": el numero pasa a automatico (solo lectura) y no hay IVA
        const tipo = form.elements.namedItem("tipo");
        const numero = form.elements.namedItem("numero");
        const conIva = ["subtotalGravado", "iva"].map((n) => form.elements.namedItem(n));
        let numeroEscrito = "";
        tipo.addEventListener("change", () => {
            const recibo = tipo.value === "00";
            if (recibo) {
                numeroEscrito = numero.value === "Se genera al guardar" ? numeroEscrito : numero.value;
                numero.value = "Se genera al guardar";
            } else if (numero.readOnly) {
                numero.value = numeroEscrito;
            }
            numero.readOnly = recibo;
            numero.toggleAttribute("aria-required", !recibo);
            marcarCampo(numero, null);
            for (const c of conIva) {
                c.disabled = recibo;
                if (recibo) c.value = "";
            }
        });
        d = dialogo({ titulo: "Registrar factura de proveedor", contenido: form, grande: true });
        d.abrir();
    }
    await pintar();
}
