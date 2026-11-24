// js/core/sesion.js
// Sesion del usuario, COMPARTIDA entre las pestanas y ventanas del navegador:
// el token vive en localStorage, asi que abrir otra ventana no pide ingresar
// de nuevo. Para que eso no deje una sesion abierta para siempre en el equipo:
//  - se cierra sola tras 30 minutos SIN ACTIVIDAD en ninguna pestana;
//  - cerrar sesion en una pestana la cierra en todas (evento "storage");
//  - el token vence igual en el servidor (JWT) y deja de valer si cambia la
//    clave o se desactiva el usuario (la API recarga el perfil en cada peticion).
// El perfil (roles y permisos) se pide a la API al entrar: aqui solo sirve
// para decidir que menus y botones mostrar.
const CLAVE = "ce_admin_token";
const ACTIVIDAD = "ce_admin_actividad";
export const INACTIVIDAD_MS = 30 * 60 * 1000;

const almacen = {
    leer(k) {
        try {
            return window.localStorage.getItem(k);
        } catch {
            return null;
        }
    },
    escribir(k, v) {
        try {
            window.localStorage.setItem(k, v);
        } catch {
            /* sin almacenamiento: la sesion dura lo que la pagina */
        }
    },
    borrar(k) {
        try {
            window.localStorage.removeItem(k);
        } catch {
            /* nada que borrar */
        }
    },
};

// Restos de la version anterior (sessionStorage): ya no se usan
try {
    window.sessionStorage.removeItem(CLAVE);
} catch {
    /* sin almacenamiento */
}

const vencidaPorInactividad = () => Date.now() - Number(almacen.leer(ACTIVIDAD) ?? 0) > INACTIVIDAD_MS;

function tokenInicial() {
    const token = almacen.leer(CLAVE);
    if (token && vencidaPorInactividad()) {
        almacen.borrar(CLAVE);
        almacen.borrar(ACTIVIDAD);
        return null;
    }
    return token;
}

export const sesion = {
    token: tokenInicial(),
    usuario: null,
    motivoCierre: null,

    iniciar(token, usuario) {
        this.token = token;
        this.usuario = usuario;
        almacen.escribir(ACTIVIDAD, String(Date.now()));
        almacen.escribir(CLAVE, token);
    },

    /** Marca actividad (como mucho una escritura cada 30 s). */
    actividad() {
        if (!this.token) return;
        const ultima = Number(almacen.leer(ACTIVIDAD) ?? 0);
        if (Date.now() - ultima > 30 * 1000) almacen.escribir(ACTIVIDAD, String(Date.now()));
    },

    cerrar({ motivo = null, soloEstaPestana = false } = {}) {
        this.token = null;
        this.usuario = null;
        this.motivoCierre = motivo;
        if (!soloEstaPestana) {
            almacen.borrar(CLAVE);
            almacen.borrar(ACTIVIDAD);
        }
        window.dispatchEvent(new CustomEvent("admin:sesion-cerrada"));
    },

    puede(...permisos) {
        const tiene = this.usuario?.permisos ?? [];
        return permisos.length === 0 || permisos.some((p) => tiene.includes(p));
    },
};

// Otra pestana cerro o abrio sesion
window.addEventListener("storage", (e) => {
    if (e.key !== CLAVE && e.key !== null) return;
    const token = almacen.leer(CLAVE);
    if (!token && sesion.token) sesion.cerrar({ motivo: "Se cerró la sesión en otra ventana.", soloEstaPestana: true });
    // ingreso en otra ventana: esta (que estaba en la pantalla de ingreso) entra tambien
    else if (token && !sesion.token) window.location.reload();
});

// Actividad del usuario y revision periodica de la inactividad
for (const evento of ["pointerdown", "keydown"]) {
    window.addEventListener(evento, () => sesion.actividad(), { passive: true });
}
window.setInterval(() => {
    if (sesion.token && vencidaPorInactividad()) {
        sesion.cerrar({ motivo: "La sesión se cerró tras 30 minutos sin actividad." });
    }
}, 60 * 1000);
