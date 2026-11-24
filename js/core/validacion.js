// js/core/validacion.js
// Validacion de formularios con expresiones regulares. Los patrones NO estan
// escritos aqui: vienen de GET /api/v1/meta (los mismos que aplica el
// servidor), asi el mensaje que ve el usuario es exactamente la regla real.
//
// Accesibilidad (WCAG 2.2: 3.3.1 identificacion de errores, 3.3.3
// sugerencia, 4.1.2 nombre/rol/valor):
//  - cada campo invalido lleva aria-invalid="true" y su mensaje esta enlazado
//    con aria-describedby (junto con la ayuda del campo);
//  - al enviar con errores aparece un RESUMEN (role="alert") con un enlace
//    por error que lleva al campo, y el foco va al resumen.
import { el, montar } from "./dom.js";

let patrones = {};

export function cargarPatrones(desdeMeta) {
    patrones = Object.fromEntries(
        Object.entries(desdeMeta).map(([nombre, p]) => [nombre, { regex: new RegExp(p.fuente, "u"), mensaje: p.mensaje }])
    );
}

export const patron = (nombre) => patrones[nombre];

/** Normalizaciones previas a validar (las mismas del servidor). */
export function normalizar(tipo, valor) {
    let v = String(valor ?? "").trim();
    if (tipo === "correo") v = v.toLowerCase();
    if (tipo === "telefono") v = v.replace(/[\s()-]/g, "");
    if (tipo === "codigo") v = v.toUpperCase();
    return v;
}

/**
 * regla: { etiqueta, requerido, patron, max, tipo, validar?(valor, form) -> mensaje|null }
 * Devuelve el mensaje de error o null.
 */
export function validarValor(valor, regla, form) {
    const v = normalizar(regla.tipo, valor);
    if (v === "") return regla.requerido ? `${regla.etiqueta} es obligatorio.` : null;
    if (regla.max && v.length > regla.max) return `${regla.etiqueta}: hasta ${regla.max} caracteres.`;
    const p = regla.patron ? patrones[regla.patron] : null;
    if (p && !p.regex.test(v)) return `${regla.etiqueta}: ${p.mensaje}.`;
    if (regla.validar) return regla.validar(v, form);
    return null;
}

/** Marca (o limpia) el error de un control. El <span> de error ya existe en el DOM. */
export function marcarCampo(control, mensaje) {
    const idError = control.dataset.error;
    const error = idError ? document.getElementById(idError) : null;
    if (mensaje) {
        control.setAttribute("aria-invalid", "true");
        control.classList.add("is-invalid");
        if (error) error.textContent = mensaje;
    } else {
        control.removeAttribute("aria-invalid");
        control.classList.remove("is-invalid");
        if (error) error.textContent = "";
    }
}

/**
 * Valida todos los controles del form que tengan regla (Map nombre -> regla).
 * Devuelve [{ control, mensaje }].
 */
export function validarFormulario(form, reglas) {
    const errores = [];
    for (const [nombre, regla] of reglas) {
        const control = form.elements.namedItem(nombre);
        if (!control || control.disabled) continue;
        const valor = control.type === "checkbox" ? (control.checked ? "1" : "") : control.value;
        const mensaje = control.type === "checkbox" ? null : validarValor(valor, regla, form);
        marcarCampo(control, mensaje);
        if (mensaje) errores.push({ control, mensaje });
    }
    return errores;
}

/** Resumen de errores enfocable con enlaces a cada campo. */
export function mostrarResumen(contenedor, errores, titulo = "Revisa estos datos antes de continuar:") {
    if (errores.length === 0) {
        contenedor.hidden = true;
        montar(contenedor);
        return;
    }
    montar(
        contenedor,
        el("p", { class: "fw-bold mb-1" }, titulo),
        el(
            "ul",
            { class: "mb-0" },
            errores.map(({ control, mensaje }) =>
                el(
                    "li",
                    {},
                    control
                        ? el("a", {
                              href: `#${control.id}`,
                              class: "link-danger",
                              onclick: (e) => {
                                  e.preventDefault();
                                  control.focus();
                              },
                          }, mensaje)
                        : mensaje
                )
            )
        )
    );
    contenedor.hidden = false;
    contenedor.focus();
}

/**
 * Errores que devolvio la API ({ campo, mensaje }): se marcan en los campos que
 * existen y van todos al resumen. Si un campo no esta en el form, igual se lista.
 */
export function aplicarErroresApi(form, resumen, error) {
    const detalles = error.detalles?.length ? error.detalles : [{ campo: null, mensaje: error.message }];
    const errores = detalles.map((d) => {
        const nombre = d.campo?.split(/[.[]/)[0];
        const control = nombre ? form.elements.namedItem(nombre) : null;
        const real = control instanceof RadioNodeList ? null : control;
        if (real) marcarCampo(real, d.mensaje);
        return { control: real, mensaje: d.mensaje };
    });
    mostrarResumen(resumen, errores, error.detalles?.length ? "El servidor rechazó estos datos:" : "No se pudo guardar:");
}

/** Validacion al salir de cada campo (no mientras se escribe: no interrumpe). */
export function validarAlSalir(form, reglas) {
    form.addEventListener("focusout", (e) => {
        // Si el foco va al boton de enviar, valida el envio: mostrar aqui el error
        // desplazaria el boton entre el mousedown y el mouseup y el clic se perderia.
        if (e.relatedTarget?.type === "submit" && form.contains(e.relatedTarget)) return;
        const control = e.target;
        const regla = reglas.get(control.name);
        if (!regla || control.type === "checkbox") return;
        if (control.value === "" && !control.classList.contains("is-invalid")) return;
        marcarCampo(control, validarValor(control.value, regla, form));
    });
}
