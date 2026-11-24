// js/app.js — punto de entrada: sesion, menu por permisos, tema y rutas.
// Arquitectura MVC del frontend:
//   models/      -> hablan JSON con la API (fetch)
//   views/       -> construyen el DOM accesible (sin innerHTML con datos)
//   controllers/ -> orquestan: piden al modelo, pintan la vista, manejan errores
//   core/        -> router por hash, cliente API, sesion, validacion, utilidades
import { anunciar, el, montar } from "./core/dom.js";
import { antes, iniciarRouter, navegar, noEncontrada, resolver, ruta, rutaActual } from "./core/router.js";
import { sesion } from "./core/sesion.js";
import { cargarPatrones, patron } from "./core/validacion.js";
import * as compras from "./controllers/compras.controller.js";
import * as inventario from "./controllers/inventario.controller.js";
import * as productos from "./controllers/productos.controller.js";
import * as recursos from "./controllers/recurso.controller.js";
import * as reportes from "./controllers/reportes.controller.js";
import * as seguridad from "./controllers/seguridad.controller.js";
import { tablero } from "./controllers/tablero.controller.js";
import * as ventas from "./controllers/ventas.controller.js";
import { AuthModelo } from "./models/auth.model.js";
import { alerta, encabezado } from "./views/componentes.js";
import { marcarMenu, vistaLogin, vistaMenu, vistaUsuario } from "./views/layout.view.js";

const app = document.getElementById("app");
const contenido = document.getElementById("contenido");
const menu = document.getElementById("menu");
const contenidoMenu = document.getElementById("contenidoMenu");
const botonMenu = document.getElementById("botonMenu");
const zonaUsuario = document.getElementById("zonaUsuario");

// ---------------------------------------------------------------- Tema claro/oscuro
const botonTema = document.getElementById("botonTema");
function pintarTema() {
    const oscuro = document.documentElement.getAttribute("data-bs-theme") === "dark";
    botonTema.setAttribute("aria-pressed", String(oscuro));
    botonTema.textContent = oscuro ? "Tema claro" : "Tema oscuro";
}
botonTema.addEventListener("click", () => {
    const oscuro = document.documentElement.getAttribute("data-bs-theme") !== "dark";
    document.documentElement.setAttribute("data-bs-theme", oscuro ? "dark" : "light");
    try {
        window.localStorage.setItem("ce_admin_tema", oscuro ? "dark" : "light");
    } catch {
        /* sin almacenamiento: dura la visita */
    }
    pintarTema();
    anunciar(oscuro ? "Tema oscuro activado" : "Tema claro activado");
});
pintarTema();

// ---------------------------------------------------------------- Menu por permisos
// Arquitectura de informacion del menu (IHC):
//  - Las secciones van en el orden de USO: lo diario arriba (vender, productos,
//    inventario, compras), lo ocasional abajo (reportes, personas, seguridad).
//  - Cada seccion empieza por su tarea principal (Nueva venta, Productos...).
//  - Las tablas auxiliares (teléfonos, direcciones, provincias, unidades...)
//    se juntan en "Configuración": se tocan poco y antes llenaban cada seccion
//    con opciones que competian con las tareas reales (ley de Hick).
function menuDelUsuario(meta) {
    const p = (...permisos) => sesion.puede(...permisos);
    const generico = (ruta) => {
        const r = meta.recursos.find((x) => x.ruta === ruta);
        return r ? [{ ruta: `/r/${r.ruta}`, texto: r.titulo }] : [];
    };
    const enMenuPropio = new Set(["clientes", "proveedores", "empleados", "marcas", "categorias", "atributos", "valores-atributo", "descuentos-volumen"]);
    const configuracion = meta.recursos.filter((r) => !enMenuPropio.has(r.ruta)).map((r) => ({ ruta: `/r/${r.ruta}`, texto: r.titulo }));
    return [
        { titulo: "General", fijo: true, enlaces: [{ ruta: "/", texto: "Inicio" }] },
        {
            titulo: "Ventas",
            enlaces: [
                ...(p("VENTA_REGISTRAR") ? [{ ruta: "/ventas/nueva", texto: "Nueva venta en tienda" }] : []),
                { ruta: "/ventas", texto: "Pedidos" },
                { ruta: "/ventas/cobros", texto: "Cuentas por cobrar" },
                ...generico("clientes"),
            ],
        },
        {
            titulo: "Productos",
            enlaces: [
                { ruta: "/productos", texto: "Productos" },
                { ruta: "/ofertas", texto: "Ofertas" },
                { ruta: "/combos", texto: "Combos" },
                ...generico("descuentos-volumen"),
                ...generico("marcas"),
                ...generico("categorias"),
                ...generico("atributos"),
                ...generico("valores-atributo"),
            ],
        },
        { titulo: "Inventario", enlaces: [{ ruta: "/inventario", texto: "Inventario por producto" }] },
        {
            titulo: "Compras",
            enlaces: [
                { ruta: "/compras", texto: "Órdenes de compra" },
                { ruta: "/compras/comprobantes", texto: "Facturas de proveedores" },
                ...generico("proveedores"),
            ],
        },
        {
            titulo: "Reportes",
            enlaces: [
                { ruta: "/reportes", texto: "Tablero e indicadores" },
                ...["Ventas", "Clientes", "Inventario", "Compras", "Finanzas", "Seguridad"].map((c) => ({ ruta: `/reportes/categoria/${c}`, texto: `Reportes de ${c.toLowerCase()}` })),
            ],
        },
        { titulo: "Talento humano", enlaces: generico("empleados") },
        {
            titulo: "Seguridad",
            enlaces: [
                ...(p("USUARIO_GESTIONAR") ? [{ ruta: "/usuarios", texto: "Usuarios" }] : []),
                { ruta: "/roles", texto: "Roles y permisos" },
            ],
        },
        { titulo: "Configuración", enlaces: configuracion },
    ];
}

function mostrarMarco(meta) {
    app.classList.add("con-menu");
    menu.hidden = false;
    botonMenu.hidden = false;
    montar(contenidoMenu, vistaMenu(menuDelUsuario(meta)));
    marcarMenu(contenidoMenu, rutaActual()); // abre la seccion de la pagina actual
    montar(zonaUsuario, vistaUsuario(sesion.usuario, {
        alSalir: () => {
            sesion.cerrar({ motivo: "Cerraste la sesión." });
        },
    }));
}

function ocultarMarco() {
    app.classList.remove("con-menu");
    menu.hidden = true;
    botonMenu.hidden = true;
    montar(zonaUsuario);
    montar(contenidoMenu);
}

// En pantallas chicas el menu es un offcanvas: al elegir una seccion se cierra
contenidoMenu.addEventListener("click", (e) => {
    if (e.target.closest("a") && window.bootstrap) window.bootstrap.Offcanvas.getInstance(menu)?.hide();
});
window.addEventListener("admin:ruta", (e) => marcarMenu(contenidoMenu, e.detail));

// ---------------------------------------------------------------- Sesion
let listo = false;

async function cargarSesion() {
    const [perfil, meta] = await Promise.all([AuthModelo.perfil(), AuthModelo.meta()]);
    sesion.usuario = perfil;
    cargarPatrones(meta.patrones);
    recursos.fijarMeta(meta);
    mostrarMarco(meta);
    listo = true;
}

function mostrarIngreso() {
    ocultarMarco();
    listo = false;
    document.title = "Ingresar — Administración Comercial Elite";
    montar(contenido, vistaLogin({
        motivo: sesion.motivoCierre,
        patronCorreo: patron("correo") ?? { regex: /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/u, mensaje: "nombre@dominio.ec" },
        alIngresar: async (correo, clave) => {
            const { token, usuario } = await AuthModelo.ingresar(correo, clave);
            sesion.iniciar(token, usuario);
            sesion.motivoCierre = null;
            await cargarSesion();
            if (rutaActual() === "/ingresar") navegar("/");
            else await resolver();
        },
    }));
    window.requestAnimationFrame(() => document.getElementById("tituloVista")?.focus());
}

window.addEventListener("admin:sesion-cerrada", () => {
    mostrarIngreso();
    anunciar(sesion.motivoCierre ?? "La sesión se cerró.", { urgente: true });
});

// Toda ruta exige sesion
antes(async () => {
    if (!sesion.token) {
        mostrarIngreso();
        return false;
    }
    if (!listo) {
        try {
            await cargarSesion();
        } catch {
            sesion.cerrar({ motivo: "Tu sesión ya no es válida. Vuelve a ingresar." });
            return false;
        }
    }
    return true;
});

// ---------------------------------------------------------------- Rutas
ruta("/", tablero);
ruta("/mi-cuenta", seguridad.miCuenta);
ruta("/mi-clave", () => navegar("/mi-cuenta"));
ruta("/r/:recurso", recursos.lista);
ruta("/r/:recurso/:id", recursos.formulario);
ruta("/productos", productos.lista);
ruta("/productos/nuevo", productos.nuevo);
ruta("/productos/:id", productos.detalle);
ruta("/ofertas", productos.ofertas);
ruta("/combos", productos.combos);
ruta("/inventario", inventario.stock);
ruta("/inventario/producto/:id", inventario.producto);
ruta("/inventario/:idVariante", inventario.variante);
ruta("/compras", compras.ordenes);
ruta("/compras/nueva", compras.nueva);
ruta("/compras/comprobantes", compras.comprobantes);
ruta("/compras/:id", compras.orden);
ruta("/ventas", ventas.pedidos);
ruta("/ventas/nueva", ventas.nueva);
ruta("/ventas/cobros", ventas.cobros);
ruta("/ventas/:id", ventas.pedido);
ruta("/usuarios", seguridad.usuarios);
ruta("/roles", seguridad.roles);
ruta("/reportes", reportes.lista);
ruta("/reportes/categoria/:categoria", reportes.categoria);
ruta("/reportes/:nombre", reportes.reporte);
noEncontrada(({ ruta: r }) => {
    montar(contenido, encabezado({ titulo: "Página no encontrada" }),
        alerta("warning", `No existe la sección “${r}”.`),
        el("a", { href: "#/", class: "btn btn-primary" }, "Ir al inicio"));
});

iniciarRouter();
