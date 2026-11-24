// js/controllers/tablero.controller.js
// CONTROLADOR + vista del tablero de inicio: indicadores de lo que conviene
// atender hoy (de /reportes/resumen), cada uno con enlace a su seccion.
import { el, formato, montar } from "../core/dom.js";
import { sesion } from "../core/sesion.js";
import { ReporteModelo } from "../models/negocio.model.js";
import { alerta, cargando, encabezado } from "../views/componentes.js";

const contenido = () => document.getElementById("contenido");

function indicador({ titulo, valor, detalle, href, alertaSi = false }) {
    return el("article", { class: `indicador${alertaSi ? " alerta" : ""}` },
        el("h2", { class: "h6 text-body-secondary mb-1" }, titulo),
        el("p", { class: "valor mb-1" }, valor),
        detalle ? el("p", { class: "small mb-2" }, detalle) : null,
        href ? el("a", { href, class: "small" }, "Ver detalle", el("span", { class: "visually-hidden" }, `: ${titulo}`)) : null);
}

/** Tareas frecuentes a un clic (atajos: el menu sigue siendo el camino completo). */
function accesosRapidos() {
    const p = (...x) => sesion.puede(...x);
    const accesos = [
        p("VENTA_REGISTRAR") ? { href: "#/ventas/nueva", texto: "Nueva venta", principal: true } : null,
        p("COMPRA_GESTIONAR") ? { href: "#/compras/nueva", texto: "Nueva orden de compra" } : null,
        p("CATALOGO_GESTIONAR") && p("PRECIO_GESTIONAR") ? { href: "#/productos/nuevo", texto: "Nuevo producto" } : null,
        { href: "#/inventario", texto: "Consultar inventario" },
    ].filter(Boolean);
    return el("nav", { "aria-label": "Accesos rápidos", class: "accesos-rapidos" },
        accesos.map((a) => el("a", { href: a.href, class: `btn ${a.principal ? "btn-primary" : "btn-outline-primary"}` }, a.texto)));
}

export async function tablero() {
    montar(contenido(), cargando("Cargando el tablero…"));
    try {
        const r = await ReporteModelo.resumen();
        montar(contenido(),
            encabezado({ titulo: `Hola, ${sesion.usuario.nombre}`, descripcion: "Lo que conviene atender hoy en Comercial Elite." }),
            accesosRapidos(),
            el("section", { "aria-label": "Indicadores" },
                el("div", { class: "grilla-indicadores" },
                    indicador({ titulo: "Pedidos pendientes de pago", valor: formato.numero(r.pedidos_pendientes), href: "#/ventas?estado=PEN", alertaSi: r.pedidos_pendientes > 0 }),
                    indicador({ titulo: "Pedidos por despachar o entregar", valor: formato.numero(r.pedidos_por_despachar), href: "#/ventas" }),
                    indicador({ titulo: "Variantes bajo el stock mínimo", valor: formato.numero(r.variantes_por_comprar), detalle: "Conviene reponerlas", href: "#/inventario?reponer=1", alertaSi: r.variantes_por_comprar > 0 }),
                    indicador({ titulo: "Órdenes de compra abiertas", valor: formato.numero(r.ordenes_abiertas), detalle: r.ordenes_atrasadas ? `${r.ordenes_atrasadas} atrasada(s)` : "Ninguna atrasada", href: "#/compras", alertaSi: r.ordenes_atrasadas > 0 }),
                    indicador({ titulo: "Vendido este mes", valor: formato.dinero(r.vendido_mes), href: "#/reportes" }),
                    indicador({ titulo: "Saldo por cobrar", valor: formato.dinero(r.por_cobrar), href: "#/reportes/cuentas-por-cobrar" }),
                    indicador({ titulo: "Productos publicados en la tienda", valor: formato.numero(r.productos_publicados), href: "#/productos" }))));
    } catch (error) {
        montar(contenido(), encabezado({ titulo: "Inicio" }), alerta("danger", error.message, { titulo: "No se pudo cargar el tablero" }));
    }
}
