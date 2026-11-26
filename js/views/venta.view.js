// js/views/venta.view.js
// VISTAS de la venta de mostrador:
//  - formularioCliente: alta de un cliente sin salir de la venta (datos de
//    facturacion y direccion opcionales; consumidor final en un clic);
//  - formularioDireccion: direccion de entrega (obligatoria si es pedido a domicilio);
//  - dialogoProducto: especificar lo que se vende de un producto en UN ingreso:
//      * cuero por bandas: lista de bandas, cada una "completa" o "media banda";
//      * lo demas: una fila por talla / color / corte con su cantidad
//        (varias tallas de suelas o plantillas, o plancha + 2 pies de fibra).
import { anunciar, el, formato, montar, nuevoId } from "../core/dom.js";
import { aplicarErroresApi, marcarCampo, mostrarResumen, validarValor } from "../core/validacion.js";
import { cedulaValida } from "./formulario.js";
import { alerta, campo, dialogo, resumenErrores, envolverOrdenable } from "./componentes.js";

const TIPOS_ID = [
    { valor: "05", etiqueta: "Cédula" },
    { valor: "04", etiqueta: "RUC" },
    { valor: "06", etiqueta: "Pasaporte" },
];

function errorIdentificacion(tipo, v) {
    const x = String(v ?? "").trim().toUpperCase();
    if (!x) return "Escribe la identificación.";
    if (tipo === "05") return cedulaValida(x) ? null : "La cédula no es válida (revisa los 10 dígitos y el dígito verificador).";
    if (tipo === "04") return /^\d{10}001$/.test(x) ? null : "El RUC tiene 13 dígitos y termina en 001.";
    if (tipo === "06") return /^[A-Z0-9]{5,20}$/.test(x) ? null : "Pasaporte: 5 a 20 letras o dígitos.";
    return "Elige el tipo de identificación.";
}

// Sectores sugeridos por ciudad: el controlador inyecta la funcion que los
// trae de la API (la vista no habla con los modelos).
let cargarSectores = async () => [];
export function usarSectores(fn) {
    cargarSectores = fn;
}

/** Sector: se escribe (con sugerencias de los ya registrados en la ciudad); si no existe, se crea. */
function campoSector(prefijo, ayuda = "Barrio. Si no está en la lista, se registra al guardar.") {
    const lista = nuevoId("sectores");
    const nodo = campo({ nombre: `${prefijo}sector`, etiqueta: "Sector", requerido: true, max: 80, ayuda });
    nodo.querySelector("input").setAttribute("list", lista);
    nodo.append(el("datalist", { id: lista }));
    return nodo;
}
/** Al elegir la ciudad, sugiere sus sectores. */
function conectarSectores(form, prefijo) {
    const ciudad = form.elements.namedItem(`${prefijo}idCiudad`);
    const sector = form.elements.namedItem(`${prefijo}sector`);
    if (!ciudad || !sector) return;
    // se busca dentro del form: puede que aun no este en la pagina
    const datalist = form.querySelector(`datalist[id="${sector.getAttribute("list")}"]`);
    const llenar = async () => {
        const id = Number(ciudad.value);
        const sectores = id ? await cargarSectores(id).catch(() => []) : [];
        montar(datalist, ...sectores.map((s) => el("option", { value: s.nombre })));
    };
    ciudad.addEventListener("change", llenar);
    llenar();
}
function validarSector(form, errores, prefijo) {
    const c = form.elements.namedItem(`${prefijo}sector`);
    const m = validarValor(c.value.trim(), { etiqueta: "Sector", requerido: true, patron: "nombre", max: 80 });
    marcarCampo(c, m);
    if (m) errores.push({ control: c, mensaje: m });
}

/** Campos de direccion (dentro de un fieldset). prefijo evita choques de nombre. */
function camposDireccion(ciudades, prefijo = "dir_") {
    return [
        campo({ nombre: `${prefijo}idCiudad`, etiqueta: "Ciudad", tipo: "seleccion", requerido: true, opciones: ciudades }),
        campoSector(prefijo),
        campo({ nombre: `${prefijo}callePrincipal`, etiqueta: "Calle principal", requerido: true, max: 120 }),
        campo({ nombre: `${prefijo}numero`, etiqueta: "Número", max: 15 }),
        campo({ nombre: `${prefijo}calleSecundaria`, etiqueta: "Calle secundaria", max: 120 }),
        el("div", { class: "ancho-completo" }, campo({ nombre: `${prefijo}referencia`, etiqueta: "Referencia", max: 200, ayuda: "Ej. frente al parque, casa azul" })),
    ];
}
function leerDireccion(form, prefijo = "dir_") {
    const v = (n) => form.elements.namedItem(`${prefijo}${n}`)?.value.trim() ?? "";
    const d = { idCiudad: Number(v("idCiudad")) || null, sector: v("sector"), callePrincipal: v("callePrincipal") };
    for (const n of ["numero", "calleSecundaria", "referencia"]) if (v(n)) d[n] = v(n);
    return d;
}
function validarDireccion(form, errores, prefijo = "dir_") {
    const ciudad = form.elements.namedItem(`${prefijo}idCiudad`);
    const calle = form.elements.namedItem(`${prefijo}callePrincipal`);
    const m1 = ciudad.value ? null : "Elige la ciudad.";
    const m2 = validarValor(calle.value, { etiqueta: "Calle principal", requerido: true, patron: "nombre", max: 120 });
    marcarCampo(ciudad, m1);
    marcarCampo(calle, m2);
    if (m1) errores.push({ control: ciudad, mensaje: m1 });
    validarSector(form, errores, prefijo);
    if (m2) errores.push({ control: calle, mensaje: m2 });
}

/**
 * Alta de cliente. sugerido: texto que se busco (si son digitos, va a la
 * identificacion; si no, al nombre). alGuardar(datos) -> Promise<ficha>.
 */
export function formularioCliente({ ciudades, sugerido = "", requiereDireccion = false, alGuardar }) {
    const resumen = resumenErrores();
    const esNumero = /^\d{5,13}$/.test(sugerido.trim());
    const idFact = nuevoId("fact");
    const radiosFact = [
        ["ninguno", "Todavía no (nota de venta)"],
        ["consumidor", "Consumidor final"],
        ["identificado", "Con cédula, RUC o pasaporte"],
    ];
    const zonaIdentificacion = el("div", { class: "grilla-form", hidden: !esNumero },
        campo({ nombre: "idTipoIdentificacion", etiqueta: "Tipo de identificación", tipo: "seleccion", requerido: true, opciones: TIPOS_ID, valor: esNumero && sugerido.trim().length === 13 ? "04" : "05" }),
        campo({ nombre: "identificacion", etiqueta: "Identificación", requerido: true, max: 20, valor: esNumero ? sugerido.trim() : "" }),
        campo({ nombre: "razonSocial", etiqueta: "A nombre de (razón social)", requerido: true, max: 150, ayuda: "Como debe salir en la factura" }),
        campo({ nombre: "correoFactura", etiqueta: "Correo para la factura", tipo: "correo", max: 120 }),
        // sector obligatorio en la factura (la direccion no)
        campo({ nombre: "fac_idCiudad", etiqueta: "Ciudad", tipo: "seleccion", requerido: true, opciones: ciudades }),
        campoSector("fac_"));
    const fsFact = el("fieldset", { class: "mb-3" },
        el("legend", { class: "form-label fs-6 fw-semibold" }, "Datos de facturación"),
        radiosFact.map(([v, t]) => {
            const id = `${idFact}-${v}`;
            return el("div", { class: "form-check" },
                el("input", { class: "form-check-input", type: "radio", name: "facturacion", id, value: v, checked: v === (esNumero ? "identificado" : "ninguno"),
                    onchange: () => { zonaIdentificacion.hidden = v !== "identificado"; } }),
                el("label", { class: "form-check-label", for: id }, t));
        }),
        zonaIdentificacion);
    const conDir = nuevoId("con-dir");
    const zonaDireccion = el("div", { class: "grilla-form", hidden: !requiereDireccion }, camposDireccion(ciudades));
    const casillaDir = el("input", { class: "form-check-input", type: "checkbox", id: conDir, checked: requiereDireccion, disabled: requiereDireccion,
        onchange: (e) => { zonaDireccion.hidden = !e.target.checked; } });
    const boton = el("button", { type: "submit", class: "btn btn-primary" }, "Crear cliente y usarlo");
    const form = el("form", { novalidate: true },
        resumen,
        el("div", { class: "grilla-form" },
            campo({ nombre: "nombres", etiqueta: "Nombres o nombre del negocio", requerido: true, max: 100, valor: esNumero ? "" : sugerido.trim() }),
            campo({ nombre: "apellidos", etiqueta: "Apellidos", max: 100 }),
            campo({ nombre: "telefono", etiqueta: "Teléfono", tipo: "telefono", ayuda: "09XXXXXXXX" }),
            campo({ nombre: "correo", etiqueta: "Correo", tipo: "correo", max: 120 })),
        fsFact,
        el("div", { class: "form-check mb-2" }, casillaDir,
            el("label", { class: "form-check-label", for: conDir }, requiereDireccion ? "Dirección de entrega (obligatoria: es un pedido a domicilio)" : "Agregar dirección (opcional en el local)")),
        zonaDireccion,
        el("div", { class: "d-flex flex-wrap gap-2 mt-3" }, boton));

    conectarSectores(form, "fac_");
    conectarSectores(form, "dir_");
    // la razon social se propone con el nombre
    form.elements.namedItem("nombres").addEventListener("change", () => {
        const rs = form.elements.namedItem("razonSocial");
        if (!rs.value) rs.value = [form.elements.namedItem("nombres").value, form.elements.namedItem("apellidos").value].filter(Boolean).join(" ").trim();
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errores = [];
        const marcar = (nombre, mensaje) => {
            const c = form.elements.namedItem(nombre);
            marcarCampo(c, mensaje);
            if (mensaje) errores.push({ control: c, mensaje });
        };
        const v = (n) => form.elements.namedItem(n).value.trim();
        marcar("nombres", validarValor(v("nombres"), { etiqueta: "Nombres", requerido: true, patron: "nombre", max: 100 }));
        marcar("apellidos", validarValor(v("apellidos"), { etiqueta: "Apellidos", patron: "nombrePersona", max: 100 }));
        marcar("telefono", v("telefono") ? validarValor(v("telefono"), { etiqueta: "Teléfono", patron: "telefono", tipo: "telefono" }) : null);
        marcar("correo", v("correo") ? validarValor(v("correo"), { etiqueta: "Correo", patron: "correo", tipo: "correo" }) : null);
        const modo = form.elements.namedItem("facturacion").value;
        if (modo === "identificado") {
            marcar("identificacion", errorIdentificacion(v("idTipoIdentificacion"), v("identificacion")));
            marcar("razonSocial", validarValor(v("razonSocial"), { etiqueta: "Razón social", requerido: true, patron: "nombre", max: 150 }));
            marcar("correoFactura", v("correoFactura") ? validarValor(v("correoFactura"), { etiqueta: "Correo", patron: "correo", tipo: "correo" }) : null);
            marcar("fac_idCiudad", v("fac_idCiudad") ? null : "Elige la ciudad del sector.");
            validarSector(form, errores, "fac_");
        }
        const usarDir = casillaDir.checked;
        if (usarDir) validarDireccion(form, errores);
        if (errores.length) return mostrarResumen(resumen, errores);
        mostrarResumen(resumen, []);
        const datos = { nombres: v("nombres") };
        if (v("apellidos")) datos.apellidos = v("apellidos");
        if (v("telefono")) datos.telefono = v("telefono").replace(/[\s()-]/g, "");
        if (v("correo")) datos.correo = v("correo").toLowerCase();
        if (modo === "consumidor") datos.facturacion = { consumidorFinal: true };
        if (modo === "identificado") {
            datos.facturacion = { idTipoIdentificacion: v("idTipoIdentificacion"), identificacion: v("identificacion").toUpperCase(), razonSocial: v("razonSocial"),
                idCiudad: Number(v("fac_idCiudad")), sector: v("fac_sector") };
            if (v("correoFactura")) datos.facturacion.correo = v("correoFactura").toLowerCase();
        }
        if (usarDir) datos.direccion = leerDireccion(form);
        boton.disabled = true;
        try {
            await alGuardar(datos);
        } catch (error) {
            // los campos anidados del servidor (facturacion.identificacion) se marcan por su nombre corto
            aplicarErroresApi(form, resumen, { ...error, message: error.message, detalles: (error.detalles ?? []).map((d) => ({ ...d, campo: d.campo?.split(".").pop() })) });
        } finally {
            boton.disabled = false;
        }
    });
    return form;
}

/** Datos de facturacion nuevos para un cliente que ya existe (la primera vez que pide factura). */
export function formularioFacturacion({ nombreSugerido = "", direcciones = [], ciudades = [], alGuardar }) {
    const resumen = resumenErrores();
    const boton = el("button", { type: "submit", class: "btn btn-primary" }, "Guardar y usar");
    const form = el("form", { novalidate: true }, resumen,
        el("div", { class: "grilla-form" },
            campo({ nombre: "idTipoIdentificacion", etiqueta: "Tipo de identificación", tipo: "seleccion", requerido: true, opciones: TIPOS_ID, valor: "05" }),
            campo({ nombre: "identificacion", etiqueta: "Identificación", requerido: true, max: 20 }),
            campo({ nombre: "razonSocial", etiqueta: "A nombre de (razón social)", requerido: true, max: 150, valor: nombreSugerido }),
            campo({ nombre: "correo", etiqueta: "Correo para la factura", tipo: "correo", max: 120 }),
            direcciones.length
                ? campo({ nombre: "idDireccion", etiqueta: "Dirección (opcional)", tipo: "seleccion", opciones: direcciones.map((d) => ({ valor: d.id, etiqueta: d.etiqueta })),
                    ayuda: "Si eliges una, el sector sale de ella" })
                : null,
            // sector obligatorio (la direccion no): se pide si no se eligio direccion
            campo({ nombre: "fac_idCiudad", etiqueta: "Ciudad", tipo: "seleccion", requerido: true, opciones: ciudades }),
            campoSector("fac_")),
        el("div", { class: "d-flex flex-wrap gap-2 mt-2" }, boton));
    conectarSectores(form, "fac_");
    const zonaSector = [form.elements.namedItem("fac_idCiudad"), form.elements.namedItem("fac_sector")].map((c) => c.closest(".mb-3"));
    const conDireccion = () => Boolean(form.elements.namedItem("idDireccion")?.value);
    form.elements.namedItem("idDireccion")?.addEventListener("change", () => zonaSector.forEach((z) => { z.hidden = conDireccion(); }));
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errores = [];
        const v = (n) => form.elements.namedItem(n)?.value.trim() ?? "";
        const marcar = (n, m) => {
            const c = form.elements.namedItem(n);
            marcarCampo(c, m);
            if (m) errores.push({ control: c, mensaje: m });
        };
        marcar("identificacion", errorIdentificacion(v("idTipoIdentificacion"), v("identificacion")));
        marcar("razonSocial", validarValor(v("razonSocial"), { etiqueta: "Razón social", requerido: true, patron: "nombre", max: 150 }));
        marcar("correo", v("correo") ? validarValor(v("correo"), { etiqueta: "Correo", patron: "correo", tipo: "correo" }) : null);
        if (!conDireccion()) {
            marcar("fac_idCiudad", v("fac_idCiudad") ? null : "Elige la ciudad del sector.");
            validarSector(form, errores, "fac_");
        }
        if (errores.length) return mostrarResumen(resumen, errores);
        mostrarResumen(resumen, []);
        boton.disabled = true;
        try {
            await alGuardar({
                idTipoIdentificacion: v("idTipoIdentificacion"),
                identificacion: v("identificacion").toUpperCase(),
                razonSocial: v("razonSocial"),
                ...(v("correo") ? { correo: v("correo").toLowerCase() } : {}),
                ...(v("idDireccion") ? { idDireccion: Number(v("idDireccion")) } : { idCiudad: Number(v("fac_idCiudad")), sector: v("fac_sector") }),
            });
        } catch (error) {
            aplicarErroresApi(form, resumen, error);
        } finally {
            boton.disabled = false;
        }
    });
    return form;
}

/** Direccion nueva de un cliente (entrega a domicilio). */
export function formularioDireccion({ ciudades, alGuardar }) {
    const resumen = resumenErrores();
    const boton = el("button", { type: "submit", class: "btn btn-primary" }, "Guardar dirección");
    const form = el("form", { novalidate: true }, resumen, el("div", { class: "grilla-form" }, camposDireccion(ciudades, "")),
        el("div", { class: "d-flex flex-wrap gap-2 mt-2" }, boton));
    conectarSectores(form, "");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errores = [];
        validarDireccion(form, errores, "");
        if (errores.length) return mostrarResumen(resumen, errores);
        mostrarResumen(resumen, []);
        boton.disabled = true;
        try {
            await alGuardar(leerDireccion(form, ""));
        } catch (error) {
            aplicarErroresApi(form, resumen, error);
        } finally {
            boton.disabled = false;
        }
    });
    return form;
}

// ------------------------------------------------------------------ Producto
const describir = (v) => Object.entries(v.caracteristicas).map(([k, x]) => (k === "Color" ? x : `${k} ${x}`)).join(" · ");
const aCuartos = (n) => Math.floor(n * 4 + 1e-9) / 4;

/**
 * Dialogo para especificar un producto. p: detalle de /ventas/productos/:id.
 * alAgregar([{ forma, variante, cantidad, idLote?, pieza? }]) recibe TODAS las
 * lineas del ingreso (una por banda, talla o corte).
 */
export function dialogoProducto({ p, alAgregar }) {
    const resumen = resumenErrores();
    const cuerpo = el("div");
    const subtotal = el("p", { class: "fw-semibold mb-0", role: "status", "aria-live": "polite" });
    const atributos = p.atributos.filter((a) => a.valores.length > 1);
    // el primer atributo con varios valores (casi siempre Color) se elige arriba;
    // el resto (Talla) va en filas, para vender varias tallas de una vez
    const esBandaPre = (f) => /banda/i.test(f.descripcion);
    const hayBandas = p.ventaPorPieza && !p.cortesEstandar && p.variantes.some((v) => v.piezas.length > 0);
    // con UN solo atributo variable (solo tallas), todas sus variantes van en filas;
    // en el cuero por bandas se elige el color arriba y se listan sus bandas
    const principal = atributos.length > 1 || (hayBandas && atributos.length) ? atributos[0] : null;
    let valorPrincipal = principal ? (principal.valores.find((x) => p.variantes.some((v) => v.caracteristicas[principal.nombre] === x && v.formas.some((f) => f.disponible > 0))) ?? principal.valores[0]) : null;
    const variantesActuales = () => p.variantes.filter((v) => !principal || v.caracteristicas[principal.nombre] === valorPrincipal);
    const esBanda = (f) => /banda/i.test(f.descripcion);
    const porBandas = p.ventaPorPieza && !p.cortesEstandar && p.variantes.some((v) => v.piezas.length > 0);
    let modo = porBandas ? "bandas" : "filas";

    const filas = []; // { control, forma, variante, pieza?, tipo }

    function pintarSubtotal() {
        const total = filas.reduce((s, f) => s + (f.cantidad() || 0) * f.forma.precio, 0);
        const n = filas.filter((f) => f.cantidad() > 0).length;
        subtotal.textContent = n ? `${n} línea${n === 1 ? "" : "s"} · subtotal referencial ${formato.dinero(total)} con IVA` : "Marca o escribe lo que se vende.";
    }

    // ---- Cuero: lista de bandas, cada una completa o media
    function pintarBandas() {
        const v = variantesActuales()[0];
        const banda = v.formas.find(esBanda);
        const detal = v.formas.find((f) => !esBanda(f)) ?? banda;
        filas.length = 0;
        if (!v.piezas.length) {
            montar(cuerpo, alerta("info", "No hay bandas libres de este color."));
            return pintarSubtotal();
        }
        const lista = el("ul", { class: "list-group mb-2", "aria-label": `Bandas de ${describir(v) || p.nombre}` }, v.piezas.map((pz) => {
            const id = nuevoId("banda");
            const nombreRadio = nuevoId("tam");
            const media = aCuartos(pz.libre / 2);
            const casilla = el("input", { type: "checkbox", class: "form-check-input", id });
            const radios = ["completa", "media"].map((t) => {
                const idr = `${nombreRadio}-${t}`;
                return el("span", { class: "form-check form-check-inline mb-0" },
                    el("input", { type: "radio", class: "form-check-input", name: nombreRadio, id: idr, value: t, checked: t === "completa", disabled: true }),
                    el("label", { class: "form-check-label", for: idr }, t === "completa" ? `Completa (${formato.numero(pz.libre)})` : `Media (${formato.numero(media)})`));
            });
            const fila = {
                variante: v,
                pieza: pz,
                get forma() {
                    const cant = this.cantidad();
                    // la media banda que no llega al minimo de "precio banda" va al detal
                    return banda && cant >= banda.cantidadMinima ? banda : detal;
                },
                cantidad: () => {
                    if (!casilla.checked) return 0;
                    return lista.querySelector(`input[name="${nombreRadio}"]:checked`)?.value === "media" ? media : pz.libre;
                },
                control: casilla,
            };
            filas.push(fila);
            const nota = el("span", { class: "d-block small text-body-secondary" });
            const actualizar = () => {
                radios.forEach((r) => (r.querySelector("input").disabled = !casilla.checked));
                const cant = fila.cantidad();
                nota.textContent = casilla.checked
                    ? `${formato.numero(cant)} pie² a ${formato.dinero(fila.forma.precio)} (${fila.forma.descripcion}) = ${formato.dinero(cant * fila.forma.precio)}`
                    : "";
                pintarSubtotal();
            };
            casilla.addEventListener("change", actualizar);
            radios.forEach((r) => r.querySelector("input").addEventListener("change", actualizar));
            return el("li", { class: "list-group-item" },
                el("div", { class: "d-flex flex-wrap align-items-center gap-3" },
                    el("span", { class: "form-check mb-0" }, casilla,
                        el("label", { class: "form-check-label fw-semibold", for: id }, `Banda ${pz.codigo ?? pz.idLote}`, ` · ${formato.numero(pz.libre)} pie² libres`)),
                    el("span", { role: "radiogroup", "aria-label": `Tamaño de la banda ${pz.codigo ?? pz.idLote}` }, radios)),
                nota);
        }));
        montar(cuerpo, 
            el("p", { class: "small text-body-secondary" }, `Marca las bandas y elige si van completas o en media banda. Precio banda: ${formato.dinero(banda?.precio)} por pie² (desde ${formato.numero(banda?.cantidadMinima)} pie²); si la media banda no llega, se cobra al detal (${formato.dinero(detal?.precio)}).`),
            lista);
        pintarSubtotal();
    }

    // ---- Lo demas: una fila por talla / color / corte, con su cantidad
    function pintarFilas() {
        filas.length = 0;
        const vs = variantesActuales();
        const filasDatos = vs.flatMap((v) => v.formas.map((f) => ({ v, f })))
            .filter(({ f }) => !(porBandas && esBanda(f))); // por pie2: solo el detal
        const multiForma = new Set(filasDatos.map(({ f }) => f.descripcion)).size > 1;
        const multiVariante = vs.length > 1;
        const etiqueta = ({ v, f }) => {
            // sin el atributo elegido arriba ni los que tienen un solo valor (ya se informan)
            const fijos = new Set([principal?.nombre, ...p.atributos.filter((a) => a.valores.length === 1).map((a) => a.nombre)]);
            const resto = Object.entries(v.caracteristicas).filter(([k]) => !fijos.has(k)).map(([k, x]) => (k === "Color" ? x : `${k} ${x}`)).join(" · ");
            return [multiVariante || !multiForma ? resto || describir(v) : null, multiForma ? f.descripcion : null].filter(Boolean).join(" · ") || f.descripcion;
        };
        const tabla = el("table", { class: "table align-middle mb-2" },
            el("caption", { class: "visually-hidden" }, "Cantidades a vender"),
            el("thead", {}, el("tr", {}, ["Qué", "Precio con IVA", "Disponible", "Cantidad"].map((t) => el("th", { scope: "col" }, t)))),
            el("tbody", {}, filasDatos.map(({ v, f }) => {
                const id = nuevoId("cant");
                const idError = `${id}-error`;
                const agotada = f.disponible <= 0;
                // spinner: sube y baja de a "incremento" (1 = enteros; 0.25 = cuartos de pie2)
                const entero = Number.isInteger(f.incremento);
                const input = el("input", { id, type: "number", class: "form-control form-control-sm", min: 0, max: f.disponible, step: f.incremento,
                    inputmode: entero ? "numeric" : "decimal", placeholder: "0", disabled: agotada,
                    "aria-describedby": idError, dataset: { error: idError }, style: "max-width: 8rem" });
                const fila = { variante: v, forma: f, cantidad: () => Number(String(input.value).replace(",", ".")) || 0, control: input };
                filas.push(fila);
                input.addEventListener("input", pintarSubtotal);
                const nombre = etiqueta({ v, f });
                return el("tr", {},
                    el("th", { scope: "row", class: "fw-normal" }, nombre, f.pctOferta ? el("span", { class: "d-block small" }, `Oferta ${f.pctOferta} %`) : null),
                    el("td", {}, formato.dinero(f.precio), el("span", { class: "d-block small text-body-secondary" }, f.incremento !== 1 || f.cantidadMinima !== 1 ? `mín. ${formato.numero(f.cantidadMinima)}, de ${formato.numero(f.incremento)} en ${formato.numero(f.incremento)}` : "")),
                    el("td", {}, agotada ? "Agotado" : formato.numero(f.disponible)),
                    el("td", {}, el("label", { class: "visually-hidden", for: id }, `Cantidad de ${nombre}`), input,
                        el("div", { id: idError, class: "invalid-feedback", "aria-live": "polite" })));
            })));
        montar(cuerpo, 
            p.cortesEstandar ? el("p", { class: "small text-body-secondary" }, "Cada unidad es un corte fijo; la base corta la plancha al registrar. Fracciones de plancha y pies son dos formas de medida que no se mezclan.") : null,
            envolverOrdenable(tabla, { "aria-label": "Cantidades a vender (desplazable)" }));
        pintarSubtotal();
    }

    const pintar = () => (modo === "bandas" ? pintarBandas() : pintarFilas());

    const controles = [];
    if (principal) {
        const sel = campo({ nombre: "principal", etiqueta: principal.nombre, tipo: "seleccion", requerido: true,
            opciones: principal.valores.map((x) => {
                const hay = p.variantes.some((v) => v.caracteristicas[principal.nombre] === x && (v.formas.some((f) => f.disponible > 0) || v.piezas.length));
                return { valor: x, etiqueta: hay ? x : `${x} (agotado)` };
            }), valor: valorPrincipal });
        sel.querySelector("select").addEventListener("change", (e) => { valorPrincipal = e.target.value; pintar(); });
        controles.push(sel);
    }
    for (const a of p.atributos.filter((x) => x.valores.length === 1)) controles.push(el("p", { class: "mb-2" }, el("span", { class: "fw-semibold" }, `${a.nombre}: `), a.valores[0]));
    if (porBandas) {
        const nombre = nuevoId("modo");
        controles.push(el("fieldset", { class: "mb-3" }, el("legend", { class: "form-label fs-6 fw-semibold" }, "¿Cómo se vende?"),
            [["bandas", "Por bandas (completa o media)"], ["filas", "Por pie² (corte al detal)"]].map(([v, t]) => {
                const id = `${nombre}-${v}`;
                return el("div", { class: "form-check form-check-inline" },
                    el("input", { class: "form-check-input", type: "radio", name: nombre, id, value: v, checked: v === modo, onchange: () => { modo = v; pintar(); } }),
                    el("label", { class: "form-check-label", for: id }, t));
            })));
    }

    let d;
    const form = el("form", { novalidate: true },
        resumen,
        el("p", { class: "text-body-secondary" }, [p.codigo, p.categoria, p.unidad ? `inventario en ${p.unidad.toLowerCase()}` : null].filter(Boolean).join(" · ")),
        controles, cuerpo, subtotal,
        el("div", { class: "d-flex flex-wrap gap-2 mt-3" },
            el("button", { type: "submit", class: "btn btn-primary" }, "Agregar a la venta"),
            el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => d.cerrar() }, "Cancelar")));

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const errores = [];
        const elegidas = filas.filter((f) => f.cantidad() > 0);
        for (const f of filas) {
            if (modo === "bandas") continue;
            const c = f.cantidad();
            const crudo = f.control.value.trim();
            let m = null;
            const entero = Number.isInteger(f.forma.incremento);
            if (crudo && (f.control.validity.badInput || !/^\d+([.,]\d{1,3})?$/.test(crudo))) m = entero ? "Escribe una cantidad entera (ej. 2)." : "Escribe un número (ej. 2 o 2,25).";
            else if (entero && !Number.isInteger(c)) m = `${f.forma.descripcion} se vende en cantidades enteras.`;
            else if (c > 0 && c < f.forma.cantidadMinima) m = `La compra mínima es ${formato.numero(f.forma.cantidadMinima)}.`;
            else if (c > 0 && Math.abs(c / f.forma.incremento - Math.round(c / f.forma.incremento)) > 1e-9) m = `Se vende de ${formato.numero(f.forma.incremento)} en ${formato.numero(f.forma.incremento)}.`;
            else if (c > f.forma.disponible) m = `Solo hay ${formato.numero(f.forma.disponible)} disponibles.`;
            marcarCampo(f.control, m);
            if (m) errores.push({ control: f.control, mensaje: m });
        }
        if (!errores.length && !elegidas.length) {
            errores.push({ control: filas[0]?.control ?? null, mensaje: modo === "bandas" ? "Marca al menos una banda." : "Escribe la cantidad de al menos una talla o forma de venta." });
        }
        if (errores.length) return mostrarResumen(resumen, errores);
        alAgregar(elegidas.map((f) => ({
            forma: f.forma,
            variante: f.variante,
            cantidad: f.cantidad(),
            idLote: f.pieza?.idLote ?? null,
            detalle: [describir(f.variante), f.pieza ? `banda ${f.pieza.codigo ?? f.pieza.idLote}${f.cantidad() < f.pieza.libre ? " (media)" : " (completa)"}` : null].filter(Boolean).join(" · "),
        })));
        d.cerrar();
        anunciar(`${elegidas.length} línea${elegidas.length === 1 ? "" : "s"} de ${p.nombre} agregada${elegidas.length === 1 ? "" : "s"} a la venta`);
    });

    pintar();
    d = dialogo({ titulo: `Agregar ${p.nombre}`, contenido: form, grande: true });
    return d;
}
