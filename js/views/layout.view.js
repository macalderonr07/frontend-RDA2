// js/views/layout.view.js
// VISTAS del marco de la aplicacion: menu lateral (por permisos), zona del
// usuario en la cabecera y pantalla de ingreso.
import { el, montar, nuevoId } from "../core/dom.js";
import { alerta, notaObligatorios, resumenErrores } from "./componentes.js";

/**
 * Menu por secciones PLEGABLES (patron acordeon): solo una seccion abierta a la
 * vez, la de la pagina actual, para no mostrar 30 opciones juntas. Cada
 * encabezado es un boton con aria-expanded; Inicio y Reportes quedan siempre
 * a la vista. Con teclado: Tab llega a cada encabezado, Enter/Espacio lo abre.
 */
export function vistaMenu(grupos) {
    const visibles = grupos.filter((g) => g.enlaces.length > 0);
    const enlace = (e) => el("li", {}, el("a", { href: `#${e.ruta}`, dataset: { ruta: e.ruta } }, e.texto));
    return visibles.map((g) => {
        if (g.fijo) return el("ul", { class: "menu-fijo" }, g.enlaces.map(enlace));
        const idLista = nuevoId("menu-lista");
        const boton = el("button", { type: "button", class: "menu-seccion", "aria-expanded": "false", "aria-controls": idLista },
            el("span", {}, g.titulo),
            el("span", { class: "menu-chevron", "aria-hidden": "true" }));
        const lista = el("ul", { id: idLista, hidden: true }, g.enlaces.map(enlace));
        boton.addEventListener("click", () => abrirSeccion(boton.closest(".menu-grupo"), boton.getAttribute("aria-expanded") !== "true"));
        return el("section", { class: "menu-grupo" }, el("h2", {}, boton), lista);
    });
}

/** Abre una seccion (y cierra las demas) o la cierra. */
function abrirSeccion(grupo, abrir) {
    if (!grupo) return;
    const contenedor = grupo.parentElement;
    for (const otro of contenedor.querySelectorAll(".menu-grupo")) {
        const abierta = abrir && otro === grupo;
        otro.querySelector(".menu-seccion").setAttribute("aria-expanded", String(abierta));
        otro.querySelector("ul").hidden = !abierta;
    }
}

/** Marca el enlace de la seccion actual (la mas especifica que coincida) y abre su seccion. */
export function marcarMenu(contenedor, rutaActual) {
    const enlaces = [...contenedor.querySelectorAll("a[data-ruta]")];
    let mejor = null;
    for (const a of enlaces) {
        const r = a.dataset.ruta;
        const coincide = r === "/" ? rutaActual === "/" : rutaActual === r || rutaActual.startsWith(`${r}/`);
        if (coincide && (!mejor || r.length > mejor.dataset.ruta.length)) mejor = a;
    }
    enlaces.forEach((a) => (a === mejor ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const grupo = mejor?.closest(".menu-grupo");
    if (grupo && grupo.querySelector(".menu-seccion").getAttribute("aria-expanded") !== "true") abrirSeccion(grupo, true);
}

export function vistaUsuario(usuario, { alSalir }) {
    return el("div", { class: "dropdown" },
        el("button", {
            type: "button",
            class: "btn btn-outline-light btn-sm dropdown-toggle",
            id: "menuCuenta",
            "aria-expanded": "false",
            dataset: { bsToggle: "dropdown" },
        }, el("span", { class: "visually-hidden" }, "Menú de la cuenta de "), usuario.nombre),
        el("ul", { class: "dropdown-menu dropdown-menu-end", "aria-labelledby": "menuCuenta" },
            el("li", {}, el("span", { class: "dropdown-item-text small text-body-secondary" }, usuario.roles.map((r) => r.nombre).join(", "))),
            el("li", {}, el("a", { class: "dropdown-item", href: "#/mi-cuenta" }, "Mi cuenta y seguridad")),
            el("li", {}, el("hr", { class: "dropdown-divider" })),
            el("li", {}, el("button", { type: "button", class: "dropdown-item", onclick: alSalir }, "Cerrar sesión"))));
}

/** Pantalla de ingreso. alIngresar(correo, clave) lanza ErrorApi si falla. */
export function vistaLogin({ motivo, patronCorreo, alIngresar }) {
    const idCorreo = nuevoId("correo");
    const idClave = nuevoId("clave");
    const errorCorreo = `${idCorreo}-error`;
    const errorClave = `${idClave}-error`;
    const resumen = resumenErrores();
    const correo = el("input", { id: idCorreo, name: "correo", type: "email", class: "form-control", autocomplete: "username", required: true, "aria-required": "true", "aria-describedby": errorCorreo, dataset: { error: errorCorreo } });
    const clave = el("input", { id: idClave, name: "clave", type: "password", class: "form-control", autocomplete: "current-password", required: true, "aria-required": "true", "aria-describedby": errorClave, dataset: { error: errorClave } });
    const mostrar = el("input", { type: "checkbox", class: "form-check-input", id: `${idClave}-ver` });
    mostrar.addEventListener("change", () => (clave.type = mostrar.checked ? "text" : "password"));
    const boton = el("button", { type: "submit", class: "btn btn-primary w-100" }, "Ingresar");
    const marcar = (control, mensaje) => {
        document.getElementById(control.dataset.error).textContent = mensaje ?? "";
        if (mensaje) {
            control.setAttribute("aria-invalid", "true");
            control.classList.add("is-invalid");
        } else {
            control.removeAttribute("aria-invalid");
            control.classList.remove("is-invalid");
        }
    };
    const form = el("form", { novalidate: true, "aria-labelledby": "tituloVista" },
        resumen,
        notaObligatorios(),
        el("div", { class: "mb-3" },
            el("label", { class: "form-label", for: idCorreo }, "Correo", el("span", { class: "text-danger", "aria-hidden": "true" }, " *")),
            correo,
            el("div", { id: errorCorreo, class: "invalid-feedback", "aria-live": "polite" })),
        el("div", { class: "mb-2" },
            el("label", { class: "form-label", for: idClave }, "Clave", el("span", { class: "text-danger", "aria-hidden": "true" }, " *")),
            clave,
            el("div", { id: errorClave, class: "invalid-feedback", "aria-live": "polite" })),
        el("div", { class: "form-check mb-3" }, mostrar, el("label", { class: "form-check-label", for: `${idClave}-ver` }, "Mostrar la clave")),
        boton);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const valorCorreo = correo.value.trim().toLowerCase();
        const errores = [];
        if (!valorCorreo) errores.push({ control: correo, mensaje: "Escribe tu correo." });
        else if (patronCorreo && !patronCorreo.regex.test(valorCorreo)) errores.push({ control: correo, mensaje: `Correo: ${patronCorreo.mensaje}.` });
        if (!clave.value) errores.push({ control: clave, mensaje: "Escribe tu clave." });
        marcar(correo, errores.find((x) => x.control === correo)?.mensaje);
        marcar(clave, errores.find((x) => x.control === clave)?.mensaje);
        if (errores.length) {
            montar(resumen, el("p", { class: "fw-bold mb-1" }, "Revisa estos datos:"),
                el("ul", { class: "mb-0" }, errores.map((x) => el("li", {}, el("a", { href: `#${x.control.id}`, class: "link-danger", onclick: (ev) => { ev.preventDefault(); x.control.focus(); } }, x.mensaje)))));
            resumen.hidden = false;
            resumen.focus();
            return;
        }
        resumen.hidden = true;
        boton.disabled = true;
        boton.setAttribute("aria-busy", "true");
        boton.textContent = "Ingresando…";
        try {
            await alIngresar(valorCorreo, clave.value);
        } catch (error) {
            montar(resumen, el("p", { class: "mb-0" }, error.message));
            resumen.hidden = false;
            resumen.focus();
            clave.value = "";
        } finally {
            boton.disabled = false;
            boton.removeAttribute("aria-busy");
            boton.textContent = "Ingresar";
        }
    });

    return el("section", { class: "login card shadow-sm" },
        el("div", { class: "card-body p-4" },
            el("h1", { class: "h3 mb-1", id: "tituloVista", tabindex: "-1" }, "Ingresar a la administración"),
            el("p", { class: "text-body-secondary" }, "Usa el correo y la clave que te asignó el administrador."),
            motivo ? alerta("warning", motivo) : null,
            form));
}
