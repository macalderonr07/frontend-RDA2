// js/core/api.js
// Base de la capa MODELO: un cliente fetch que habla JSON con la API de
// administracion. Agrega el token, aplica un tiempo limite y convierte
// cualquier fallo en un ErrorApi con mensaje en espanol y, si los hay, los
// errores por campo (detalles) para marcarlos en el formulario.
import { sesion } from "./sesion.js";

// URL de la API: js/config.js puede fijar window.ADMIN_API_URL (en GitHub Pages
// la escribe el workflow con la variable del repositorio). Sin ella, en local
// se usa el puerto 5070 del mismo equipo; publicado, no hay API que adivinar.
const EN_LOCAL = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API = window.ADMIN_API_URL
    ? String(window.ADMIN_API_URL).replace(/\/+$/, "")
    : EN_LOCAL ? `${window.location.protocol}//${window.location.hostname}:5070/api/v1` : null;
const ESPERA_MS = 15000;

export class ErrorApi extends Error {
    constructor(mensaje, { status = 0, detalles = [] } = {}) {
        super(mensaje);
        this.status = status;
        this.detalles = detalles; // [{ campo, mensaje }]
    }
}

/** Peticion JSON a la API. Devuelve { data, meta }. */
export async function pedir(ruta, { metodo = "GET", cuerpo, consulta } = {}) {
    if (!API) {
        throw new ErrorApi("Esta publicación no tiene configurada la dirección de la API de administración. Pide al responsable que defina ADMIN_API_URL.", { status: 0 });
    }
    const url = new URL(`${API}${ruta}`);
    for (const [k, v] of Object.entries(consulta ?? {})) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
    const control = new AbortController();
    const temporizador = window.setTimeout(() => control.abort(), ESPERA_MS);
    let respuesta;
    try {
        respuesta = await fetch(url, {
            method: metodo,
            signal: control.signal,
            headers: {
                Accept: "application/json",
                ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
                ...(sesion.token ? { Authorization: `Bearer ${sesion.token}` } : {}),
            },
            body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        });
    } catch (e) {
        throw new ErrorApi(
            e.name === "AbortError"
                ? "El servidor tardó demasiado en responder. Intenta de nuevo."
                : "No se pudo conectar con el servidor de administración. Revisa tu conexión."
        );
    } finally {
        window.clearTimeout(temporizador);
    }
    if (respuesta.status === 204) return { data: null, meta: null };
    const json = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
        // La sesion vencio o el usuario fue desactivado: se vuelve al ingreso
        if (respuesta.status === 401 && sesion.token) sesion.cerrar({ motivo: json?.message });
        throw new ErrorApi(json?.message ?? `Error ${respuesta.status}`, {
            status: respuesta.status,
            detalles: json?.detalles ?? [],
        });
    }
    return { data: json?.data ?? null, meta: json?.meta ?? null };
}

export const api = {
    get: (ruta, consulta) => pedir(ruta, { consulta }),
    post: (ruta, cuerpo) => pedir(ruta, { metodo: "POST", cuerpo }),
    put: (ruta, cuerpo) => pedir(ruta, { metodo: "PUT", cuerpo }),
    patch: (ruta, cuerpo) => pedir(ruta, { metodo: "PATCH", cuerpo }),
    delete: (ruta) => pedir(ruta, { metodo: "DELETE" }),
};
