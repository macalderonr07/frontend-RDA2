// js/controllers/inventario.controller.js — CONTROLADOR del inventario.
// Flujo producto -> variantes -> kardex/lotes (ver views/inventario.view.js).
import { anunciar, el, montar } from "../core/dom.js";
import { sesion } from "../core/sesion.js";
import { patron } from "../core/validacion.js";
import { InventarioModelo, ProductoModelo } from "../models/negocio.model.js";
import { ordenServidor, paramsOrden, alerta, cargando, conservandoFoco, dialogo, encabezado, zonaAlertas } from "../views/componentes.js";
import { formulario } from "../views/formulario.js";
import { vistaDetalleVariante, vistaInventarioProducto, vistaListaInventario } from "../views/inventario.view.js";

const contenido = () => document.getElementById("contenido");

// ------------------------------------------------------------------ 1. Lista por producto
const estado = { page: 1, q: "", reponer: false, filas: [], meta: null };

export async function stock({ consulta }) {
    const alertas = zonaAlertas();
    if (consulta?.get("reponer") === "1") Object.assign(estado, { reponer: true, page: 1 });
    montar(contenido(), cargando("Cargando el inventario…"));
    let primera = true;
    async function cargar() {
        try {
            const { data, meta } = await ProductoModelo.listar({
                page: estado.page, limit: 25, q: estado.q, requiereCompra: estado.reponer ? 1 : "", ...paramsOrden(estado),
            });
            Object.assign(estado, { filas: data, meta });
        } catch (error) {
            alertas.error(error, "No se pudo cargar el inventario");
        }
        const pintar = () => montar(contenido(), vistaListaInventario({
            estado,
            alertas,
            acciones: {
                orden: ordenServidor(estado, cargar),
                buscar: (q, reponer) => {
                    if (q === estado.q && reponer === estado.reponer) return;
                    Object.assign(estado, { q, reponer, page: 1 });
                    cargar().then(() => anunciar(`${estado.meta?.totalItems ?? 0} productos`));
                },
                pagina: (n) => {
                    estado.page = n;
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

// ------------------------------------------------------------------ Dialogos de movimientos
function dialogoFormulario({ titulo, campos, valores, textoEnviar, alEnviar, ayuda = null }) {
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
    d = dialogo({ titulo, contenido: [ayuda ? el("p", { class: "text-body-secondary" }, ayuda) : null, form] });
    d.abrir();
}

/** Ajuste de inventario (conteo fisico, merma, inventario inicial) de una variante. */
function abrirAjuste(v, alTerminar) {
    const unidad = v.unidad ? ` (${v.unidad})` : " (unidad base)";
    dialogoFormulario({
        titulo: `Registrar ajuste · ${v.caracteristicas || v.var_sku}`,
        ayuda: `Stock físico actual: ${v.stock_fisico}${unidad}. El ajuste queda en el kárdex con tu usuario y el motivo. Una salida no puede dejar el stock en negativo.`,
        textoEnviar: "Registrar ajuste",
        campos: [
            {
                nombre: "tipo", etiqueta: "¿Qué pasó?", tipo: "opciones", requerido: true,
                opciones: [
                    { valor: "AJN", etiqueta: "En el conteo hay menos de lo registrado (salida)" },
                    { valor: "AJP", etiqueta: "En el conteo hay más de lo registrado (entrada)" },
                    { valor: "MER", etiqueta: "Se dañó o se perdió mercadería (salida por merma)" },
                    { valor: "INI", etiqueta: "Cargo el inventario inicial (entrada)" },
                ],
            },
            { nombre: "cantidad", etiqueta: `Cantidad${unidad}`, tipo: "cantidad", requerido: true },
            { nombre: "costoUnitario", etiqueta: "Costo unitario sin IVA (solo entradas)", tipo: "cantidad", patron: "costo", ayuda: "Inventario inicial: obligatorio. Sobrante: si se deja vacío, se usa el último costo." },
            { nombre: "motivo", etiqueta: "Motivo", tipo: "texto", patron: "texto", max: 200, requerido: true, ayuda: "Ej. Conteo del 22/11: 3 pares más" },
        ],
        valores: { tipo: "AJN" },
        alEnviar: async (datos) => {
            await InventarioModelo.ajustar({ ...datos, idVariante: Number(v.id_variante) });
            await alTerminar(`Ajuste registrado en el kárdex de ${v.var_sku}.`);
        },
    });
}

// ------------------------------------------------------------------ 2. Ficha de inventario del producto
export async function producto({ id, consulta }) {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando el inventario del producto…"));
    const puede = {
        ajustar: sesion.puede("INV_AJUSTAR"),
        fraccionar: sesion.puede("INV_FRACCIONAR"),
        devolver: sesion.puede("COMPRA_GESTIONAR"),
        verProducto: true,
    };
    let datosProducto;
    let variantes = [];
    let idElegida = Number(consulta?.get("v")) || null;
    let pestana = consulta?.get("pestana") === "lotes" ? "lotes" : "kardex";
    const zonaDetalle = el("div", { "aria-live": "off" });

    async function cargarVariantes() {
        const { data } = await InventarioModelo.stock({ idProducto: id, limit: 100, orden: "var_sku", dir: "asc" });
        variantes = data;
    }

    /** URL compartible y que sobrevive a F5, sin volver a correr el router (no recarga la pagina). */
    function recordarEnUrl() {
        const q = new URLSearchParams();
        if (idElegida) q.set("v", idElegida);
        if (pestana !== "kardex") q.set("pestana", pestana);
        window.history.replaceState(null, "", `#/inventario/producto/${id}${q.size ? `?${q}` : ""}`);
    }

    async function pintarDetalle({ enfocar = false, mensaje = null } = {}) {
        const v = variantes.find((x) => Number(x.id_variante) === Number(idElegida));
        if (!v) {
            montar(zonaDetalle);
            return;
        }
        montar(zonaDetalle, cargando(`Cargando el kárdex de ${v.var_sku}…`));
        try {
            const [lotes, kardex] = await Promise.all([InventarioModelo.lotes(v.id_variante), InventarioModelo.kardex(v.id_variante)]);
            montar(zonaDetalle, vistaDetalleVariante({
                variante: v, lotes, kardex, puede, acciones: accionesDe(v), pestana,
                alCambiarPestana: (p) => {
                    pestana = p;
                    recordarEnUrl();
                },
            }));
            if (enfocar) document.getElementById("tituloDetalle")?.focus();
            if (mensaje) alertas.exito(mensaje);
        } catch (error) {
            montar(zonaDetalle, alerta("danger", error.message, { titulo: `No se pudo cargar el kárdex de ${v.var_sku}` }));
        }
    }

    function pintarTodo() {
        montar(contenido(), vistaInventarioProducto({
            producto: datosProducto, variantes, idElegida, puede, alertas, detalle: zonaDetalle,
            acciones: {
                elegir: (idVariante) => {
                    idElegida = Number(idVariante);
                    recordarEnUrl();
                    // solo cambia el resaltado de la fila y el detalle: no se recarga la pagina
                    for (const tr of contenido().querySelectorAll("tr.fila-elegida")) tr.classList.remove("fila-elegida");
                    for (const a of contenido().querySelectorAll("a[aria-current]")) a.removeAttribute("aria-current");
                    const enlace = contenido().querySelector(`a[href$="?v=${idElegida}"]`);
                    enlace?.setAttribute("aria-current", "true");
                    enlace?.closest("tr")?.classList.add("fila-elegida");
                    pintarDetalle({ enfocar: true });
                },
            },
        }));
    }

    /** Tras un movimiento se recargan los totales y el detalle (el kardex cambio). */
    async function refrescar(mensaje) {
        await cargarVariantes();
        pintarTodo();
        await pintarDetalle({ mensaje });
    }

    function accionesDe(v) {
        return {
            ajustar: () => abrirAjuste(v, refrescar),
            fraccionar: (lote) => {
                const p = patron("cantidad");
                dialogoFormulario({
                    titulo: `Fraccionar el lote ${lote.codigo ?? lote.id_lote}`,
                    ayuda: `Corta la pieza en paquetes medidos. Saldo libre: ${lote.libre}. Lo que no se corta queda en la pieza original.`,
                    textoEnviar: "Fraccionar",
                    campos: [
                        { nombre: "piezas", etiqueta: "Medidas de los paquetes", tipo: "texto", requerido: true, max: 200, ayuda: `Separadas por coma, en ${v.unidad}. Ej. 11.2, 11.2` },
                        { nombre: "motivo", etiqueta: "Motivo", tipo: "texto", patron: "texto", max: 200 },
                    ],
                    alEnviar: async (datos) => {
                        const piezas = datos.piezas.split(",").map((x) => x.trim()).filter(Boolean);
                        const malas = piezas.filter((x) => !p?.regex.test(x) || Number(x) <= 0);
                        if (piezas.length === 0 || malas.length) {
                            const error = new Error("Escribe medidas positivas separadas por coma (ej. 11.2, 11.2).");
                            error.detalles = [{ campo: "piezas", mensaje: "Escribe medidas positivas separadas por coma (ej. 11.2, 11.2)." }];
                            throw error;
                        }
                        const r = await InventarioModelo.fraccionar(lote.id_lote, piezas.map(Number), datos.motivo);
                        await refrescar(`Se crearon ${r.paquetes.length} paquete(s).`);
                    },
                });
            },
            devolver: (lote) =>
                dialogoFormulario({
                    titulo: `Devolver al proveedor · lote ${lote.codigo ?? lote.id_lote}`,
                    ayuda: `Saldo libre del lote: ${lote.libre} ${v.unidad}.`,
                    textoEnviar: "Registrar devolución",
                    campos: [
                        { nombre: "cantidad", etiqueta: `Cantidad a devolver (${v.unidad})`, tipo: "cantidad", requerido: true },
                        { nombre: "motivo", etiqueta: "Motivo", tipo: "texto", patron: "texto", max: 200, requerido: true },
                    ],
                    alEnviar: async ({ cantidad, motivo }) => {
                        await InventarioModelo.devolver(lote.id_lote, cantidad, motivo);
                        await refrescar("Devolución al proveedor registrada.");
                    },
                }),
        };
    }

    try {
        [datosProducto] = await Promise.all([ProductoModelo.obtener(id), cargarVariantes()]);
    } catch (error) {
        montar(contenido(), encabezado({ titulo: "Inventario", miga: [{ texto: "Inventario", href: "#/inventario" }, { texto: "Producto" }] }),
            alerta("danger", error.message, { titulo: "No se pudo abrir el inventario del producto" }));
        return;
    }
    // Sin variante en la URL se abre la primera que hay que reponer o, si no, la primera.
    if (!variantes.some((x) => Number(x.id_variante) === idElegida)) {
        idElegida = Number((variantes.find((x) => x.requiere_compra) ?? variantes[0])?.id_variante) || null;
    }
    pintarTodo();
    await pintarDetalle();
}

/** Ruta vieja /inventario/:idVariante (enlaces guardados): lleva a la ficha de su producto. */
export async function variante({ idVariante }) {
    montar(contenido(), cargando("Abriendo el inventario…"));
    try {
        const { data } = await InventarioModelo.stock({ idVariante, limit: 1 });
        if (!data[0]) {
            montar(contenido(), encabezado({ titulo: "Inventario" }), alerta("warning", "No se encontró esa variante (o está inactiva)."),
                el("a", { href: "#/inventario", class: "btn btn-primary" }, "Ir al inventario"));
            return;
        }
        window.location.replace(`#/inventario/producto/${data[0].id_producto}?v=${idVariante}`);
    } catch (error) {
        montar(contenido(), encabezado({ titulo: "Inventario" }), alerta("danger", error.message, { titulo: "No se pudo abrir el inventario" }));
    }
}
