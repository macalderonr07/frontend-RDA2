// js/models/auth.model.js — MODELO de sesion y metadatos.
import { api } from "../core/api.js";

export const AuthModelo = {
    ingresar: (correo, clave) => api.post("/auth/ingresar", { correo, clave }).then((r) => r.data),
    perfil: () => api.get("/auth/yo").then((r) => r.data),
    cambiarClave: (claveActual, claveNueva) => api.put("/auth/clave", { claveActual, claveNueva }),
    /** Patrones de validacion y descripcion de recursos (formularios genericos). */
    meta: () => api.get("/meta").then((r) => r.data),
};
