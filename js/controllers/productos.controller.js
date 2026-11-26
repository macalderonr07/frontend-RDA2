// js/controllers/productos.controller.js
// CONTROLADOR de productos, ofertas y combos.
import { anunciar, el, formato, montar } from "../core/dom.js";
import { navegar } from "../core/router.js";
import { sesion } from "../core/sesion.js";
import { aplicarErroresApi } from "../core/validacion.js";
import { ProductoModelo } from "../models/negocio.model.js";
import { RecursoModelo } from "../models/recurso.model.js";
import { ordenServidor, paramsOrden, alerta, cargando, confirmar, conservandoFoco, dialogo, encabezado, insignia, tabla, zonaAlertas } from "../views/componentes.js";
import { formulario } from "../views/formulario.js";
import { formasDeVenta, vistaAlta, vistaFicha, vistaLista, INCREMENTOS } from "../views/productos.view.js";

const contenido = () => document.getElementById("contenido");
const opciones = (ruta, filtros) => RecursoModelo.opciones(ruta, filtros).catch(() => []);

/** Formulario dentro de un dialogo: alEnviar(datos) cierra si no lanza error. */
function dialogoFormulario({ titulo, campos, valores = {}, textoEnviar, alEnviar }) {
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
    d = dialogo({ titulo, contenido: form });
    d.abrir();
    return d;
}

// ------------------------------------------------------------------ Lista
const estadoLista = { page: 1, q: "", publicado: "", filas: [], meta: null };

export async function lista() {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando productos…"));
    let primera = true;
    async function cargar() {
        try {
            const { data, meta } = await ProductoModelo.listar({ page: estadoLista.page, limit: 20, q: estadoLista.q, publicado: estadoLista.publicado, ...paramsOrden(estadoLista) });
            Object.assign(estadoLista, { filas: data, meta });
        } catch (error) {
            alertas.error(error, "No se pudo cargar la lista de productos");
        }
        const pintar = () => montar(contenido(), vistaLista({
            estado: estadoLista,
            puedeCrear: sesion.puede("CATALOGO_GESTIONAR") && sesion.puede("PRECIO_GESTIONAR"),
            alertas,
            acciones: {
                orden: ordenServidor(estadoLista, cargar),
                buscar: (q, publicado) => {
                    if (q === estadoLista.q && (publicado ?? "") === estadoLista.publicado) return;
                    Object.assign(estadoLista, { q, publicado: publicado ?? "", page: 1 });
                    cargar().then(() => anunciar(`${estadoLista.meta?.totalItems ?? 0} productos`));
                },
                pagina: (n) => {
                    estadoLista.page = n;
                    cargar();
                },
            },
        }));
        if (primera) pintar();
        else conservandoFoco(contenido(), pintar);
        primera = false;
    }
    await cargar();
}

// ------------------------------------------------------------------ Alta
export async function nuevo() {
    if (!sesion.puede("CATALOGO_GESTIONAR") || !sesion.puede("PRECIO_GESTIONAR")) {
        montar(contenido(), encabezado({ titulo: "Nuevo producto" }), alerta("warning", "Crear productos requiere los permisos de catálogo y de precios."));
        return;
    }
    montar(contenido(), cargando());
    const [categorias, unidades, tarifas, marcas, proveedores] = await Promise.all(
        ["categorias", "unidades-medida", "tarifas-iva", "marcas", "proveedores"].map((r) => opciones(r))
    );
    const alertas = zonaAlertas();
    montar(contenido(), vistaAlta({
        opciones: { categorias, unidades, tarifas, marcas, proveedores },
        alertas,
        acciones: {
            atributosDe: (idCategoria) => ProductoModelo.atributosDeCategoria(idCategoria),
            crear: async (datos, form, resumen) => {
                try {
                    const p = await ProductoModelo.crear(datos);
                    sessionStorage.setItem("ce_admin_mensaje", `Se creó ${p.codigo} con ${p.variantes.length} variante(s).`);
                    navegar(`/productos/${p.idProducto}`);
                } catch (error) {
                    aplicarErroresApi(form, resumen, error);
                }
            },
        },
    }));
}

// ------------------------------------------------------------------ Ficha
export async function detalle({ id }) {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando el producto…"));
    let producto;
    let pestana = "variantes"; // se conserva al re-pintar tras cada accion
    const [categorias, tarifas, marcas] = await Promise.all(["categorias", "tarifas-iva", "marcas"].map((r) => opciones(r)));

    const pintar = (mensaje = null) => {
        const { form } = formulario({
            campos: [
                { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", patron: "nombre", max: 150, requerido: true },
                { nombre: "idCategoria", etiqueta: "Categoría", tipo: "seleccion", requerido: true, opciones: categorias },
                { nombre: "idMarca", etiqueta: "Marca", tipo: "seleccion", opciones: marcas },
                { nombre: "idTarifaIva", etiqueta: "Tarifa de IVA", tipo: "seleccion", requerido: true, opciones: tarifas },
                { nombre: "uso", etiqueta: "Uso típico", tipo: "texto", patron: "texto", max: 200 },
                { nombre: "imagenUrl", etiqueta: "Imagen (URL)", tipo: "url", max: 500 },
                { nombre: "descripcion", etiqueta: "Descripción", tipo: "textoLargo", patron: "texto", max: 300 },
                { nombre: "ventaPorPieza", etiqueta: "Se vende por pieza", tipo: "booleano" },
                { nombre: "precioPorVariante", etiqueta: "Precio y costo distinto por color o talla", tipo: "booleano", ayuda: "Si no se marca, todas las variantes valen lo mismo." },
                { nombre: "compraDescripcion", etiqueta: "Se compra en", tipo: "texto", patron: "texto", max: 40, ayuda: "Ej. Rollo × 30 m, Plancha, Paquete de bandas. Vacío = en la unidad del inventario." },
                { nombre: "compraFactor", etiqueta: "Contenido de esa unidad", tipo: "cantidad", ayuda: "Ej. 30 (m por rollo). Vacío si cada pieza se mide al recibir." },
            ],
            valores: { ...producto, ventaPorPieza: producto.ventaPorPieza ? 1 : 0, precioPorVariante: producto.precioPorVariante ? 1 : 0 },
            textoEnviar: "Guardar datos generales",
            alEnviar: async (datos) => {
                datos.ventaPorPieza = Boolean(datos.ventaPorPieza);
                datos.precioPorVariante = Boolean(datos.precioPorVariante);
                producto = await ProductoModelo.actualizar(producto.idProducto, datos);
                pintar("Datos generales guardados.");
            },
        });
        montar(contenido(), vistaFicha({
            producto,
            alertas,
            formularioGeneral: form,
            puede: { catalogo: sesion.puede("CATALOGO_GESTIONAR"), precios: sesion.puede("PRECIO_GESTIONAR") },
            acciones,
            pestana,
            alCambiarPestana: (p) => (pestana = p),
        }));
        if (mensaje) alertas.exito(mensaje);
    };

    const ejecutar = async (fn, mensaje) => {
        try {
            producto = await fn();
            pintar(mensaje);
        } catch (error) {
            alertas.error(error);
        }
    };

    const acciones = {
        alternarPublicado: () =>
            ejecutar(() => ProductoModelo.actualizar(producto.idProducto, { publicado: !producto.publicado }),
                producto.publicado ? "El producto ya no aparece en la tienda." : "El producto está publicado en la tienda."),
        cambiarPrecio: (forma) =>
            dialogoFormulario({
                titulo: `Nuevo precio: ${forma.descripcion}`,
                textoEnviar: "Registrar precio",
                campos: [{
                    nombre: "precioConIva",
                    etiqueta: "Precio con IVA (USD)",
                    tipo: "dinero",
                    requerido: true,
                    ayuda: `Lo que paga el cliente, con el IVA de ${producto.porcentajeIva} % incluido. El precio anterior queda en el historial.`,
                },
                // solo los productos con precio por variante (ciertas suelas) eligen a que color o talla aplica
                ...(producto.precioPorVariante ? [{
                    nombre: "idPresentacion",
                    etiqueta: "Aplicar a",
                    tipo: "seleccion",
                    ayuda: "Vacío = a todos los colores y tallas",
                    opciones: producto.variantes.flatMap((v) => v.presentaciones.filter((x) => x.descripcion === forma.descripcion)
                        .map((x) => ({ valor: x.idPresentacion, etiqueta: `${Object.values(v.caracteristicas).join(" · ") || v.sku} (ahora ${formato.dinero(x.precioConIva)})` }))),
                }] : [])],
                valores: { precioConIva: [...forma.preciosConIva][0] ?? "" },
                alEnviar: async ({ precioConIva, idPresentacion }) => {
                    producto = await ProductoModelo.registrarPrecio(producto.idProducto, idPresentacion ? { idPresentacion: Number(idPresentacion), precioConIva } : { descripcion: forma.descripcion, precioConIva });
                    // la base guarda el precio sin IVA en centavos: se informa el que quedo de verdad
                    const quedo = formasDeVenta(producto).find((f) => f.descripcion === forma.descripcion);
                    const real = [...(quedo?.preciosConIva ?? [])][0];
                    pintar(`Precio de ${forma.descripcion} actualizado a ${formato.dinero(real ?? precioConIva)} con IVA` +
                        (real !== undefined && real !== precioConIva ? ` (el más cercano a ${formato.dinero(precioConIva)} que da una base en centavos).` : "."));
                },
            }),
        alternarForma: async (forma) => {
            if (forma.activa && !(await confirmar({ titulo: "Desactivar forma de venta", mensaje: `“${forma.descripcion}” dejará de ofrecerse en la tienda y en ventas nuevas. ¿Continuar?`, textoConfirmar: "Desactivar" }))) return;
            ejecutar(() => ProductoModelo.actualizarFormaDeVenta(producto.idProducto, { descripcion: forma.descripcion, activa: !forma.activa }),
                `Forma de venta ${forma.activa ? "desactivada" : "activada"}.`);
        },
        agregarProveedor: async () => {
            const ya = new Set((producto.proveedores ?? []).map((pv) => pv.idProveedor));
            const opcionesProv = (await opciones("proveedores")).filter((o) => !ya.has(Number(o.valor)));
            if (!opcionesProv.length) return alertas.info("Ya están todos los proveedores registrados.");
            dialogoFormulario({
                titulo: "Agregar proveedor",
                textoEnviar: "Agregar",
                campos: [
                    { nombre: "idProveedor", etiqueta: "Proveedor", tipo: "seleccion", requerido: true, opciones: opcionesProv },
                    { nombre: "codigoProveedor", etiqueta: "Código del proveedor (opcional)", tipo: "texto", patron: "codigo", max: 40, ayuda: "Como el proveedor llama a este producto en su factura" },
                ],
                alEnviar: async (datos) => {
                    await ProductoModelo.agregarProveedor(producto.idProducto, { idProveedor: Number(datos.idProveedor), ...(datos.codigoProveedor ? { codigoProveedor: datos.codigoProveedor } : {}) });
                    producto = await ProductoModelo.obtener(producto.idProducto);
                    pintar("Proveedor agregado.");
                },
            });
        },
        quitarProveedor: async (pv) => {
            if (!(await confirmar({ titulo: "Quitar proveedor", mensaje: `${pv.nombre} dejará de figurar como proveedor de este producto. ¿Continuar?`, textoConfirmar: "Quitar", peligro: true }))) return;
            ejecutar(async () => {
                await ProductoModelo.quitarProveedor(producto.idProducto, pv.idProveedor);
                return ProductoModelo.obtener(producto.idProducto);
            }, `${pv.nombre} ya no es proveedor de este producto.`);
        },
        nuevaForma: () =>
            dialogoFormulario({
                titulo: "Nueva forma de venta",
                textoEnviar: "Agregar",
                campos: [
                    { nombre: "descripcion", etiqueta: "Nombre", tipo: "texto", patron: "nombre", max: 40, requerido: true, ayuda: "Ej. Docena, Rollo × 50 m, 1/2 metro" },
                    { nombre: "factor", etiqueta: `Contenido en ${(producto.unidad ?? "").toLowerCase()}`, tipo: "cantidad", requerido: true },
                    { nombre: "cantidadMinima", etiqueta: "Compra mínima", tipo: "cantidad", requerido: true },
                    { nombre: "incremento", etiqueta: "Cómo se pide", tipo: "opciones", requerido: true, opciones: INCREMENTOS, ayuda: "Lo que el cliente puede pedir en la tienda y en el mostrador. «Cualquier decimal» para lo que se mide (cuero por pie²)." },
                    { nombre: "precioConIva", etiqueta: "Precio con IVA (USD)", tipo: "dinero", requerido: true, ayuda: `IVA de ${producto.porcentajeIva} % incluido` },
                ],
                valores: { cantidadMinima: 1, incremento: 1 },
                alEnviar: async (datos) => {
                    producto = await ProductoModelo.agregarFormaDeVenta(producto.idProducto, { ...datos, incremento: Number(datos.incremento) });
                    pintar(`Forma de venta “${datos.descripcion}” agregada a todas las variantes.`);
                },
            }),
        nuevaVariante: async () => {
            const atributos = producto.atributosDisponibles;
            if (atributos.length === 0) {
                alertas.info("La categoría de este producto no tiene atributos (Color, Talla…). Asígnalos para crear variantes.");
                return;
            }
            dialogoFormulario({
                titulo: "Nueva variante",
                textoEnviar: "Crear variante",
                campos: [
                    ...atributos.map((a) => ({ nombre: `a${a.idAtributo}`, etiqueta: a.nombre, tipo: "seleccion", requerido: true, opciones: a.valores.map((v) => ({ valor: v.idValorAtributo, etiqueta: v.valor })) })),
                    { nombre: "stockMinimo", etiqueta: `Existencia mínima (${producto.unidad})`, tipo: "cantidad", ayuda: `Punto de reposición, en ${producto.unidad}. Cuando lo disponible más lo que viene en camino baja a esta cantidad, la variante se marca «Reponer» en el inventario, sale en el reporte de productos por reponer y se sugiere en las órdenes de compra. 0 = no avisar.` },
                ],
                alEnviar: async (datos) => {
                    const valores = atributos.map((a) => Number(datos[`a${a.idAtributo}`]));
                    producto = await ProductoModelo.agregarVariante(producto.idProducto, { valores, stockMinimo: datos.stockMinimo ?? 0 });
                    pintar("Variante creada con las mismas formas de venta y precios.");
                },
            });
        },
        editarVariante: (v) =>
            dialogoFormulario({
                titulo: `Variante ${v.sku}`,
                textoEnviar: "Guardar",
                campos: [
                    { nombre: "stockMinimo", etiqueta: `Existencia mínima (${producto.unidad})`, tipo: "cantidad", requerido: true, ayuda: `Punto de reposición, en ${producto.unidad}. Cuando lo disponible más lo que viene en camino baja a esta cantidad, la variante se marca «Reponer» en el inventario, sale en el reporte de productos por reponer y se sugiere en las órdenes de compra. 0 = no avisar.` },
                    { nombre: "activa", etiqueta: "Activa (se puede vender)", tipo: "booleano" },
                ],
                valores: { stockMinimo: v.stockMinimo, activa: v.activa ? 1 : 0 },
                alEnviar: async (datos) => {
                    producto = await ProductoModelo.actualizarVariante(v.idVariante, { stockMinimo: datos.stockMinimo, activa: Boolean(datos.activa) });
                    pintar(`Variante ${v.sku} actualizada.`);
                },
            }),
        historial: async () => {
            try {
                const filas = await ProductoModelo.historialPrecios(producto.idProducto);
                dialogo({
                    titulo: `Historial de precios · ${producto.codigo}`,
                    grande: true,
                    contenido: tabla({
                        titulo: "Historial de precios",
                        filas,
                        columnas: [
                            { titulo: "SKU", valor: (h) => h.var_sku, clave: "var_sku" },
                            { titulo: "Forma de venta", valor: (h) => h.presentacion, clave: "presentacion" },
                            { titulo: "Precio con IVA", numerica: true, valor: (h) => formato.dinero(h.precio_con_iva), clave: "precio_con_iva" },
                            { titulo: "Base sin IVA (factura)", numerica: true, valor: (h) => formato.dinero(h.precio), clave: "precio" },
                            { titulo: "Vigente desde", valor: (h) => formato.fechaHora(h.vigente_desde), clave: "vigente_desde" },
                            { titulo: "Estado", valor: (h) => (h.vigente ? insignia("Vigente", "success") : "Anterior") },
                        ],
                    }),
                }).abrir();
            } catch (error) {
                alertas.error(error);
            }
        },
    };

    try {
        producto = await ProductoModelo.obtener(id);
        pintar(sessionStorage.getItem("ce_admin_mensaje"));
        sessionStorage.removeItem("ce_admin_mensaje");
    } catch (error) {
        montar(contenido(), encabezado({ titulo: "Producto" }), alerta("danger", error.message, { titulo: "No se pudo abrir el producto" }));
    }
}

// ------------------------------------------------------------------ Ofertas
export async function ofertas() {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando ofertas…"));
    const productos = await opciones("productos");
    const puede = sesion.puede("PRECIO_GESTIONAR");
    async function pintar(mensaje) {
        let filas = [];
        try {
            filas = await ProductoModelo.ofertas();
        } catch (error) {
            alertas.error(error);
        }
        montar(contenido(),
            el("section", { "aria-labelledby": "tituloVista" },
                encabezado({
                    titulo: "Ofertas",
                    descripcion: "Descuento temporal de un producto. La base lo aplica sola en la tienda y en el mostrador.",
                    acciones: puede ? [el("button", { type: "button", class: "btn btn-primary", onclick: nueva }, "Nueva oferta")] : [],
                }),
                alertas.nodo,
                tabla({
                    titulo: "Ofertas registradas",
                    filas,
                    vacio: "No hay ofertas registradas.",
                    columnas: [
                        { titulo: "Producto", valor: (o) => `${o.prd_codigo} · ${o.prd_nombre}` },
                        { titulo: "Descuento", numerica: true, valor: (o) => `${o.porcentaje} %` },
                        { titulo: "Desde", valor: (o) => formato.fecha(o.desde), clave: "desde" },
                        { titulo: "Hasta", valor: (o) => formato.fecha(o.hasta), clave: "hasta" },
                        { titulo: "Estado", valor: (o) => insignia(o.estado, o.estado === "VIGENTE" ? "success" : "secondary") },
                        { titulo: "Líneas vendidas", numerica: true, valor: (o) => o.lineas_vendidas, clave: "lineas_vendidas" },
                    ],
                    acciones: puede
                        ? (o) => [
                              ["VIGENTE", "PROGRAMADA"].includes(o.estado)
                                  ? el("button", { type: "button", class: "btn btn-sm btn-outline-secondary", "aria-label": `Pausar la oferta de ${o.prd_codigo}`, onclick: () => cambiar(o, false) }, "Pausar")
                                  : o.estado === "PAUSADA"
                                    ? el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-label": `Reactivar la oferta de ${o.prd_codigo}`, onclick: () => cambiar(o, true) }, "Reactivar")
                                    : null,
                          ]
                        : null,
                })));
        if (mensaje) alertas.exito(mensaje);
    }
    async function cambiar(o, activa) {
        try {
            await ProductoModelo.cambiarOferta(o.id_oferta, { activa });
            await pintar(activa ? "Oferta reactivada." : "Oferta pausada.");
        } catch (error) {
            alertas.error(error);
        }
    }
    function nueva() {
        dialogoFormulario({
            titulo: "Nueva oferta",
            textoEnviar: "Registrar oferta",
            campos: [
                { nombre: "idProducto", etiqueta: "Producto", tipo: "seleccion", requerido: true, opciones: productos },
                { nombre: "porcentaje", etiqueta: "Descuento (%)", tipo: "porcentaje", requerido: true },
                { nombre: "desde", etiqueta: "Desde", tipo: "fecha", ayuda: "Vacío = desde hoy" },
                { nombre: "hasta", etiqueta: "Hasta", tipo: "fecha", ayuda: "Vacío = sin fecha de fin" },
                { nombre: "descripcion", etiqueta: "Descripción", tipo: "texto", patron: "nombre", max: 100 },
            ],
            alEnviar: async (datos) => {
                await ProductoModelo.crearOferta({ ...datos, idProducto: Number(datos.idProducto) });
                await pintar("Oferta registrada.");
            },
        });
    }
    await pintar();
}

// ------------------------------------------------------------------ Combos
export async function combos() {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando combos…"));
    const productos = await opciones("productos");
    const puede = sesion.puede("CATALOGO_GESTIONAR");
    async function pintar(mensaje) {
        let filas = [];
        try {
            filas = await ProductoModelo.combos();
        } catch (error) {
            alertas.error(error);
        }
        montar(contenido(),
            el("section", { "aria-labelledby": "tituloVista" },
                encabezado({
                    titulo: "Combos",
                    descripcion: "Productos que se venden juntos (ej. 1 m de cierre + 2 llaves). El color se elige al comprar.",
                    acciones: puede ? [el("button", { type: "button", class: "btn btn-primary", onclick: () => editar(null) }, "Nuevo combo")] : [],
                }),
                alertas.nodo,
                tabla({
                    titulo: "Combos",
                    filas,
                    vacio: "No hay combos.",
                    columnas: [
                        { titulo: "Código", valor: (c) => c.codigo, clave: "codigo" },
                        { titulo: "Nombre", valor: (c) => c.nombre, clave: "nombre" },
                        { titulo: "Componentes", valor: (c) => c.componentes.map((x) => `${formato.numero(x.cantidad)} × ${x.presentacion} de ${x.producto}`).join(" + ") },
                        { titulo: "Tienda", valor: (c) => (c.publicado ? insignia("Publicado", "success") : insignia("Oculto", "secondary")) },
                    ],
                    acciones: puede
                        ? (c) => [
                              el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-label": `Editar ${c.nombre}`, onclick: () => editar(c) }, "Editar"),
                              el("button", { type: "button", class: "btn btn-sm btn-outline-danger", "aria-label": `Eliminar ${c.nombre}`, onclick: () => eliminar(c) }, "Eliminar"),
                          ]
                        : null,
                })));
        if (mensaje) alertas.exito(mensaje);
    }
    async function eliminar(c) {
        if (!(await confirmar({ titulo: "Eliminar combo", mensaje: `¿Eliminar “${c.nombre}”? Deja de ofrecerse en la tienda.`, textoConfirmar: "Eliminar" }))) return;
        try {
            await ProductoModelo.eliminarCombo(c.idCombo);
            await pintar("Combo eliminado.");
        } catch (error) {
            alertas.error(error);
        }
    }
    function editar(c) {
        const comp = (i) => [
            { nombre: `p${i}`, etiqueta: `Componente ${i + 1}: producto`, tipo: "seleccion", requerido: i < 2, opciones: productos },
            { nombre: `f${i}`, etiqueta: `Componente ${i + 1}: forma de venta`, tipo: "texto", patron: "nombre", max: 40, requerido: i < 2, ayuda: "Exactamente como en el producto (ej. Metro)" },
            { nombre: `c${i}`, etiqueta: `Componente ${i + 1}: cantidad`, tipo: "cantidad", requerido: i < 2 },
        ];
        const valores = c
            ? Object.fromEntries([["codigo", c.codigo], ["nombre", c.nombre], ["descripcion", c.descripcion], ["publicado", c.publicado ? 1 : 0],
                  ...c.componentes.flatMap((x, i) => [[`p${i}`, x.idProducto], [`f${i}`, x.presentacion], [`c${i}`, x.cantidad]])])
            : { publicado: 1 };
        dialogoFormulario({
            titulo: c ? `Editar combo ${c.codigo}` : "Nuevo combo",
            textoEnviar: c ? "Guardar" : "Crear combo",
            campos: [
                { nombre: "codigo", etiqueta: "Código", tipo: "texto", soloLectura: true, automatico: true, ayuda: "Automático: CMB-0001, CMB-0002…" },
                { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", patron: "nombre", max: 120, requerido: true },
                { nombre: "descripcion", etiqueta: "Descripción", tipo: "texto", patron: "texto", max: 300 },
                { nombre: "publicado", etiqueta: "Ofrecer en la tienda", tipo: "booleano" },
                ...comp(0), ...comp(1), ...comp(2),
            ],
            valores,
            alEnviar: async (d) => {
                const componentes = [0, 1, 2]
                    .filter((i) => d[`p${i}`])
                    .map((i) => ({ idProducto: Number(d[`p${i}`]), presentacion: d[`f${i}`], cantidad: d[`c${i}`] }));
                await ProductoModelo.guardarCombo(c?.idCombo ?? null, {
                    nombre: d.nombre,
                    descripcion: d.descripcion,
                    publicado: Boolean(d.publicado),
                    componentes,
                });
                await pintar(c ? "Combo guardado." : "Combo creado.");
            },
        });
    }
    await pintar();
}
