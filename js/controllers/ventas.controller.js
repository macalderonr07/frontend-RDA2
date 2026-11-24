// js/controllers/ventas.controller.js
// CONTROLADOR de ventas: pedidos de todos los canales, venta de mostrador,
// pagos, facturacion, entrega y cuentas por cobrar. Las reglas (precio
// vigente, oferta, descuento por volumen, stock, reserva de bandas, estados)
// las aplica la base: aqui solo se guia al usuario y se muestran sus mensajes.
import { anunciar, el, formato, montar, nuevoId } from "../core/dom.js";
import { navegar } from "../core/router.js";
import { sesion } from "../core/sesion.js";
import { aplicarErroresApi, marcarCampo, mostrarResumen, validarValor } from "../core/validacion.js";
import { VentaModelo } from "../models/negocio.model.js";
import { RecursoModelo } from "../models/recurso.model.js";
import { ordenServidor, paramsOrden, alerta, campo, cargando, confirmar, dialogo, encabezado, insignia, notaObligatorios, paginacion, resumenErrores, tabla, zonaAlertas } from "../views/componentes.js";
import { formulario } from "../views/formulario.js";
import { formularioFacturacion } from "../views/venta.view.js";

const contenido = () => document.getElementById("contenido");
const ESTADOS = { PEN: ["Pendiente de pago", "warning"], PAG: ["Pagado", "info"], FAC: ["Facturado", "primary"], DES: ["Despachado", "primary"], ENT: ["Entregado", "success"], CAN: ["Cancelado", "danger"] };
const CANALES = { TDA: "Tienda", WEB: "E-commerce", WSP: "WhatsApp" };
const insigniaEstado = (e) => insignia(ESTADOS[e]?.[0] ?? e, ESTADOS[e]?.[1] ?? "secondary");

function dialogoFormulario({ titulo, campos, valores, textoEnviar, alEnviar, ayuda = null, extra = null }) {
    let d;
    const { form } = formulario({
        campos,
        valores,
        textoEnviar,
        alCancelar: () => d.cerrar(),
        alEnviar: async (datos) => {
            await alEnviar(datos);
            d.cerrar();
        },
    });
    d = dialogo({ titulo, contenido: [ayuda ? el("p", { class: "text-body-secondary" }, ayuda) : null, extra, form], grande: Boolean(extra) });
    d.abrir();
}

// ------------------------------------------------------------------ Lista
const estado = { page: 1, estado: "", canal: "", q: "", filas: [], meta: null };

export async function pedidos({ consulta }) {
    const alertas = zonaAlertas();
    if (consulta?.get("estado")) estado.estado = consulta.get("estado");
    montar(contenido(), cargando("Cargando pedidos…"));
    const ids = { q: nuevoId("q"), estado: nuevoId("estado"), canal: nuevoId("canal") };
    async function cargar() {
        try {
            const { data, meta } = await VentaModelo.pedidos({ page: estado.page, limit: 20, estado: estado.estado, canal: estado.canal, q: estado.q, ...paramsOrden(estado) });
            Object.assign(estado, { filas: data, meta });
        } catch (error) {
            alertas.error(error, "No se pudieron cargar los pedidos");
        }
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: "Pedidos",
                descripcion: "Ventas de la tienda física, WhatsApp y el e-commerce.",
                acciones: sesion.puede("VENTA_REGISTRAR") ? [el("a", { class: "btn btn-primary", href: "#/ventas/nueva" }, "Nueva venta en tienda")] : [],
            }),
            alertas.nodo,
            el("form", {
                role: "search", "aria-label": "Buscar pedidos", class: "barra-lista",
                onsubmit: (e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    Object.assign(estado, { q: String(d.get("q")).trim(), estado: d.get("estado"), canal: d.get("canal"), page: 1 });
                    cargar().then(() => anunciar(`${estado.meta?.totalItems ?? 0} pedidos`));
                },
            },
                el("div", {}, el("label", { class: "form-label", for: ids.q }, "Cliente o número"), el("input", { id: ids.q, name: "q", type: "search", class: "form-control", value: estado.q })),
                el("div", {}, el("label", { class: "form-label", for: ids.estado }, "Estado"),
                    el("select", { id: ids.estado, name: "estado", class: "form-select" }, el("option", { value: "" }, "Todos"),
                        Object.entries(ESTADOS).map(([v, [t]]) => el("option", { value: v, selected: estado.estado === v }, t)))),
                el("div", {}, el("label", { class: "form-label", for: ids.canal }, "Canal"),
                    el("select", { id: ids.canal, name: "canal", class: "form-select" }, el("option", { value: "" }, "Todos"),
                        Object.entries(CANALES).map(([v, t]) => el("option", { value: v, selected: estado.canal === v }, t)))),
                el("div", {}, el("button", { type: "submit", class: "btn btn-outline-primary w-100" }, "Aplicar"))),
            tabla({
                titulo: "Pedidos",
                filas: estado.filas,
                orden: ordenServidor(estado, cargar),
                vacio: "No hay pedidos con esos filtros.",
                columnas: [
                    { titulo: "N.º", clave: "id_pedido", valor: (p) => el("a", { href: `#/ventas/${p.id_pedido}` }, `#${p.id_pedido}`) },
                    { titulo: "Fecha", valor: (p) => formato.fechaHora(p.fecha), clave: "fecha" },
                    { titulo: "Canal", clave: "canal", valor: (p) => CANALES[p.canal] ?? p.canal },
                    { titulo: "Cliente", valor: (p) => p.cliente, clave: "cliente" },
                    { titulo: "Total", numerica: true, valor: (p) => formato.dinero(p.total), clave: "total" },
                    { titulo: "Pagado", numerica: true, valor: (p) => formato.dinero(p.pagado), clave: "pagado" },
                    { titulo: "Estado", clave: "estado", valor: (p) => insigniaEstado(p.estado) },
                ],
            }),
            paginacion(estado.meta, (n) => { estado.page = n; cargar(); })));
    }
    await cargar();
}

// ------------------------------------------------------------------ Ficha del pedido
export async function pedido({ id }) {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando el pedido…"));
    const [metodos, puntos, motivos] = await Promise.all([RecursoModelo.opciones("metodos-pago"), RecursoModelo.opciones("puntos-emision"), RecursoModelo.opciones("motivos-avance")]);

    async function pintar(mensaje) {
        let p;
        try {
            p = await VentaModelo.pedido(id);
        } catch (error) {
            montar(contenido(), encabezado({ titulo: "Pedido" }), alerta("danger", error.message, { titulo: "No se pudo abrir el pedido" }));
            return;
        }
        const saldo = Math.round((p.total - p.cubierto) * 100) / 100;
        const acciones = [];
        if (sesion.puede("PAGO_REGISTRAR") && ["PEN", "PAG", "FAC"].includes(p.estado) && saldo > 0) acciones.push(el("button", { type: "button", class: "btn btn-primary", onclick: () => pagar(p, saldo) }, "Registrar pago"));
        if (sesion.puede("VENTA_FACTURAR") && p.estado === "PAG" && p.comprobantes.length === 0) acciones.push(el("button", { type: "button", class: "btn btn-primary", onclick: () => facturar(p, false) }, "Emitir comprobante"));
        // venta a credito: se factura sin estar pagado y el saldo queda como cuenta por cobrar
        if (sesion.puede("VENTA_FACTURAR") && sesion.puede("CREDITO_OTORGAR") && p.estado === "PEN" && saldo > 0 && p.comprobantes.length === 0) {
            acciones.push(el("button", { type: "button", class: "btn btn-outline-primary", onclick: () => facturar(p, true) }, "Facturar a crédito"));
        }
        if (sesion.puede("CREDITO_OTORGAR") && p.estado !== "CAN") acciones.push(el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => avance(p) }, "Avance de dinero"));
        if (sesion.puede("PEDIDO_DESPACHAR") && p.estado === "FAC") {
            acciones.push(el("button", { type: "button", class: "btn btn-outline-primary", onclick: () => cambiar("DES", "Marcar despachado") }, "Marcar despachado"));
            acciones.push(el("button", { type: "button", class: "btn btn-outline-primary", onclick: () => cambiar("ENT", "Marcar entregado") }, "Marcar entregado"));
        }
        if (sesion.puede("PEDIDO_DESPACHAR") && p.estado === "DES") acciones.push(el("button", { type: "button", class: "btn btn-outline-primary", onclick: () => cambiar("ENT", "Marcar entregado") }, "Marcar entregado"));
        if (sesion.puede("VENTA_REGISTRAR") && ["PEN", "PAG"].includes(p.estado)) acciones.push(el("button", { type: "button", class: "btn btn-outline-danger", onclick: () => cambiar("CAN", "Cancelar pedido") }, "Cancelar pedido"));

        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: `Pedido #${p.id_pedido}`,
                descripcion: `${CANALES[p.canal] ?? p.canal} · ${formato.fechaHora(p.fecha)} · ${p.cliente}${p.vendedor ? ` · vendió ${p.vendedor}` : ""}`,
                miga: [{ texto: "Pedidos", href: "#/ventas" }, { texto: `#${p.id_pedido}` }],
                acciones,
            }),
            alertas.nodo,
            el("p", {}, "Estado: ", insigniaEstado(p.estado), saldo > 0 ? [" · Saldo por cobrar: ", el("strong", {}, formato.dinero(saldo))] : null),
            p.observacion ? el("p", { class: "text-body-secondary" }, p.observacion) : null,
            el("p", {}, el("span", { class: "fw-semibold" }, "Entrega: "), p.envio ? `a domicilio, ${p.envio.direccion}${p.envio.costo ? ` (envío ${formato.dinero(p.envio.costo)})` : ""}` : "retira en el local"),
            tabla({
                titulo: "Líneas del pedido",
                filas: p.lineas,
                columnas: [
                    { titulo: "Producto", valor: (l) => [l.prd_nombre, el("span", { class: "d-block small text-body-secondary" }, `${l.var_sku}${l.pieza ? ` · banda ${l.pieza}` : ""}`)] },
                    { titulo: "Forma de venta", valor: (l) => l.presentacion, clave: "presentacion" },
                    { titulo: "Cantidad", numerica: true, valor: (l) => formato.numero(l.cantidad), clave: "cantidad" },
                    { titulo: "Precio con IVA", numerica: true, valor: (l) => formato.dinero(l.precio_con_iva), clave: "precio_con_iva" },
                    { titulo: "Descuentos", valor: (l) => [l.pct_oferta ? `Oferta ${l.pct_oferta} %` : null, l.pct_volumen ? `Volumen ${l.pct_volumen} %` : null].filter(Boolean).join(" · ") || "—" },
                    { titulo: "Total con IVA", numerica: true, valor: (l) => formato.dinero(l.total_con_iva), clave: "total_con_iva" },
                ],
            }),
            el("dl", { class: "row mb-4" },
                [["Subtotal 0 %", p.subtotal_0], ["Subtotal gravado", p.subtotal_gravado], ["Descuento", p.descuento], ["IVA", p.iva], ["Total", p.total], ["Pagado", p.pagado]].map(([t, v]) => [
                    el("dt", { class: "col-6 col-sm-3" }, t), el("dd", { class: "col-6 col-sm-3 text-end" }, formato.dinero(v)),
                ])),
            el("div", { class: "grilla-form" },
                el("section", { "aria-labelledby": "tituloPagos" }, el("h2", { class: "h5", id: "tituloPagos" }, "Pagos"),
                    tabla({ titulo: "Pagos del pedido", filas: p.pagos, vacio: "Sin pagos.", columnas: [
                        { titulo: "Fecha", valor: (x) => formato.fechaHora(x.fecha), clave: "fecha" },
                        { titulo: "Método", valor: (x) => x.metodo, clave: "metodo" },
                        { titulo: "Monto", numerica: true, valor: (x) => formato.dinero(x.monto), clave: "monto" },
                        { titulo: "Estado", valor: (x) => x.estado, clave: "estado" },
                    ] })),
                el("section", { "aria-labelledby": "tituloHistorial" }, el("h2", { class: "h5", id: "tituloHistorial" }, "Historial"),
                    el("ol", { class: "list-group list-group-numbered" }, p.historial.map((h) => el("li", { class: "list-group-item" }, `${h.estado} · ${formato.fechaHora(h.fecha)}${h.observacion ? ` · ${h.observacion}` : ""}`))))),
            p.cuentas.length ? el("section", { class: "mt-4", "aria-labelledby": "tituloCuentas" }, el("h2", { class: "h5", id: "tituloCuentas" }, "Cuentas por cobrar de este pedido"),
                tabla({ titulo: "Cuentas por cobrar del pedido", filas: p.cuentas, columnas: [
                    { titulo: "Tipo", valor: (c) => (c.tipo === "AVANCE" ? `Avance de dinero${c.motivo ? ` (${c.motivo})` : ""}` : "Venta a crédito"), clave: "tipo" },
                    { titulo: "Concepto", valor: (c) => c.concepto, clave: "concepto" },
                    { titulo: "Vence", valor: (c) => formato.fecha(c.vencimiento), clave: "vencimiento" },
                    { titulo: "Monto", numerica: true, valor: (c) => formato.dinero(c.monto), clave: "monto" },
                    { titulo: "Saldo", numerica: true, valor: (c) => formato.dinero(c.saldo), clave: "saldo" },
                ] }),
                el("p", { class: "small" }, el("a", { href: "#/ventas/cobros" }, "Registrar un abono en Cuentas por cobrar"))) : null,
            p.comprobantes.length ? el("section", { class: "mt-4", "aria-labelledby": "tituloComprobantes" }, el("h2", { class: "h5", id: "tituloComprobantes" }, "Comprobantes"),
                tabla({ titulo: "Comprobantes", filas: p.comprobantes, columnas: [
                    { titulo: "Tipo", valor: (c) => c.tipo_comprobante, clave: "tipo_comprobante" },
                    { titulo: "Número", valor: (c) => c.numero, clave: "numero" },
                    { titulo: "A nombre de", valor: (c) => c.razon_social, clave: "razon_social" },
                    { titulo: "Total", numerica: true, valor: (c) => formato.dinero(c.total), clave: "total" },
                    { titulo: "SRI", valor: (c) => formato.texto(c.estado_sri), clave: "estado_sri" },
                ] })) : null));
        if (mensaje) alertas.exito(mensaje);
    }

    async function cambiar(nuevo, titulo) {
        if (!(await confirmar({ titulo, mensaje: `¿${titulo} del pedido #${id}?`, textoConfirmar: titulo, peligro: nuevo === "CAN" }))) return;
        try {
            await VentaModelo.cambiarEstado(id, nuevo);
            await pintar(`Pedido ${ESTADOS[nuevo][0].toLowerCase()}.`);
        } catch (error) {
            alertas.error(error);
        }
    }
    /**
     * Deudas del cliente, como dato ADICIONAL al cobrar: cuanto debe (creditos y
     * avances), lo vencido, y cada cuenta desplegable con su detalle. Desde
     * aqui se puede abonar a la deuda sin salir del pedido.
     */
    function panelDeudas(deu, cliente) {
        if (!deu || !(deu.resumen.deuda_total > 0)) return null;
        const r = deu.resumen;
        return el("section", { class: "alert alert-warning", "aria-labelledby": "tituloDeudas" },
            el("h3", { class: "h6", id: "tituloDeudas" }, `${cliente} tiene deudas: ${formato.dinero(r.deuda_total)}`),
            el("p", { class: "small mb-2" },
                [`${r.cuentas_pendientes} cuenta${r.cuentas_pendientes === 1 ? "" : "s"} por cobrar`,
                    r.saldo_avances ? `avances ${formato.dinero(r.saldo_avances)}` : null,
                    r.saldo_credito ? `créditos ${formato.dinero(r.saldo_credito)}` : null,
                    r.deuda_vencida ? `vencido ${formato.dinero(r.deuda_vencida)}` : null].filter(Boolean).join(" · ")),
            deu.cuentas.map((c) => el("details", { class: "mb-1" },
                el("summary", {}, `${c.tipo === "AVANCE" ? "Avance de dinero" : "Venta a crédito"}: ${c.concepto} — saldo ${formato.dinero(c.saldo)}`),
                el("dl", { class: "row small mb-1 mt-1" },
                    [["Pedido", el("a", { href: `#/ventas/${c.id_pedido}` }, `#${c.id_pedido}`)], ["Fecha", formato.fecha(c.fecha)], ["Motivo", formato.texto(c.motivo)],
                        ["Monto", formato.dinero(c.monto)], ["Abonado", formato.dinero(c.abonado)], ["Saldo", formato.dinero(c.saldo)]]
                        .map(([k, v]) => [el("dt", { class: "col-5 col-sm-3" }, k), el("dd", { class: "col-7 col-sm-9 mb-0" }, v)])))),
            sesion.puede("PAGO_REGISTRAR")
                ? el("p", { class: "small mt-2 mb-0" }, el("a", { href: "#/ventas/cobros" }, "Registrar un abono a la deuda en Cuentas por cobrar"))
                : null);
    }

    const pagar = async (p, saldo) =>
        dialogoFormulario({
            extra: panelDeudas(await VentaModelo.deudas(p.id_cliente).catch(() => null), p.cliente),
            titulo: `Registrar pago del pedido #${p.id_pedido}`,
            ayuda: `Saldo pendiente: ${formato.dinero(saldo)}.`,
            textoEnviar: "Registrar pago",
            campos: [
                { nombre: "idMetodoPago", etiqueta: "Método de pago", tipo: "seleccion", requerido: true, opciones: metodos },
                { nombre: "monto", etiqueta: "Monto (USD)", tipo: "dinero", requerido: true },
                { nombre: "referencia", etiqueta: "Referencia", tipo: "texto", patron: "texto", max: 60, ayuda: "N.º de transferencia o voucher (opcional)" },
            ],
            // en mostrador casi siempre es efectivo: viene elegido (se puede cambiar)
            valores: { monto: saldo, idMetodoPago: metodos.find((x) => /efectivo/i.test(x.etiqueta))?.valor ?? metodos[0]?.valor },
            alEnviar: async (d) => {
                await VentaModelo.pagar(id, { ...d, idMetodoPago: Number(d.idMetodoPago) });
                await pintar("Pago registrado.");
            },
        });
    /**
     * Comprobante. Flujo de "A nombre de":
     *  - se elige uno de los datos de facturacion del cliente;
     *  - si es la PRIMERA vez que pide factura, "Nuevos datos de facturación"
     *    los crea ahi mismo (cedula/RUC validados) y quedan elegidos;
     *  - "Consumidor final" se crea solo si hace falta (factura sin identificar,
     *    no sirve para credito);
     *  - nota de venta: no necesita datos.
     * A credito: el saldo queda como cuenta por cobrar CREDITO (fn_facturar_a_credito).
     */
    const facturar = async (p, credito) => {
        const resumen = resumenErrores();
        let datos = p.datosFacturacion;
        const zonaNombre = el("div");
        const zonaNuevo = el("div", { hidden: true, class: "border rounded p-3 mb-3" });
        const idGrupo = nuevoId("anombre");
        let elegido = (datos.find((x) => x.idTipoIdentificacion !== "07") ?? datos[0])?.id ?? null;

        function pintarNombres() {
            const opciones = datos.filter((x) => !credito || x.idTipoIdentificacion !== "07");
            montar(zonaNombre, el("fieldset", { class: "mb-2" },
                el("legend", { class: "form-label fs-6 fw-semibold" }, "A nombre de"),
                opciones.length ? null : el("p", { class: "small mb-1" }, "Es la primera vez que este cliente pide factura: crea sus datos."),
                opciones.map((x) => {
                    const id = `${idGrupo}-${x.id}`;
                    return el("div", { class: "form-check" },
                        el("input", { class: "form-check-input", type: "radio", name: "aNombre", id, value: x.id, checked: x.id === elegido, onchange: () => { elegido = x.id; } }),
                        el("label", { class: "form-check-label", for: id }, x.etiqueta));
                }),
                el("div", { class: "d-flex flex-wrap gap-2 mt-2" },
                    el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-expanded": "false", "aria-controls": zonaNuevo.id = nuevoId("nuevo-df"),
                        onclick: (e) => { zonaNuevo.hidden = !zonaNuevo.hidden; e.currentTarget.setAttribute("aria-expanded", String(!zonaNuevo.hidden)); if (!zonaNuevo.hidden) zonaNuevo.querySelector("select, input")?.focus(); } },
                        "Nuevos datos de facturación"),
                    !credito && !datos.some((x) => x.idTipoIdentificacion === "07")
                        ? el("button", { type: "button", class: "btn btn-sm btn-outline-secondary", onclick: async () => {
                              const r = await VentaModelo.agregarFacturacion(p.id_cliente, { consumidorFinal: true });
                              datos = r.cliente.facturacion;
                              elegido = r.idDatosFacturacion;
                              pintarNombres();
                              anunciar("Consumidor final agregado y elegido");
                          } }, "Consumidor final")
                        : null)));
        }

        const tipo = campo({ nombre: "tipo", etiqueta: "Tipo de comprobante", tipo: "opciones", requerido: true,
            opciones: credito ? [{ valor: "01", etiqueta: "Factura" }] : [{ valor: "01", etiqueta: "Factura" }, { valor: "02", etiqueta: "Nota de venta" }], valor: "01" });
        const punto = campo({ nombre: "idPuntoEmision", etiqueta: "Punto de emisión", tipo: "seleccion", requerido: true, opciones: puntos, valor: puntos[0]?.valor });
        const plazo = credito ? campo({ nombre: "plazoDias", etiqueta: "Plazo del crédito (días)", tipo: "entero", requerido: true, valor: 30, ayuda: "El saldo queda como cuenta por cobrar" }) : null;
        let d;
        const form = el("form", { novalidate: true }, resumen,
            credito ? el("p", {}, `Se factura todo y el saldo de ${formato.dinero(Math.round((p.total - p.cubierto) * 100) / 100)} queda como crédito del cliente.`) : null,
            tipo, zonaNombre, punto, plazo,
            el("div", { class: "d-flex flex-wrap gap-2 mt-2" },
                el("button", { type: "submit", class: "btn btn-primary" }, credito ? "Facturar a crédito" : "Emitir"),
                el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => d.cerrar() }, "Cancelar")));

        // datos de facturacion nuevos, en el mismo dialogo
        const ficha = await VentaModelo.cliente(p.id_cliente).catch(() => ({ direcciones: [] }));
        zonaNuevo.append(el("p", { class: "fw-semibold" }, "Nuevos datos de facturación"),
            formularioFacturacion({
                nombreSugerido: p.cliente,
                direcciones: ficha.direcciones ?? [],
                alGuardar: async (nuevos) => {
                    const r = await VentaModelo.agregarFacturacion(p.id_cliente, nuevos);
                    datos = r.cliente.facturacion;
                    elegido = r.idDatosFacturacion;
                    zonaNuevo.hidden = true;
                    pintarNombres();
                    anunciar("Datos de facturación guardados y elegidos");
                    form.querySelector(`input[name=aNombre][value="${elegido}"]`)?.focus();
                },
            }));
        pintarNombres();

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const errores = [];
            const t = form.elements.namedItem("tipo").value;
            if ((t === "01" || credito) && !elegido) errores.push({ control: zonaNombre.querySelector("button"), mensaje: "La factura necesita a nombre de quién: elige o crea los datos de facturación." });
            if (credito) {
                const c = form.elements.namedItem("plazoDias");
                const m = /^\d{1,3}$/.test(c.value) && Number(c.value) >= 1 && Number(c.value) <= 180 ? null : "Plazo: de 1 a 180 días.";
                marcarCampo(c, m);
                if (m) errores.push({ control: c, mensaje: m });
            }
            if (errores.length) return mostrarResumen(resumen, errores);
            mostrarResumen(resumen, []);
            try {
                await VentaModelo.facturar(id, {
                    tipo: t,
                    idPuntoEmision: Number(form.elements.namedItem("idPuntoEmision").value),
                    ...(elegido && (t === "01" || form.querySelector("input[name=aNombre]:checked")) ? { idDatosFacturacion: Number(elegido) } : {}),
                    ...(credito ? { plazoDias: Number(form.elements.namedItem("plazoDias").value) } : {}),
                });
                d.cerrar();
                await pintar(credito ? "Factura a crédito emitida: el saldo quedó en cuentas por cobrar." : "Comprobante emitido: el stock se descontó de los lotes.");
            } catch (error) {
                aplicarErroresApi(form, resumen, error);
            }
        });
        // los datos de facturacion nuevos son su PROPIO formulario: van fuera del de emitir (no se anidan forms)
        d = dialogo({ titulo: `${credito ? "Factura a crédito" : "Comprobante"} del pedido #${p.id_pedido}`, contenido: [form, zonaNuevo], grande: true });
        d.abrir();
    };

    /**
     * Avance de dinero: el cliente pide efectivo (pasaje, comprar en otro
     * local). No es venta ni toca inventario: queda como cuenta por cobrar
     * AVANCE del pedido, con plazo, y se paga con abonos.
     */
    const avance = (p) =>
        dialogoFormulario({
            titulo: `Avance de dinero a ${p.cliente}`,
            ayuda: "El dinero que se le entrega al cliente queda como deuda suya (cuenta por cobrar tipo avance) y aparece al cobrarle sus próximas compras. No se factura ni toca el inventario.",
            textoEnviar: "Registrar avance",
            campos: [
                { nombre: "monto", etiqueta: "Monto entregado (USD)", tipo: "dinero", requerido: true },
                { nombre: "concepto", etiqueta: "Concepto", tipo: "texto", patron: "texto", max: 150, requerido: true, ayuda: "Ej. Pasaje de regreso a Ambato" },
                { nombre: "idMotivoAvance", etiqueta: "Motivo", tipo: "seleccion", opciones: motivos },
                { nombre: "idMetodoPago", etiqueta: "Cómo se entregó", tipo: "seleccion", requerido: true, opciones: metodos },
            ],
            valores: { idMetodoPago: metodos.find((x) => /efectivo/i.test(x.etiqueta))?.valor ?? metodos[0]?.valor },
            alEnviar: async (dd) => {
                await VentaModelo.registrarAvance(id, {
                    monto: dd.monto,
                    concepto: dd.concepto,
                    idMetodoPago: Number(dd.idMetodoPago),
                    ...(dd.idMotivoAvance ? { idMotivoAvance: Number(dd.idMotivoAvance) } : {}),
                    // no se pacta un plazo: la base exige una fecha de referencia y se
                    // usan 30 dias (solo sirve para ver cuanto tiempo lleva la deuda)
                    plazoDias: 30,
                });
                await pintar(`Avance de ${formato.dinero(dd.monto)} registrado como cuenta por cobrar.`);
            },
        });
    await pintar(sessionStorage.getItem("ce_admin_mensaje"));
    sessionStorage.removeItem("ce_admin_mensaje");
}

// ------------------------------------------------------------------ Venta de mostrador
// (en su propio modulo: cliente primero, entrega, productos)
export { nueva } from "./venta-nueva.controller.js";

// ------------------------------------------------------------------ Cuentas por cobrar
export async function cobros() {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando cuentas por cobrar…"));
    const [clientes, metodos] = await Promise.all([RecursoModelo.opciones("clientes"), RecursoModelo.opciones("metodos-pago")]);
    async function pintar(mensaje) {
        let filas = [];
        try {
            filas = await VentaModelo.cuentasPorCobrar();
        } catch (error) {
            alertas.error(error);
        }
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: "Cuentas por cobrar",
                descripcion: "Ventas a crédito y avances con saldo. Un abono se aplica primero a lo que vence antes.",
                acciones: sesion.puede("PAGO_REGISTRAR") ? [el("button", { type: "button", class: "btn btn-primary", onclick: abonar }, "Registrar abono")] : [],
            }),
            alertas.nodo,
            tabla({
                titulo: "Cuentas por cobrar con saldo",
                filas,
                vacio: "No hay cuentas por cobrar con saldo.",
                columnas: [
                    { titulo: "Cliente", valor: (c) => c.cliente, clave: "cliente" },
                    { titulo: "Concepto", valor: (c) => formato.texto(c.concepto ?? c.tipo) },
                    { titulo: "Vence", valor: (c) => formato.fecha(c.vencimiento), clave: "vencimiento" },
                    { titulo: "Monto", numerica: true, valor: (c) => formato.dinero(c.monto), clave: "monto" },
                    { titulo: "Saldo", numerica: true, valor: (c) => formato.dinero(c.saldo), clave: "saldo" },
                    { titulo: "Estado", valor: (c) => (c.dias_vencida > 0 ? insignia(`Vencida ${c.dias_vencida} días`, "danger") : insignia("Al día", "success")) },
                ],
            })));
        if (mensaje) alertas.exito(mensaje);
    }
    const abonar = () =>
        dialogoFormulario({
            titulo: "Registrar abono",
            textoEnviar: "Registrar abono",
            campos: [
                { nombre: "idCliente", etiqueta: "Cliente", tipo: "seleccion", requerido: true, opciones: clientes },
                { nombre: "monto", etiqueta: "Monto (USD)", tipo: "dinero", requerido: true },
                { nombre: "idMetodoPago", etiqueta: "Método de pago", tipo: "seleccion", requerido: true, opciones: metodos },
                { nombre: "referencia", etiqueta: "Referencia", tipo: "texto", patron: "texto", max: 60 },
            ],
            alEnviar: async (d) => {
                await VentaModelo.abonar({ ...d, idCliente: Number(d.idCliente), idMetodoPago: Number(d.idMetodoPago) });
                await pintar("Abono registrado.");
            },
        });
    await pintar();
}
