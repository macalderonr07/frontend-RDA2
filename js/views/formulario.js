// js/views/formulario.js
// Formulario generico de VISTA a partir de la descripcion de campos que
// publica la API (GET /api/v1/meta): etiqueta, tipo, obligatorio, patron,
// maximo, ayuda y opciones. Valida con las MISMAS regex del servidor, al salir
// de cada campo y al enviar (resumen de errores enfocable), y marca en cada
// campo los errores que devuelva el servidor.
import { el } from "../core/dom.js";
import { aplicarErroresApi, mostrarResumen, normalizar, validarAlSalir, validarFormulario } from "../core/validacion.js";
import { campo, notaObligatorios, resumenErrores } from "./componentes.js";

const PATRON_POR_TIPO = {
    correo: "correo",
    telefono: "telefono",
    url: "url",
    entero: "entero",
    cantidad: "cantidad",
    dinero: "dinero",
    porcentaje: "porcentaje",
};
const NUMERICOS = new Set(["entero", "cantidad", "dinero", "porcentaje"]);

/** Cedula ecuatoriana (modulo 10): la misma verificacion que hace el servidor. */
export function cedulaValida(c) {
    if (!/^\d{10}$/.test(c)) return false;
    const provincia = Number(c.slice(0, 2));
    if (!((provincia >= 1 && provincia <= 24) || provincia === 30) || Number(c[2]) >= 6) return false;
    const suma = [...c.slice(0, 9)].reduce((s, d, i) => {
        let v = Number(d) * (i % 2 === 0 ? 2 : 1);
        if (v > 9) v -= 9;
        return s + v;
    }, 0);
    return (10 - (suma % 10)) % 10 === Number(c[9]);
}

function validarIdentificacion(valor, form, campoTipo) {
    const tipo = form.elements.namedItem(campoTipo)?.value;
    const v = valor.toUpperCase();
    if (tipo === "05") return cedulaValida(v) ? null : "La cédula no es válida (revisa los 10 dígitos y el dígito verificador).";
    if (tipo === "04") return /^\d{10}001$/.test(v) ? null : "El RUC tiene 13 dígitos y termina en 001.";
    if (tipo === "06") return /^[A-Z0-9]{5,20}$/.test(v) ? null : "Pasaporte: 5 a 20 letras o dígitos.";
    if (tipo === "07") return v === "9999999999999" ? null : "Consumidor final usa 9999999999999.";
    return null;
}

/** Regla de validacion de un campo descrito por /meta. */
export function reglaDeCampo(c) {
    return {
        etiqueta: c.etiqueta,
        requerido: c.requerido,
        patron: c.patron ?? PATRON_POR_TIPO[c.tipo] ?? (c.tipo === "texto" ? "texto" : null),
        max: c.max,
        tipo: c.tipo,
        validar: c.tipo === "identificacion" ? (v, form) => validarIdentificacion(v, form, c.campoTipo) : null,
    };
}

/** Lee los valores del formulario ya normalizados y con su tipo. */
export function leerDatos(form, campos) {
    const datos = {};
    for (const c of campos) {
        const control = form.elements.namedItem(c.nombre);
        if (!control || control.disabled || c.soloLectura) continue;
        if (c.tipo === "booleano") {
            datos[c.nombre] = control.checked ? 1 : 0;
            continue;
        }
        const v = normalizar(c.tipo === "identificacion" ? "codigo" : c.tipo, control.value);
        if (v === "") continue; // vacio = no se envia (el servidor conserva / usa su valor)
        datos[c.nombre] = NUMERICOS.has(c.tipo) ? Number(v) : v;
    }
    return datos;
}

/**
 * Construye el formulario.
 *  campos: descripcion de /meta (+ opciones ya cargadas para seleccion)
 *  valores: datos actuales (edicion) o {}
 *  alEnviar(datos): Promise; si lanza ErrorApi, sus detalles se marcan en los campos
 */
export function formulario({ campos, valores = {}, alEnviar, textoEnviar = "Guardar", alCancelar = null, deshabilitados = [] }) {
    const reglas = new Map();
    const resumen = resumenErrores();
    const visibles = campos.filter((c) => !c.soloLectura);
    // Campos automaticos (codigos): se muestran, pero no se escriben ni se envian
    const automaticos = campos
        .filter((c) => c.automatico)
        .map((c) => campo({ ...c, requerido: false, lectura: true, tipo: "texto", valor: valores[c.nombre] ?? "Se genera al guardar" }));
    const nodosCampos = visibles.map((c) => {
        if (c.tipo !== "booleano") reglas.set(c.nombre, reglaDeCampo(c));
        return campo({
            ...c,
            valor: valores[c.nombre] ?? (c.tipo === "booleano" && valores[c.nombre] === undefined ? 1 : undefined),
            deshabilitado: deshabilitados.includes(c.nombre),
            tipo: c.tipo === "identificacion" ? "texto" : c.tipo,
        });
    });
    const boton = el("button", { type: "submit", class: "btn btn-primary" }, textoEnviar);
    const form = el("form", { novalidate: true, class: "formulario-admin" },
        resumen,
        notaObligatorios(),
        el("div", { class: "grilla-form" }, automaticos, nodosCampos),
        el("div", { class: "d-flex flex-wrap gap-2 mt-2" },
            boton,
            alCancelar ? el("button", { type: "button", class: "btn btn-outline-secondary", onclick: alCancelar }, "Cancelar") : null));
    validarAlSalir(form, reglas);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errores = validarFormulario(form, reglas);
        if (errores.length > 0) {
            mostrarResumen(resumen, errores);
            return;
        }
        mostrarResumen(resumen, []);
        boton.disabled = true;
        boton.setAttribute("aria-busy", "true");
        try {
            await alEnviar(leerDatos(form, visibles), form);
        } catch (error) {
            aplicarErroresApi(form, resumen, error);
        } finally {
            boton.disabled = false;
            boton.removeAttribute("aria-busy");
        }
    });
    return { form, resumen, reglas };
}
