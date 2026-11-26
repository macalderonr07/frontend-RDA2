// js/controllers/venta-nueva.controller.js
// CONTROLADOR de la venta de mostrador, en el orden en que se atiende:
//  1. CLIENTE: se busca por nombre, cedula, RUC o telefono; si no esta, se
//     crea ahi mismo (con o sin datos de facturacion) y queda elegido.
//  2. ENTREGA: retira en el local (la direccion es opcional) o pedido a
//     domicilio (la direccion de entrega es obligatoria; se elige o se crea).
//  3. PRODUCTOS: se busca el producto y se especifica en un dialogo (varias
//     bandas, varias tallas o varios cortes en un solo ingreso).
//  4. REGISTRAR: la base aplica precio, oferta, volumen y reserva el stock.
import { anunciar, el, formato, montar, nuevoId } from "../core/dom.js";
import { navegar } from "../core/router.js";
import { sesion } from "../core/sesion.js";
import { aplicarErroresApi, marcarCampo, mostrarResumen, validarValor } from "../core/validacion.js";
import { VentaModelo } from "../models/negocio.model.js";
import { RecursoModelo } from "../models/recurso.model.js";
import { alerta, campo, cargando, dialogo, encabezado, notaObligatorios, resumenErrores, envolverOrdenable } from "../views/componentes.js";
import { dialogoProducto, formularioCliente, formularioDireccion, usarSectores } from "../views/venta.view.js";

const contenido = () => document.getElementById("contenido");

export async function nueva() {
    if (!sesion.puede("VENTA_REGISTRAR")) {
        montar(contenido(), encabezado({ titulo: "Nueva venta" }), alerta("warning", "No tienes permiso para registrar ventas."));
        return;
    }
    if (!sesion.usuario.esEmpleado) {
        montar(contenido(), encabezado({ titulo: "Nueva venta" }), alerta("warning", "Para registrar ventas tu usuario necesita su ficha de empleado (Talento humano › Empleados)."));
        return;
    }
    montar(contenido(), cargando());
    const ciudades = await RecursoModelo.opciones("ciudades");
    usarSectores(VentaModelo.sectores);

    let cliente = null; // ficha de /ventas/clientes
    let entrega = "local"; // local | domicilio
    const lineas = []; // { pres, cantidad, idLote, detalle }
    const resumen = resumenErrores();

    // ------------------------------------------------ 1. Cliente
    const zonaCliente = el("div");
    const resultadosCliente = el("div", { class: "mt-2", "aria-live": "polite" });
    const idBuscaCli = nuevoId("busca-cliente");

    function abrirAlta(sugerido = "") {
        let d;
        const form = formularioCliente({
            ciudades,
            sugerido,
            requiereDireccion: entrega === "domicilio",
            alGuardar: async (datos) => {
                const ficha = await VentaModelo.crearCliente(datos);
                d.cerrar();
                elegirCliente(ficha);
                anunciar(`Cliente ${ficha.nombre} creado y elegido`);
            },
        });
        d = dialogo({ titulo: "Cliente nuevo", contenido: form, grande: true });
        d.abrir();
    }

    const buscarCliente = el("form", { role: "search", "aria-label": "Buscar cliente", class: "d-flex flex-wrap gap-2 align-items-end",
        onsubmit: async (e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q").trim();
            if (q.length < 2) {
                montar(resultadosCliente, el("p", { class: "text-danger-emphasis mb-0", role: "status" }, "Escribe al menos 2 letras o números."));
                return;
            }
            try {
                const encontrados = await VentaModelo.clientes(q);
                montar(resultadosCliente, encontrados.length
                    ? el("ul", { class: "list-group", "aria-label": `Clientes encontrados: ${encontrados.length}` }, encontrados.map((c) =>
                          el("li", { class: "list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2" },
                              el("span", {}, el("span", { class: "fw-semibold" }, c.nombre),
                                  el("span", { class: "d-block small text-body-secondary" },
                                      [c.facturacion.filter((f) => f.idTipoIdentificacion !== "07").map((f) => f.identificacion).join(", ") || "Sin cédula ni RUC",
                                          c.telefonos[0], c.correo].filter(Boolean).join(" · "))),
                              el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-label": `Elegir a ${c.nombre}`, onclick: () => elegirCliente(c) }, "Elegir"))))
                    : el("div", { class: "alert alert-light border mb-0", role: "status" },
                          el("p", { class: "mb-2" }, `No encontramos a «${q}».`),
                          el("button", { type: "button", class: "btn btn-primary", onclick: () => abrirAlta(q) }, "Crear este cliente")));
            } catch (error) {
                montar(resultadosCliente, alerta("danger", error.message));
            }
        } },
        el("div", { class: "flex-grow-1" }, el("label", { class: "form-label", for: idBuscaCli }, "Buscar cliente"),
            el("input", { id: idBuscaCli, name: "q", type: "search", class: "form-control", placeholder: "Nombre, cédula, RUC o teléfono", autocomplete: "off",
                "aria-describedby": `${idBuscaCli}-error`, dataset: { error: `${idBuscaCli}-error` } }),
            el("div", { id: `${idBuscaCli}-error`, class: "invalid-feedback", "aria-live": "polite" })),
        el("button", { type: "submit", class: "btn btn-outline-primary" }, "Buscar"),
        el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => abrirAlta(document.getElementById(idBuscaCli).value) }, "Cliente nuevo"));

    function elegirCliente(c) {
        cliente = c;
        const buscaCli = document.getElementById(idBuscaCli);
        if (buscaCli) marcarCampo(buscaCli, null);
        pintarCliente();
        pintarEntrega();
        contenidoProductos.hidden = false;
        avisoProductos.hidden = true;
        document.getElementById("tituloCliente")?.focus();
    }

    function pintarCliente() {
        if (!cliente) {
            montar(zonaCliente, buscarCliente, resultadosCliente);
            return;
        }
        const ids = cliente.facturacion.filter((f) => f.idTipoIdentificacion !== "07").map((f) => `${f.razonSocial} (${f.identificacion})`);
        montar(zonaCliente, el("div", { class: "d-flex flex-wrap justify-content-between align-items-start gap-2" },
            el("div", {},
                el("p", { class: "fs-5 fw-semibold mb-1" }, cliente.nombre),
                el("p", { class: "small mb-0" }, ids.length ? `Factura a nombre de: ${ids.join("; ")}` : "Sin datos de facturación todavía (se crean al emitir la factura)."),
                cliente.telefonos.length ? el("p", { class: "small mb-0" }, `Teléfono: ${cliente.telefonos.join(", ")}`) : null),
            el("button", { type: "button", class: "btn btn-sm btn-outline-secondary", onclick: () => { cliente = null; pintarCliente(); pintarEntrega(); document.getElementById(idBuscaCli)?.focus(); } }, "Cambiar cliente")));
    }

    // ------------------------------------------------ 2. Entrega
    const zonaEntrega = el("div");
    function pintarEntrega() {
        const nombre = nuevoId("entrega");
        const radios = el("fieldset", { class: "mb-2" }, el("legend", { class: "form-label fs-6 fw-semibold" }, "Entrega"),
            [["local", "Retira en el local"], ["domicilio", "Pedido a domicilio (envío)"]].map(([v, t]) => {
                const id = `${nombre}-${v}`;
                return el("div", { class: "form-check form-check-inline" },
                    el("input", { class: "form-check-input", type: "radio", name: "entrega", id, value: v, checked: entrega === v,
                        onchange: () => { entrega = v; pintarEntrega(); } }),
                    el("label", { class: "form-check-label", for: id }, t));
            }));
        if (entrega === "local" || !cliente) {
            montar(zonaEntrega, radios, entrega === "domicilio" && !cliente ? el("p", { class: "small" }, "Elige primero el cliente para escoger su dirección.") : null);
            return;
        }
        const opciones = cliente.direcciones.map((x) => ({ valor: x.id, etiqueta: x.etiqueta }));
        montar(zonaEntrega, radios,
            el("div", { class: "grilla-form" },
                campo({ nombre: "idDireccion", etiqueta: "Dirección de entrega", tipo: "seleccion", requerido: true, opciones, valor: opciones[0]?.valor,
                    ayuda: opciones.length ? null : "El cliente no tiene direcciones: agrega una." }),
                campo({ nombre: "costoEnvio", etiqueta: "Costo del envío (USD)", tipo: "dinero", ayuda: "Vacío = sin costo" })),
            el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick: () => {
                let d;
                const f = formularioDireccion({ ciudades, alGuardar: async (datos) => {
                    const r = await VentaModelo.agregarDireccion(cliente.idCliente, datos);
                    cliente = r.cliente;
                    d.cerrar();
                    pintarEntrega();
                    zonaEntrega.querySelector("[name=idDireccion]").value = String(r.idDireccion);
                    anunciar("Dirección agregada y elegida");
                } });
                d = dialogo({ titulo: `Dirección de ${cliente.nombre}`, contenido: f, grande: true });
                d.abrir();
            } }, "Agregar dirección"));
    }

    // ------------------------------------------------ 3. Productos
    const cuerpoLineas = el("tbody");
    const total = el("p", { class: "fs-5 fw-bold", role: "status", "aria-live": "polite" });
    const resultados = el("div", { class: "mt-2", "aria-live": "polite" });
    function pintarLineas() {
        montar(cuerpoLineas, ...lineas.map((l, i) => {
            const id = nuevoId("cant");
            const idError = `${id}-error`;
            const entero = Number.isInteger(l.pres.incremento);
            const input = el("input", { id, type: "number", class: "form-control", min: l.pres.cantidad_minima, max: l.pres.disponible, step: l.pres.incremento,
                inputmode: entero ? "numeric" : "decimal", value: l.cantidad, "aria-describedby": idError, dataset: { error: idError },
                readonly: Boolean(l.idLote) || null, oninput: (e) => { l.cantidad = e.target.value; pintarTotal(); } });
            l.control = input;
            return el("tr", {},
                el("th", { scope: "row", class: "fw-normal" }, l.pres.prd_nombre, el("span", { class: "d-block small text-body-secondary" }, [l.detalle, l.pres.presentacion, l.pres.var_sku].filter(Boolean).join(" · "))),
                el("td", { class: "text-end" }, formato.dinero(l.pres.precio_final_con_iva)),
                el("td", {}, el("label", { class: "visually-hidden", for: id }, `Cantidad de ${l.pres.prd_nombre}`), input,
                    el("div", { class: "form-text" }, l.idLote ? "Medida de la banda elegida" : `Mín. ${formato.numero(l.pres.cantidad_minima)} · disp. ${formato.numero(l.pres.disponible)}`),
                    el("div", { id: idError, class: "invalid-feedback", "aria-live": "polite" })),
                el("td", {}, el("button", { type: "button", class: "btn btn-sm btn-outline-danger", "aria-label": `Quitar ${l.pres.prd_nombre} ${l.detalle ?? ""}`, onclick: () => { lineas.splice(i, 1); pintarLineas(); anunciar("Línea quitada"); } }, "Quitar")));
        }));
        pintarTotal();
    }
    function pintarTotal() {
        const t = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * l.pres.precio_final_con_iva, 0);
        total.textContent = lineas.length ? `Total referencial con IVA: ${formato.dinero(t)} (la base aplica descuentos por volumen al registrar)` : "Agrega productos a la venta.";
    }

    async function especificar(idProducto) {
        try {
            const p = await VentaModelo.producto(idProducto);
            dialogoProducto({
                p,
                alAgregar: (nuevas) => {
                    for (const n of nuevas) {
                        const igual = lineas.find((l) => l.pres.id_presentacion === n.forma.idPresentacion && (l.idLote ?? null) === (n.idLote ?? null));
                        if (igual && !n.idLote) {
                            igual.cantidad = Number(igual.cantidad) + n.cantidad;
                            continue;
                        }
                        if (igual) continue; // la misma banda no se agrega dos veces
                        lineas.push({
                            idLote: n.idLote,
                            cantidad: n.cantidad,
                            detalle: n.detalle,
                            pres: {
                                id_presentacion: n.forma.idPresentacion,
                                prd_nombre: p.nombre,
                                var_sku: n.variante.sku,
                                presentacion: n.forma.descripcion,
                                precio_final_con_iva: n.forma.precio,
                                cantidad_minima: n.forma.cantidadMinima,
                                incremento: n.forma.incremento,
                                disponible: n.forma.disponible,
                            },
                        });
                    }
                    pintarLineas();
                },
            }).abrir();
        } catch (error) {
            resultados.prepend(alerta("danger", error.message));
        }
    }

    const idBusca = nuevoId("busca");
    const buscar = el("form", { role: "search", "aria-label": "Buscar productos para la venta", class: "d-flex flex-wrap gap-2 align-items-end",
        onsubmit: async (e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q").trim();
            try {
                const encontrados = await VentaModelo.productos(q);
                montar(resultados, encontrados.length
                    ? el("ul", { class: "list-group", "aria-label": `Productos encontrados: ${encontrados.length}` }, encontrados.map((x) => {
                          const agotado = x.variantes_con_stock === 0;
                          const precio = x.precio_desde === x.precio_hasta ? formato.dinero(x.precio_desde) : `desde ${formato.dinero(x.precio_desde)}`;
                          const detalle = [x.prd_codigo, x.categoria, precio,
                              x.variantes > 1 ? `${x.variantes} variantes (${x.variantes_con_stock} con stock)` : null,
                              x.formas > 1 ? `${x.formas} formas de venta` : null].filter(Boolean).join(" · ");
                          return el("li", { class: "list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2" },
                              el("span", { class: "d-flex align-items-center gap-3" },
                                  x.imagen_url ? el("img", { src: x.imagen_url, alt: "", width: 48, height: 48, class: "rounded object-fit-cover", loading: "lazy" }) : null,
                                  el("span", {}, el("span", { class: "fw-semibold" }, x.prd_nombre), el("span", { class: "d-block small text-body-secondary" }, detalle))),
                              el("button", { type: "button", class: "btn btn-sm btn-outline-primary", disabled: agotado,
                                  "aria-label": agotado ? `${x.prd_nombre}: agotado` : `Elegir ${x.prd_nombre}`, onclick: () => especificar(x.id_producto) }, agotado ? "Agotado" : "Elegir"));
                      }))
                    : el("p", { role: "status" }, "Sin resultados."));
            } catch (error) {
                montar(resultados, alerta("danger", error.message));
            }
        } },
        el("div", { class: "flex-grow-1" }, el("label", { class: "form-label", for: idBusca }, "Buscar producto"),
            el("input", { id: idBusca, name: "q", type: "search", class: "form-control", placeholder: "Nombre, código o categoría",
                "aria-describedby": `${idBusca}-error`, dataset: { error: `${idBusca}-error` } }),
            el("div", { id: `${idBusca}-error`, class: "invalid-feedback", "aria-live": "polite" })),
        el("button", { type: "submit", class: "btn btn-outline-primary" }, "Buscar"));

    // El paso 2 se ve siempre (el usuario sabe cuantos pasos hay y en cual esta),
    // pero su contenido se habilita recien con el cliente elegido.
    const avisoProductos = el("p", { class: "text-body-secondary mb-0" }, "Primero elige o crea el cliente; luego aquí agregas los productos.");
    const contenidoProductos = el("div", { hidden: true },
            buscar, resultados,
            el("div", { class: "mt-3" }, envolverOrdenable(
                el("table", { class: "table align-middle lineas-tabla" },
                    el("caption", { class: "visually-hidden" }, "Productos de la venta"),
                    el("thead", {}, el("tr", {}, ["Producto", "Precio con IVA", "Cantidad", "Acción"].map((t) => el("th", { scope: "col" }, t)))),
                    cuerpoLineas),
                { "aria-label": "Líneas de la venta (desplazable)" })),
            total);
    const seccionProductos = el("section", { class: "card mb-3", "aria-labelledby": "tituloProductos" },
        el("div", { class: "card-body" },
            el("h2", { class: "h5", id: "tituloProductos" }, "2. Productos"),
            avisoProductos, contenidoProductos));

    // ------------------------------------------------ 4. Registrar
    // Tres tarjetas; solo la ultima es el <form> de la venta (los buscadores de
    // cliente y producto son sus propios formularios: no se pueden anidar).
    const tarjetaCliente = el("section", { class: "card mb-3", "aria-labelledby": "tituloCliente" }, el("div", { class: "card-body" },
            el("h2", { class: "h5", id: "tituloCliente", tabindex: "-1" }, "1. Cliente"),
            zonaCliente,
            el("hr"),
            el("div", { class: "grilla-form" },
                campo({ nombre: "canal", etiqueta: "Canal", tipo: "opciones", requerido: true, opciones: [{ valor: "TDA", etiqueta: "Tienda física" }, { valor: "WSP", etiqueta: "WhatsApp / teléfono" }], valor: "TDA" })),
            zonaEntrega));
    const form = el("form", { novalidate: true, class: "card", "aria-labelledby": "tituloRegistrar" }, el("div", { class: "card-body" },
        el("h2", { class: "h5", id: "tituloRegistrar" }, "3. Registrar"),
        resumen, notaObligatorios(),
        campo({ nombre: "observacion", etiqueta: "Observación", tipo: "textoLargo", max: 250 }),
        el("div", { class: "d-flex flex-wrap gap-2" }, el("button", { type: "submit", class: "btn btn-primary" }, "Registrar venta"), el("a", { class: "btn btn-outline-secondary", href: "#/ventas" }, "Cancelar"))));

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errores = [];
        const buscaCli = document.getElementById(idBuscaCli);
        if (buscaCli) marcarCampo(buscaCli, cliente ? null : "Elige o crea el cliente.");
        if (!cliente) errores.push({ control: buscaCli, mensaje: "Elige o crea el cliente." });
        let envio = null;
        if (cliente && entrega === "domicilio") {
            const dir = zonaEntrega.querySelector("[name=idDireccion]");
            const costo = zonaEntrega.querySelector("[name=costoEnvio]");
            const m1 = dir?.value ? null : "Elige o agrega la dirección de entrega (es un pedido a domicilio).";
            const m2 = costo?.value ? validarValor(costo.value, { etiqueta: "Costo del envío", patron: "dinero" }) : null;
            if (dir) marcarCampo(dir, m1);
            if (costo) marcarCampo(costo, m2);
            if (m1) errores.push({ control: dir, mensaje: m1 });
            if (m2) errores.push({ control: costo, mensaje: m2 });
            if (!m1 && !m2) envio = { idDireccion: Number(dir.value), ...(costo.value ? { costo: Number(costo.value) } : {}) };
        }
        const buscaProd = document.getElementById(idBusca);
        if (cliente && buscaProd) marcarCampo(buscaProd, lineas.length ? null : "Agrega al menos un producto.");
        if (cliente && lineas.length === 0) errores.push({ control: buscaProd, mensaje: "Agrega al menos un producto." });
        for (const l of lineas) {
            if (l.idLote) continue; // la medida de la banda ya viene fijada
            let msg = validarValor(String(l.cantidad), { etiqueta: `Cantidad de ${l.pres.prd_nombre}`, requerido: true, patron: "cantidad" });
            const c = Number(l.cantidad);
            if (!msg && c < l.pres.cantidad_minima) msg = `${l.pres.prd_nombre}: la compra mínima es ${l.pres.cantidad_minima}.`;
            if (!msg && Math.abs(c / l.pres.incremento - Math.round(c / l.pres.incremento)) > 1e-9) msg = `${l.pres.prd_nombre}: se vende de ${l.pres.incremento} en ${l.pres.incremento}.`;
            if (!msg && c > l.pres.disponible) msg = `${l.pres.prd_nombre}: solo hay ${l.pres.disponible} disponibles.`;
            if (l.control) marcarCampo(l.control, msg);
            if (msg) errores.push({ control: l.control, mensaje: msg });
        }
        if (errores.length) return mostrarResumen(resumen, errores);
        mostrarResumen(resumen, []);
        try {
            const obs = form.elements.namedItem("observacion").value.trim();
            const v = await VentaModelo.crearPedido({
                idCliente: cliente.idCliente,
                canal: tarjetaCliente.querySelector("[name=canal]").value,
                lineas: lineas.map((l) => ({ idPresentacion: l.pres.id_presentacion, cantidad: Number(l.cantidad), ...(l.idLote ? { idLote: l.idLote } : {}) })),
                ...(envio ? { envio } : {}),
                ...(obs ? { observacion: obs } : {}),
            });
            sessionStorage.setItem("ce_admin_mensaje", `Venta #${v.id_pedido} registrada por ${formato.dinero(v.total)}. Registra el pago y emite el comprobante.`);
            navegar(`/ventas/${v.id_pedido}`);
        } catch (error) {
            aplicarErroresApi(form, resumen, error);
        }
    });

    pintarCliente();
    pintarEntrega();
    pintarLineas();
    montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
        encabezado({ titulo: "Nueva venta en tienda", descripcion: "Primero el cliente, luego los productos. El precio, la oferta y el descuento por volumen los aplica la base al registrar.", miga: [{ texto: "Pedidos", href: "#/ventas" }, { texto: "Nueva venta" }] }),
        tarjetaCliente, seccionProductos, form));
}
