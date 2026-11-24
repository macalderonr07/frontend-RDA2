// js/core/router.js
// Router por hash (#/productos/12?pagina=2): no necesita configuracion del
// servidor y el boton Atras del navegador funciona. Cada ruta tiene un patron
// y un controlador, que recibe los parametros de la ruta y la consulta
// (params.consulta, un URLSearchParams). La vista mueve el foco a su titulo.
const rutas = [];

export function ruta(patron, controlador) {
    // "/productos/:id" -> /^\/productos\/([^/]+)$/ con nombres de parametro
    const nombres = [];
    const regex = new RegExp(
        `^${patron.replace(/\//g, "\\/").replace(/:([a-zA-Z]+)/g, (_, n) => {
            nombres.push(n);
            return "([^/]+)";
        })}$`
    );
    rutas.push({ regex, nombres, controlador });
}

export function navegar(destino) {
    if (window.location.hash === `#${destino}`) resolver();
    else window.location.hash = destino;
}

/** Ruta sin la consulta: "/ventas" para "#/ventas?estado=PEN". */
export function rutaActual() {
    return (window.location.hash.replace(/^#/, "") || "/").split("?")[0];
}

export function consultaActual() {
    return new URLSearchParams(window.location.hash.split("?")[1] ?? "");
}

let alNoEncontrar = null;
export function noEncontrada(controlador) {
    alNoEncontrar = controlador;
}

let antesDeResolver = null;
/** Gancho que corre antes de cada navegacion (p. ej. exigir sesion). Devuelve false para cortar. */
export function antes(fn) {
    antesDeResolver = fn;
}

export async function resolver() {
    const actual = rutaActual();
    if (antesDeResolver && (await antesDeResolver(actual)) === false) return;
    for (const r of rutas) {
        const m = actual.match(r.regex);
        if (m) {
            const params = Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
            params.consulta = consultaActual();
            await r.controlador(params);
            window.dispatchEvent(new CustomEvent("admin:ruta", { detail: actual }));
            return;
        }
    }
    if (alNoEncontrar) await alNoEncontrar({ ruta: actual });
    window.dispatchEvent(new CustomEvent("admin:ruta", { detail: actual }));
}

export function iniciarRouter() {
    window.addEventListener("hashchange", resolver);
    return resolver();
}
