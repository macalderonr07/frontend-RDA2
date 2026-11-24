// js/controllers/seguridad.controller.js
// CONTROLADOR de usuarios, roles y cambio de la propia clave.
import { anunciar, el, formato, montar, nuevoId } from "../core/dom.js";
import { sesion } from "../core/sesion.js";
import { aplicarErroresApi, marcarCampo, mostrarResumen, validarValor } from "../core/validacion.js";
import { AuthModelo } from "../models/auth.model.js";
import { SeguridadModelo } from "../models/negocio.model.js";
import { ordenServidor, paramsOrden, alerta, campo, cargando, confirmar, dialogo, encabezado, insignia, notaObligatorios, paginacion, resumenErrores, tabla, zonaAlertas } from "../views/componentes.js";
import { cedulaValida } from "../views/formulario.js";

const contenido = () => document.getElementById("contenido");

/** Casillas de roles dentro de un fieldset con leyenda (grupo accesible). */
function casillasRoles(roles, marcados = []) {
    const idError = nuevoId("roles-error");
    const fieldset = el("fieldset", { class: "mb-3", "aria-describedby": idError },
        el("legend", { class: "form-label fs-6" }, "Roles", el("span", { class: "text-danger", "aria-hidden": "true" }, " *")),
        roles.map((r) => {
            const id = nuevoId("rol");
            return el("div", { class: "form-check" },
                el("input", { type: "checkbox", class: "form-check-input", id, name: "roles", value: r.codigo, checked: marcados.includes(r.codigo) }),
                el("label", { class: "form-check-label", for: id }, `${r.nombre} `, el("span", { class: "small text-body-secondary" }, `(${r.permisos.length} permisos)`)));
        }),
        el("div", { id: idError, class: "invalid-feedback d-block", "aria-live": "polite" }));
    return { fieldset, idError, leer: () => [...fieldset.querySelectorAll("input:checked")].map((x) => x.value) };
}

export async function usuarios() {
    if (!sesion.puede("USUARIO_GESTIONAR")) {
        montar(contenido(), encabezado({ titulo: "Usuarios" }), alerta("warning", "No tienes permiso para administrar usuarios."));
        return;
    }
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando usuarios…"));
    const roles = await SeguridadModelo.roles();
    const estado = { page: 1, q: "" };
    const idQ = nuevoId("q");

    async function pintar(mensaje) {
        let datos = { data: [], meta: null };
        try {
            datos = await SeguridadModelo.usuarios({ page: estado.page, limit: 20, q: estado.q, ...paramsOrden(estado) });
        } catch (error) {
            alertas.error(error);
        }
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: "Usuarios",
                descripcion: "Quién entra a la administración y con qué rol. Los usuarios no se borran: se desactivan (la auditoría los referencia).",
                acciones: [el("button", { type: "button", class: "btn btn-primary", onclick: () => editar(null) }, "Nuevo usuario")],
            }),
            alertas.nodo,
            el("form", { role: "search", "aria-label": "Buscar usuarios", class: "barra-lista", onsubmit: (e) => { e.preventDefault(); estado.q = new FormData(e.currentTarget).get("q").trim(); estado.page = 1; pintar(); } },
                el("div", {}, el("label", { class: "form-label", for: idQ }, "Buscar por correo"), el("input", { id: idQ, name: "q", type: "search", class: "form-control", value: estado.q })),
                el("div", {}, el("button", { type: "submit", class: "btn btn-outline-primary w-100" }, "Buscar"))),
            tabla({
                titulo: "Usuarios",
                filas: datos.data,
                orden: ordenServidor(estado, pintar),
                vacio: "No hay usuarios.",
                columnas: [
                    { titulo: "Correo", valor: (u) => u.correo, clave: "correo" },
                    { titulo: "Empleado", clave: "empleado", valor: (u) => u.empleado ?? el("span", { class: "text-body-secondary" }, "Sin ficha") },
                    { titulo: "Roles", clave: "roles", valor: (u) => u.roles.map((r) => r.nombre).join(", ") },
                    { titulo: "Último acceso", valor: (u) => formato.fechaHora(u.ultimoAcceso), clave: "ultimoAcceso" },
                    { titulo: "Estado", clave: "activo", valor: (u) => (u.activo ? insignia("Activo", "success") : insignia("Inactivo", "secondary")) },
                ],
                acciones: (u) => [
                    el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-label": `Editar ${u.correo}`, onclick: () => editar(u) }, "Editar"),
                    el("button", { type: "button", class: "btn btn-sm btn-outline-secondary", "aria-label": `Restablecer la clave de ${u.correo}`, onclick: () => restablecer(u) }, "Clave"),
                ],
            }),
            paginacion(datos.meta, (n) => { estado.page = n; pintar(); })));
        if (mensaje) alertas.exito(mensaje);
    }

    function editar(u) {
        const resumen = resumenErrores();
        const grupo = casillasRoles(roles, u?.roles.map((r) => r.codigo) ?? []);
        const campos = u
            ? [campo({ nombre: "activo", etiqueta: "Activo (puede ingresar)", tipo: "booleano", valor: u.activo ? 1 : 0, deshabilitado: u.idUsuario === sesion.usuario.idUsuario, ayuda: u.idUsuario === sesion.usuario.idUsuario ? "No puedes desactivar tu propio usuario." : null })]
            : [
                  // el usuario NO se escribe: sigue el estandar (2 letras del nombre + primer apellido)
                  el("div", { class: "grilla-form" },
                      campo({ nombre: "nombres", etiqueta: "Nombres", requerido: true, max: 100 }),
                      campo({ nombre: "apellidos", etiqueta: "Apellidos", requerido: true, max: 100 }),
                      campo({ nombre: "idTipoIdentificacion", etiqueta: "Tipo de identificación", tipo: "opciones", requerido: true, opciones: [{ valor: "05", etiqueta: "Cédula" }, { valor: "06", etiqueta: "Pasaporte" }], valor: "05" }),
                      campo({ nombre: "identificacion", etiqueta: "Identificación", requerido: true, max: 20 }),
                      campo({ nombre: "fechaIngreso", etiqueta: "Fecha de ingreso", tipo: "fecha" })),
                  campo({ nombre: "usuarioGenerado", etiqueta: "Usuario (correo)", lectura: true, valor: "Se forma con el nombre y el apellido",
                      ayuda: "Estándar: dos primeras letras del nombre + primer apellido (ej. José Pérez → joperez@comercialelite.ec)." }),
                  campo({ nombre: "clave", etiqueta: "Clave inicial", requerido: true, ayuda: "10+ caracteres con mayúscula, minúscula y número. Compártela por un canal seguro." }),
              ];
        let d;
        const form = el("form", { novalidate: true }, resumen, notaObligatorios(), campos, grupo.fieldset,
            el("div", { class: "d-flex gap-2" }, el("button", { type: "submit", class: "btn btn-primary" }, u ? "Guardar" : "Crear usuario"),
                el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => d.cerrar() }, "Cancelar")));
        // vista previa del usuario estandar mientras se escribe el nombre
        if (!u) {
            const previa = async () => {
                const n = form.elements.namedItem("nombres").value.trim();
                const a = form.elements.namedItem("apellidos").value.trim();
                const destino = form.elements.namedItem("usuarioGenerado");
                if (!n || !a) return;
                try {
                    destino.value = (await SeguridadModelo.correoSugerido(n, a)).correo ?? "Escribe nombre y apellido con letras";
                } catch {
                    /* la vista previa es solo ayuda */
                }
            };
            form.elements.namedItem("nombres").addEventListener("change", previa);
            form.elements.namedItem("apellidos").addEventListener("change", previa);
        }
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const errores = [];
            if (!u) {
                const tipoId = form.elements.namedItem("idTipoIdentificacion").value;
                for (const [n, regla] of [
                    ["nombres", { etiqueta: "Nombres", requerido: true, patron: "nombrePersona" }],
                    ["apellidos", { etiqueta: "Apellidos", requerido: true, patron: "nombrePersona" }],
                    ["identificacion", { etiqueta: "Identificación", requerido: true, validar: (v) => (tipoId === "05" && !cedulaValida(v) ? "La cédula no es válida (revisa el dígito verificador)." : tipoId === "06" && !/^[A-Z0-9]{5,20}$/i.test(v) ? "Pasaporte: 5 a 20 letras o dígitos." : null) }],
                    ["clave", { etiqueta: "Clave", requerido: true, patron: "clave" }]]) {
                    const c = form.elements.namedItem(n);
                    const m = validarValor(c.value, regla, form);
                    marcarCampo(c, m);
                    if (m) errores.push({ control: c, mensaje: m });
                }
            }
            const elegidos = grupo.leer();
            document.getElementById(grupo.idError).textContent = elegidos.length ? "" : "Elige al menos un rol.";
            if (!elegidos.length) errores.push({ control: grupo.fieldset.querySelector("input"), mensaje: "Elige al menos un rol." });
            if (errores.length) return mostrarResumen(resumen, errores);
            try {
                if (u) {
                    const activo = form.elements.namedItem("activo");
                    await SeguridadModelo.actualizar(u.idUsuario, { roles: elegidos, ...(activo.disabled ? {} : { activo: activo.checked ? 1 : 0 }) });
                } else {
                    const v = (n) => form.elements.namedItem(n).value.trim();
                    const creado = await SeguridadModelo.crear({
                        nombres: v("nombres"), apellidos: v("apellidos"), idTipoIdentificacion: v("idTipoIdentificacion"), identificacion: v("identificacion").toUpperCase(),
                        ...(v("fechaIngreso") ? { fechaIngreso: v("fechaIngreso") } : {}),
                        clave: form.elements.namedItem("clave").value, roles: elegidos,
                    });
                    u = null;
                    d.cerrar();
                    await pintar(`Usuario ${creado.correo} creado con su ficha de empleado.`);
                    return;
                }
                d.cerrar();
                await pintar(u ? `Usuario ${u.correo} actualizado.` : "Usuario creado. Si va a vender, créale su ficha en Talento humano › Empleados.");
            } catch (error) {
                aplicarErroresApi(form, resumen, error);
            }
        });
        d = dialogo({ titulo: u ? `Editar ${u.correo}` : "Nuevo usuario", contenido: form, grande: !u });
        d.abrir();
    }

    function restablecer(u) {
        const resumen = resumenErrores();
        let d;
        const form = el("form", { novalidate: true }, resumen,
            campo({ nombre: "clave", etiqueta: "Clave nueva", requerido: true, ayuda: "10+ caracteres con mayúscula, minúscula y número." }),
            el("div", { class: "d-flex gap-2" }, el("button", { type: "submit", class: "btn btn-primary" }, "Restablecer"), el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => d.cerrar() }, "Cancelar")));
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const c = form.elements.namedItem("clave");
            const m = validarValor(c.value, { etiqueta: "Clave", requerido: true, patron: "clave" });
            marcarCampo(c, m);
            if (m) return mostrarResumen(resumen, [{ control: c, mensaje: m }]);
            try {
                await SeguridadModelo.restablecerClave(u.idUsuario, c.value);
                d.cerrar();
                await pintar(`Clave de ${u.correo} restablecida.`);
            } catch (error) {
                aplicarErroresApi(form, resumen, error);
            }
        });
        d = dialogo({ titulo: `Restablecer la clave de ${u.correo}`, contenido: form });
        d.abrir();
    }
    await pintar();
}

/**
 * Roles y permisos EDITABLES: crear un rol, cambiar su nombre y sus permisos
 * (casillas agrupadas por area) o eliminarlo si nadie lo tiene. El codigo del
 * rol es automatico. Protecciones: SISTEMA (usuario tecnico de la base) no se
 * toca y ADMIN conserva el permiso de gestionar usuarios.
 */
export async function roles() {
    const alertas = zonaAlertas();
    montar(contenido(), cargando("Cargando roles…"));
    const puedeEditar = sesion.puede("USUARIO_GESTIONAR");
    const area = (codigo) => ({ CATALOGO: "Catálogo", PRECIO: "Precios", INV: "Inventario", COMPRA: "Compras", VENTA: "Ventas", PAGO: "Cobros", PEDIDO: "Despacho",
        CREDITO: "Crédito", USUARIO: "Usuarios", AUDITORIA: "Auditoría", SRI: "SRI" })[codigo.split("_")[0]] ?? "Otros";

    async function pintar(mensaje) {
        let lista;
        let todos = [];
        try {
            [lista, todos] = await Promise.all([SeguridadModelo.roles(), puedeEditar ? SeguridadModelo.permisos() : Promise.resolve([])]);
        } catch (error) {
            montar(contenido(), encabezado({ titulo: "Roles y permisos" }), alerta("danger", error.message));
            return;
        }
        montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
            encabezado({
                titulo: "Roles y permisos",
                descripcion: "Lo que puede hacer cada rol. La base vuelve a exigir el permiso en cada operación.",
                acciones: puedeEditar ? [el("button", { type: "button", class: "btn btn-primary", onclick: () => editar(null, todos) }, "Nuevo rol")] : [],
            }),
            alertas.nodo,
            el("div", { class: "grilla-form" }, lista.map((r) => {
                const id = nuevoId("rol");
                return el("section", { class: "card mb-3", "aria-labelledby": id },
                    el("div", { class: "card-body" },
                        el("h2", { class: "h5", id }, r.nombre, " ", el("span", { class: "small text-body-secondary" }, `(${r.codigo})`)),
                        el("ul", { class: "mb-2" }, r.permisos.map((p) => el("li", {}, p.descripcion))),
                        r.protegido
                            ? el("p", { class: "small text-body-secondary mb-0" }, "Rol técnico de la base: no se modifica.")
                            : puedeEditar
                              ? el("div", { class: "d-flex flex-wrap gap-2" },
                                    el("button", { type: "button", class: "btn btn-sm btn-outline-primary", "aria-label": `Editar el rol ${r.nombre}`, onclick: () => editar(r, todos) }, "Editar permisos"),
                                    r.codigo !== "ADMIN" ? el("button", { type: "button", class: "btn btn-sm btn-outline-danger", "aria-label": `Eliminar el rol ${r.nombre}`, onclick: () => eliminar(r) }, "Eliminar") : null)
                              : null));
            }))));
        if (mensaje) alertas.exito(mensaje);
    }

    function editar(r, todos) {
        const resumen = resumenErrores();
        const marcados = new Set(r?.permisos.map((p) => p.codigo) ?? []);
        const grupos = new Map();
        for (const p of todos) {
            const a = area(p.codigo);
            if (!grupos.has(a)) grupos.set(a, []);
            grupos.get(a).push(p);
        }
        const idError = nuevoId("permisos-error");
        const fieldset = el("fieldset", { class: "mb-3", "aria-describedby": idError },
            el("legend", { class: "form-label fs-6 fw-semibold" }, "Permisos", el("span", { class: "text-danger", "aria-hidden": "true" }, " *")),
            [...grupos].map(([a, ps]) => el("div", { class: "mb-2" },
                el("p", { class: "small fw-semibold text-body-secondary mb-1" }, a),
                ps.map((p) => {
                    const id = nuevoId("perm");
                    const bloqueado = r?.codigo === "ADMIN" && p.codigo === "USUARIO_GESTIONAR";
                    return el("div", { class: "form-check" },
                        el("input", { type: "checkbox", class: "form-check-input", id, name: "permisos", value: p.codigo, checked: marcados.has(p.codigo), disabled: bloqueado }),
                        el("label", { class: "form-check-label", for: id }, p.descripcion, bloqueado ? " (obligatorio para ADMIN)" : ""));
                }))),
            el("div", { id: idError, class: "invalid-feedback d-block", "aria-live": "polite" }));
        let d;
        const form = el("form", { novalidate: true }, resumen, notaObligatorios(),
            campo({ nombre: "nombre", etiqueta: "Nombre del rol", requerido: true, max: 60, valor: r?.nombre ?? "", ayuda: r ? `Código: ${r.codigo}` : "El código se genera solo a partir del nombre." }),
            fieldset,
            el("div", { class: "d-flex gap-2" }, el("button", { type: "submit", class: "btn btn-primary" }, r ? "Guardar" : "Crear rol"),
                el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => d.cerrar() }, "Cancelar")));
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const errores = [];
            const nombre = form.elements.namedItem("nombre");
            const m = validarValor(nombre.value, { etiqueta: "Nombre del rol", requerido: true, patron: "nombre", max: 60 });
            marcarCampo(nombre, m);
            if (m) errores.push({ control: nombre, mensaje: m });
            const elegidos = [...form.querySelectorAll("input[name=permisos]")].filter((x) => x.checked).map((x) => x.value);
            document.getElementById(idError).textContent = elegidos.length ? "" : "Marca al menos un permiso.";
            if (!elegidos.length) errores.push({ control: fieldset.querySelector("input"), mensaje: "Marca al menos un permiso." });
            if (errores.length) return mostrarResumen(resumen, errores);
            try {
                if (r) await SeguridadModelo.actualizarRol(r.codigo, { nombre: nombre.value.trim(), permisos: elegidos });
                else await SeguridadModelo.crearRol({ nombre: nombre.value.trim(), permisos: elegidos });
                d.cerrar();
                await pintar(r ? `Rol ${r.nombre} actualizado. Los usuarios con este rol tienen los permisos nuevos desde su próxima acción.` : "Rol creado.");
            } catch (error) {
                aplicarErroresApi(form, resumen, error);
            }
        });
        d = dialogo({ titulo: r ? `Permisos del rol ${r.nombre}` : "Nuevo rol", contenido: form, grande: true });
        d.abrir();
    }

    async function eliminar(r) {
        if (!(await confirmar({ titulo: "Eliminar rol", mensaje: `¿Eliminar el rol «${r.nombre}»? Solo se puede si ningún usuario lo tiene.`, textoConfirmar: "Eliminar", peligro: true }))) return;
        try {
            await SeguridadModelo.eliminarRol(r.codigo);
            await pintar(`Rol ${r.nombre} eliminado.`);
        } catch (error) {
            alertas.error(error);
        }
    }
    await pintar();
}

/**
 * Mi cuenta: datos de la sesion y, PLEGADO, el cambio de clave. Medidas:
 *  - pide la clave actual (una sesion abierta en un equipo ajeno no basta);
 *  - tras 5 intentos fallidos el servidor bloquea el cambio y cierra la sesion;
 *  - la clave nueva cumple la politica, no repite la actual ni contiene el correo;
 *  - al cambiarla, TODAS las sesiones (este y otros equipos) se cierran: el
 *    token lleva una huella de la clave y deja de valer.
 */
export function miCuenta() {
    const alertas = zonaAlertas();
    const u = sesion.usuario;
    const resumen = resumenErrores();
    const reglas = [
        { prueba: (v) => v.length >= 10 && v.length <= 64, texto: "De 10 a 64 caracteres" },
        { prueba: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v), texto: "Mayúsculas y minúsculas" },
        { prueba: (v) => /\d/.test(v), texto: "Al menos un número" },
        { prueba: (v) => v !== "" && !/\s/.test(v), texto: "Sin espacios" },
        { prueba: (v) => { const l = u.correo.split("@")[0].toLowerCase(); return v !== "" && (l.length < 4 || !v.toLowerCase().includes(l)); }, texto: "Que no contenga tu correo" },
    ];
    const idReglas = nuevoId("reglas");
    const listaReglas = el("ul", { id: idReglas, class: "list-unstyled small mb-3" });
    const pintarReglas = (v) =>
        montar(listaReglas, ...reglas.map((r) => {
            const ok = r.prueba(v);
            // el estado va en TEXTO (no solo en color ni en el icono)
            return el("li", { class: ok ? "text-success-emphasis" : "text-body-secondary" }, ok ? "✓ Cumple: " : "• Falta: ", r.texto);
        }));
    pintarReglas("");

    const form = el("form", { novalidate: true, id: "formClave", hidden: true, class: "mt-3" }, resumen, notaObligatorios(),
        campo({ nombre: "claveActual", etiqueta: "Clave actual", requerido: true }),
        campo({ nombre: "claveNueva", etiqueta: "Clave nueva", requerido: true }),
        listaReglas,
        campo({ nombre: "repetir", etiqueta: "Repite la clave nueva", requerido: true }),
        el("div", { class: "form-check mb-3" },
            el("input", { type: "checkbox", class: "form-check-input", id: "verClaves" }),
            el("label", { class: "form-check-label", for: "verClaves" }, "Mostrar las claves")),
        el("p", { class: "small" }, "Al cambiarla se cerrará tu sesión en todos los equipos y tendrás que ingresar con la clave nueva."),
        el("div", { class: "d-flex flex-wrap gap-2" },
            el("button", { type: "submit", class: "btn btn-primary" }, "Cambiar clave"),
            el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => plegar(false) }, "Cancelar")));
    const [actual, nueva, repetir] = ["claveActual", "claveNueva", "repetir"].map((n) => form.elements.namedItem(n));
    for (const c of [actual, nueva, repetir]) {
        c.type = "password";
        c.autocomplete = c === actual ? "current-password" : "new-password";
        c.maxLength = 64;
    }
    nueva.setAttribute("aria-describedby", `${nueva.getAttribute("aria-describedby")} ${idReglas}`);
    nueva.addEventListener("input", () => pintarReglas(nueva.value));
    form.querySelector("#verClaves").addEventListener("change", (e) => {
        for (const c of [actual, nueva, repetir]) c.type = e.target.checked ? "text" : "password";
    });

    const abrir = el("button", { type: "button", class: "btn btn-outline-primary", "aria-expanded": "false", "aria-controls": "formClave" }, "Cambiar mi clave");
    function plegar(mostrar) {
        form.hidden = !mostrar;
        abrir.setAttribute("aria-expanded", String(mostrar));
        if (mostrar) actual.focus();
        else {
            form.reset();
            pintarReglas("");
            mostrarResumen(resumen, []);
            abrir.focus();
        }
    }
    abrir.addEventListener("click", () => plegar(form.hidden));

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errores = [];
        const m1 = validarValor(actual.value, { etiqueta: "Clave actual", requerido: true });
        let m2 = validarValor(nueva.value, { etiqueta: "Clave nueva", requerido: true, patron: "clave" });
        if (!m2 && nueva.value === actual.value) m2 = "La clave nueva debe ser distinta de la actual.";
        if (!m2 && !reglas[4].prueba(nueva.value)) m2 = "La clave no debe contener tu correo.";
        const m3 = repetir.value !== nueva.value ? "Las claves nuevas no coinciden." : null;
        [[actual, m1], [nueva, m2], [repetir, m3]].forEach(([c, m]) => { marcarCampo(c, m); if (m) errores.push({ control: c, mensaje: m }); });
        if (errores.length) return mostrarResumen(resumen, errores);
        mostrarResumen(resumen, []);
        try {
            await AuthModelo.cambiarClave(actual.value, nueva.value);
            form.reset();
            sesion.cerrar({ motivo: "Tu clave se cambió y se cerró la sesión en todos tus equipos. Ingresa con la clave nueva." });
        } catch (error) {
            if (error.status === 429) {
                sesion.cerrar({ motivo: error.message });
                return;
            }
            aplicarErroresApi(form, resumen, error);
        }
    });

    montar(contenido(), el("section", { "aria-labelledby": "tituloVista" },
        encabezado({ titulo: "Mi cuenta", descripcion: "Tus datos de acceso y la seguridad de tu cuenta." }),
        alertas.nodo,
        el("div", { class: "card mb-4 col-lg-8" }, el("div", { class: "card-body" },
            el("h2", { class: "h5" }, "Datos de la sesión"),
            el("dl", { class: "row mb-0" },
                el("dt", { class: "col-sm-4" }, "Nombre"), el("dd", { class: "col-sm-8" }, u.nombre),
                el("dt", { class: "col-sm-4" }, "Correo"), el("dd", { class: "col-sm-8" }, u.correo),
                el("dt", { class: "col-sm-4" }, "Roles"), el("dd", { class: "col-sm-8" }, u.roles.map((r) => r.nombre).join(", ") || "—"),
                el("dt", { class: "col-sm-4" }, "Último ingreso"), el("dd", { class: "col-sm-8" }, formato.fechaHora(u.ultimoAcceso))))),
        el("section", { class: "card col-lg-8", "aria-labelledby": "tituloSeguridad" }, el("div", { class: "card-body" },
            el("h2", { class: "h5", id: "tituloSeguridad" }, "Seguridad"),
            el("p", {}, "Cambiar la clave pide tu clave actual. Si alguien deja tu sesión abierta, no podrá cambiarla sin conocerla; tras 5 intentos fallidos se cierra la sesión."),
            abrir,
            form))));
}

/** Ruta vieja: lleva a Mi cuenta. */
export const miClave = miCuenta;
