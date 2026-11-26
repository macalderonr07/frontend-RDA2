// js/controllers/cotizaciones.controller.js
// Cotizaciones de la tienda en linea (ventas por confirmar): no reservan stock.
// El personal las revisa, ajusta cantidades o productos y las CONFIRMA como
// pedido (ahi se valida y reserva el stock) o las descarta. Vencen a los 14
// dias: la base elimina las que nadie confirmo.
import { anunciar, el, formato, montar, nuevoId } from "../core/dom.js";
import { navegar } from "../core/router.js";
import { sesion } from "../core/sesion.js";
import { CotizacionModelo, VentaModelo } from "../models/negocio.model.js";
import { alerta, cargando, confirmar, dialogo, encabezado, insignia, paginacion, tabla, zonaAlertas } from "../views/componentes.js";

const contenido = () => document.getElementById("contenido");
const estado = { page: 1, q: "", estado: "PENDIENTE" };

/** "vence en 3 días" / "vence hoy" / "vencida" */
function vencimiento(vence) {
    const dias = Math.ceil((new Date(vence) - Date.now()) / 86400000);
    if (dias < 0) return insignia("Vencida", "danger");
    if (dias === 0) return insignia("Vence hoy", "danger");
    return insignia(`Vence en ${dias} ${dias === 1 ? "día" : "días"}`, dias <= 3 ? "warning" : "secondary");
}

export async function lista() {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando cotizaciones…"));
    const idQ = nuevoId("q");
    const idEstado = nuevoId("estado");
    async function pintar() {
        let datos = { data: [], meta: null };
        try {
            datos = await CotizacionModelo.listar({ page: estado.page, limit: 20, q: estado.q, estado: estado.estado });
        } catch (error) {
            alertas.error(error, "No se pudieron cargar las cotizaciones");
        }
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: "Cotizaciones",
                descripcion: "Lo que los clientes envían desde la tienda en línea. No reservan stock: revísalas, ajústalas y confírmalas como pedido. Si nadie las confirma, vencen a los 14 días.",
            }),
            alertas.nodo,
            el("form", {
                role: "search", "aria-label": "Buscar cotizaciones", class: "barra-lista",
                onsubmit: (e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    Object.assign(estado, { q: String(d.get("q")).trim(), estado: d.get("estado"), page: 1 });
                    pintar().then(() => anunciar(`${document.querySelectorAll(".tabla-admin tbody tr").length} cotizaciones`));
                },
            },
                el("div", {}, el("label", { class: "form-label", for: idQ }, "Cliente o número"), el("input", { id: idQ, name: "q", type: "search", class: "form-control", value: estado.q, placeholder: "Ej. COT-000012" })),
                el("div", {}, el("label", { class: "form-label", for: idEstado }, "Mostrar"),
                    el("select", { id: idEstado, name: "estado", class: "form-select" },
                        el("option", { value: "PENDIENTE", selected: estado.estado === "PENDIENTE" }, "Por confirmar"),
                        el("option", { value: "CONFIRMADA", selected: estado.estado === "CONFIRMADA" }, "Confirmadas (ya son pedidos)"))),
                el("div", {}, el("button", { type: "submit", class: "btn btn-outline-primary w-100" }, "Aplicar"))),
            tabla({
                titulo: estado.estado === "PENDIENTE" ? "Cotizaciones por confirmar" : "Cotizaciones confirmadas",
                filas: datos.data,
                vacio: estado.estado === "PENDIENTE" ? "No hay cotizaciones por confirmar." : "Sin cotizaciones confirmadas.",
                columnas: [
                    { titulo: "Número", valor: (c) => el("a", { href: `#/ventas/cotizaciones/${c.id}` }, c.numero), clave: "id" },
                    { titulo: "Cliente", valor: (c) => c.cliente, clave: "cliente" },
                    { titulo: "Recibida", valor: (c) => formato.fecha(c.fecha), clave: "fecha" },
                    { titulo: "Productos", numerica: true, valor: (c) => c.lineas, clave: "lineas" },
                    { titulo: "Total estimado", numerica: true, valor: (c) => formato.dinero(c.total_estimado ?? 0), clave: "total_estimado" },
                    { titulo: "Estado", valor: (c) => (c.estado === "PENDIENTE" ? vencimiento(c.vence) : el("a", { href: `#/ventas/${c.id_pedido}` }, `Pedido #${c.id_pedido}`)) },
                ],
            }),
            paginacion(datos.meta, (pagina) => {
                estado.page = pagina;
                pintar();
            })));
    }
    await pintar();
}

export async function ficha({ id }) {
    const alertas = zonaAlertas();
    const puede = sesion.puede("VENTA_REGISTRAR");
    montar(contenido(), cargando("Cargando la cotización…"));
    let cot;
    try {
        cot = await CotizacionModelo.obtener(id);
    } catch (error) {
        montar(contenido(), alerta("danger", error.message), el("p", {}, el("a", { href: "#/ventas/cotizaciones" }, "Volver a las cotizaciones")));
        return;
    }

    const ejecutar = async (fn, mensaje) => {
        try {
            cot = await fn();
            pintar(mensaje);
        } catch (error) {
            alertas.error(error);
        }
    };

    function campoCantidad(l) {
        const idc = nuevoId("cant");
        const entero = Number.isInteger(Number(l.incremento));
        const input = el("input", {
            id: idc, type: "number", class: "form-control form-control-sm", value: l.cantidad, min: l.cantidad_minima ?? 0, step: l.incremento ?? 1,
            inputmode: entero ? "numeric" : "decimal", style: "max-width: 7rem", disabled: !cot.editable || !puede,
        });
        input.addEventListener("change", () => {
            const n = Number(input.value);
            if (!(n > 0)) return alertas.error(new Error(`${l.prd_nombre}: la cantidad debe ser mayor que 0.`));
            ejecutar(() => CotizacionModelo.cambiarCantidad(cot.id, l.id_cotizacion_linea, n), `Cantidad de ${l.prd_nombre} actualizada.`);
        });
        return [el("label", { class: "visually-hidden", for: idc }, `Cantidad de ${l.prd_nombre} ${l.presentacion}`), input];
    }

    function agregarProducto() {
        const idBusca = nuevoId("busca");
        const resultados = el("div", { class: "mt-3" });
        let d;
        const elegir = async (idProducto) => {
            const p = await VentaModelo.producto(idProducto);
            const formas = p.variantes.flatMap((v) => v.formas.map((f) => ({ ...f, etiqueta: `${v.sku}${v.caracteristicas && Object.keys(v.caracteristicas).length ? ` (${Object.values(v.caracteristicas).join(", ")})` : ""} — ${f.descripcion} · ${formato.dinero(f.precio)} · disponible ${formato.numero(f.disponible)}` })));
            const idForma = nuevoId("forma");
            const idCant = nuevoId("cant");
            const select = el("select", { id: idForma, class: "form-select" }, formas.map((f) => el("option", { value: f.idPresentacion }, f.etiqueta)));
            const cantidad = el("input", { id: idCant, type: "number", class: "form-control", min: formas[0]?.cantidadMinima ?? 1, step: formas[0]?.incremento ?? 1, value: formas[0]?.cantidadMinima ?? 1 });
            select.addEventListener("change", () => {
                const f = formas.find((x) => String(x.idPresentacion) === select.value);
                Object.assign(cantidad, { step: f.incremento, min: f.cantidadMinima, value: f.cantidadMinima });
            });
            const error = el("p", { class: "text-danger small", role: "alert" });
            montar(resultados,
                el("h3", { class: "h6" }, p.nombre ?? "Producto"),
                el("div", { class: "mb-2" }, el("label", { class: "form-label", for: idForma }, "Forma de venta"), select),
                el("div", { class: "mb-2" }, el("label", { class: "form-label", for: idCant }, "Cantidad"), cantidad),
                error,
                el("button", {
                    type: "button", class: "btn btn-primary",
                    onclick: async () => {
                        if (!(Number(cantidad.value) > 0)) {
                            error.textContent = "Escribe una cantidad mayor que 0.";
                            return cantidad.focus();
                        }
                        try {
                            cot = await CotizacionModelo.agregarLinea(cot.id, { idPresentacion: Number(select.value), cantidad: Number(cantidad.value) });
                            d.cerrar();
                            pintar("Producto agregado a la cotización.");
                        } catch (e) {
                            error.textContent = e.message;
                        }
                    },
                }, "Agregar a la cotización"));
            select.focus();
        };
        const buscar = el("form", {
            role: "search", "aria-label": "Buscar productos para la cotización", class: "d-flex flex-wrap gap-2 align-items-end",
            onsubmit: async (e) => {
                e.preventDefault();
                const q = new FormData(e.currentTarget).get("q").trim();
                const encontrados = await VentaModelo.productos(q).catch(() => []);
                montar(resultados, encontrados.length
                    ? el("ul", { class: "list-group", "aria-label": `Productos encontrados: ${encontrados.length}` }, encontrados.map((x) =>
                          el("li", { class: "list-group-item d-flex justify-content-between align-items-center gap-2" },
                              el("span", {}, el("span", { class: "fw-semibold" }, x.prd_nombre), el("span", { class: "d-block small text-body-secondary" }, x.prd_codigo)),
                              el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-label": `Elegir ${x.prd_nombre}`, onclick: () => elegir(x.id_producto) }, "Elegir"))))
                    : el("p", { role: "status" }, "Sin resultados."));
            },
        },
            el("div", { class: "flex-grow-1" }, el("label", { class: "form-label", for: idBusca }, "Producto"), el("input", { id: idBusca, name: "q", type: "search", class: "form-control", placeholder: "Nombre o código" })),
            el("button", { type: "submit", class: "btn btn-outline-primary" }, "Buscar"));
        d = dialogo({ titulo: `Agregar producto a ${cot.numero}`, contenido: [buscar, resultados] });
        d.abrir();
    }

    async function confirmarCotizacion() {
        const faltan = cot.lineas.filter((l) => l.falta);
        const aviso = faltan.length ? ` Ojo: hoy no alcanza el stock de ${faltan.map((l) => l.prd_nombre).join(", ")}.` : "";
        if (!(await confirmar({ titulo: "Confirmar como pedido", mensaje: `Se crea el pedido con estos productos y se reserva el stock.${aviso} ¿Continuar?`, textoConfirmar: "Confirmar pedido" }))) return;
        try {
            const { idPedido } = await CotizacionModelo.confirmar(cot.id);
            sessionStorage.setItem("ce_admin_mensaje", `${cot.numero} confirmada: es el pedido #${idPedido}.`);
            navegar(`/ventas/${idPedido}`);
        } catch (error) {
            alertas.error(error);
        }
    }

    async function descartar() {
        if (!(await confirmar({ titulo: "Descartar cotización", mensaje: `${cot.numero} se elimina (el cliente ya no la quiere). No se puede deshacer. ¿Continuar?`, textoConfirmar: "Descartar", peligro: true }))) return;
        try {
            await CotizacionModelo.descartar(cot.id);
            sessionStorage.setItem("ce_admin_mensaje", `${cot.numero} descartada.`);
            navegar("/ventas/cotizaciones");
        } catch (error) {
            alertas.error(error);
        }
    }

    function pintar(mensaje) {
        const editable = cot.editable && puede;
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: `Cotización ${cot.numero}`,
                descripcion: `${cot.cliente} · recibida el ${formato.fecha(cot.fecha)} · ${cot.canal === "WEB" ? "tienda en línea" : cot.canal}`,
                miga: [{ texto: "Cotizaciones", href: "#/ventas/cotizaciones" }, { texto: cot.numero }],
                acciones: editable
                    ? [el("button", { type: "button", class: "btn btn-primary", onclick: confirmarCotizacion }, "Confirmar como pedido"),
                       el("button", { type: "button", class: "btn btn-outline-danger", onclick: descartar }, "Descartar")]
                    : [],
            }),
            alertas.nodo,
            el("p", {}, cot.editable ? vencimiento(cot.vence) : [insignia("Confirmada", "success"), " ", el("a", { href: `#/ventas/${cot.id_pedido}` }, `Ver el pedido #${cot.id_pedido}`)]),
            el("dl", { class: "row small" },
                el("dt", { class: "col-sm-2" }, "Contacto"), el("dd", { class: "col-sm-10" }, [cot.correo, cot.telefono].filter(Boolean).join(" · ") || "—"),
                cot.observacion ? [el("dt", { class: "col-sm-2" }, "Mensaje"), el("dd", { class: "col-sm-10" }, cot.observacion)] : null),
            tabla({
                titulo: "Productos de la cotización",
                filas: cot.lineas,
                columnas: [
                    { titulo: "Producto", valor: (l) => [el("span", { class: "fw-semibold" }, l.prd_nombre), el("span", { class: "d-block small text-body-secondary" }, `${l.var_sku} · ${l.presentacion}${l.pieza ? ` · pieza ${l.pieza}` : ""}`)] },
                    { titulo: "Cantidad", valor: (l) => campoCantidad(l) },
                    { titulo: "Precio actual", numerica: true, valor: (l) => (l.precio != null ? formato.dinero(l.precio) : "Ya no se vende") },
                    { titulo: "Subtotal", numerica: true, valor: (l) => (l.subtotal != null ? formato.dinero(l.subtotal) : "—") },
                    { titulo: "Disponible hoy", numerica: true, valor: (l) => [formato.numero(l.disponible ?? 0), l.falta ? [" ", insignia("No alcanza", "warning")] : null] },
                    ...(editable ? [{ titulo: "Acción", valor: (l) => el("button", { type: "button", class: "btn btn-sm btn-outline-danger", "aria-label": `Quitar ${l.prd_nombre}`, onclick: () => ejecutar(() => CotizacionModelo.quitarLinea(cot.id, l.id_cotizacion_linea), `${l.prd_nombre} quitado.`) }, "Quitar") }] : []),
                ],
            }),
            el("p", { class: "fs-5" }, "Total estimado (IVA incluido): ", el("strong", {}, formato.dinero(cot.totalEstimado)),
                el("span", { class: "d-block small text-body-secondary" }, "Con los precios de hoy. Al confirmar, el pedido se calcula con los precios y ofertas vigentes.")),
            editable ? el("button", { type: "button", class: "btn btn-outline-primary", onclick: agregarProducto }, "Agregar producto") : null));
        if (mensaje) {
            alertas.exito(mensaje);
            anunciar(mensaje);
        }
    }
    pintar(sessionStorage.getItem("ce_admin_mensaje"));
    sessionStorage.removeItem("ce_admin_mensaje");
}
