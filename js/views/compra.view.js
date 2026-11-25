// js/views/compra.view.js
// VISTA del dialogo de compra: la misma logica que la venta (primero el
// producto, luego se especifica), pero con lo que importa al comprar: una fila
// por variante (talla, color...) con su stock, minimo, en camino, lo sugerido
// para llegar al minimo, la cantidad (spinner: enteros o decimales segun la
// unidad) y el costo sin IVA (viene el ultimo pagado).
import { anunciar, el, formato, montar, nombreCompra, nuevoId, plural } from "../core/dom.js";
import { marcarCampo, mostrarResumen } from "../core/validacion.js";
import { campo, dialogo, resumenErrores, envolverOrdenable } from "./componentes.js";

/** "1,1546" o "1.1546" -> 1.1546; NaN si no es un numero. */
export const aNumero = (texto) => {
    const s = String(texto ?? "").trim().replace(/\s/g, "");
    if (!/^\d+([.,]\d{1,4})?$/.test(s)) return Number.NaN;
    return Number(s.replace(",", "."));
};
const campoCosto = (id, valor, extra = {}) =>
    // texto con teclado decimal: acepta coma (un campo numerico la rechazaba en algunos navegadores)
    el("input", { id, type: "text", class: "form-control form-control-sm costo-compra", inputmode: "decimal", autocomplete: "off",
        value: valor === null || valor === undefined ? "" : String(valor).replace(".", ","), ...extra });

const describir = (v) => Object.entries(v.caracteristicas).map(([k, x]) => (k === "Color" ? x : `${k} ${x}`)).join(" · ");

/** alAgregar([{ variante, cantidad, costo, detalle }]) */
export function dialogoCompra({ p, alAgregar }) {
    const resumen = resumenErrores();
    const cuerpo = el("div");
    const subtotal = el("p", { class: "fw-semibold mb-0", role: "status", "aria-live": "polite" });
    const variables = p.atributos.filter((a) => a.valores.length > 1);
    const principal = variables.length > 1 ? variables[0] : null; // Color arriba si ademas hay tallas
    let valor = principal?.valores[0] ?? null;
    const filas = [];
    // UNIDAD DE COMPRA: con contenido fijo (Rollo × 30 m) se pide en rollos, enteros,
    // y el costo es por rollo; la orden se guarda en la unidad del inventario (m).
    const factor = p.compra?.factor ?? null;
    const unidadCompra = factor ? nombreCompra(p.compra.descripcion) : null;
    const enUnidades = Boolean(factor);
    const entero = enUnidades || p.entero;
    const paso = entero ? 1 : 0.01;
    const etiquetaCantidad = enUnidades ? `Cantidad (${plural(unidadCompra)} de ${formato.numero(factor)} ${p.unidad})` : p.compra ? `Cantidad (${p.unidad} del ${p.compra.descripcion.toLowerCase()})` : `Cantidad (${p.unidad})`;
    const aUnidad = (base) => (enUnidades ? Math.ceil((base - 1e-9) / factor) : base);
    const costoUnidad = (costoBase) => (costoBase === null || costoBase === undefined ? null : enUnidades ? Math.round(costoBase * factor * 100) / 100 : costoBase);
    // costo unico para el producto (por defecto) o por variante (solo si el producto lo permite)
    const porVariante = p.costoPorVariante;
    const ultimo = p.variantes.map((v) => v.ultimoCosto).filter((x) => x > 0);
    const idCostoUnico = nuevoId("costo-unico");
    const costoUnico = porVariante ? null : campoCosto(idCostoUnico, ultimo.length ? costoUnidad(Math.max(...ultimo)) : "", { "aria-describedby": `${idCostoUnico}-ayuda ${idCostoUnico}-e`, dataset: { error: `${idCostoUnico}-e` } });

    const pintarSubtotal = () => {
        const n = filas.filter((f) => f.cantidad() > 0);
        const t = n.reduce((s, f) => s + f.cantidad() * f.costo(), 0);
        montar(subtotal, n.length ? `${n.length} línea${n.length === 1 ? "" : "s"} · ${formato.dinero(t)} sin IVA` : "Escribe la cantidad de al menos una variante.");
    };

    function pintar() {
        filas.length = 0;
        const fijos = new Set([principal?.nombre, ...p.atributos.filter((a) => a.valores.length === 1).map((a) => a.nombre)]);
        const vs = p.variantes.filter((v) => !principal || v.caracteristicas[principal.nombre] === valor);
        const tabla = el("table", { class: "table align-middle mb-2" },
            el("caption", { class: "visually-hidden" }, "Cantidades a pedir al proveedor"),
            el("thead", {}, el("tr", {}, ["Variante", "Disponible", "Mínimo", "En camino", etiquetaCantidad, porVariante ? `Costo sin IVA${enUnidades ? ` por ${plural(unidadCompra, 1)}` : ""}` : null].filter(Boolean).map((t) => el("th", { scope: "col" }, t)))),
            el("tbody", {}, vs.map((v) => {
                const nombre = Object.entries(v.caracteristicas).filter(([k]) => !fijos.has(k)).map(([k, x]) => (k === "Color" ? x : `${k} ${x}`)).join(" · ") || v.sku;
                const idC = nuevoId("cant");
                const idK = nuevoId("costo");
                const equivale = el("span", { id: `${idC}-eq`, class: "d-block small text-body-secondary" });
                const cant = el("input", { id: idC, type: "number", class: "form-control form-control-sm", min: 0, step: paso, inputmode: entero ? "numeric" : "decimal",
                    placeholder: "0", value: v.sugerido > 0 ? (entero ? Math.ceil(aUnidad(v.sugerido)) : v.sugerido) : "", "aria-describedby": `${idC}-eq ${idC}-e`, dataset: { error: `${idC}-e` }, style: "max-width: 8rem" });
                const pintarEquivale = () => montar(equivale, enUnidades && Number(cant.value) > 0 ? `= ${formato.numero(Number(cant.value) * factor)} ${p.unidad}` : "");
                cant.addEventListener("input", pintarEquivale);
                pintarEquivale();
                const costo = porVariante ? campoCosto(idK, costoUnidad(v.ultimoCosto), { "aria-describedby": `${idK}-e`, dataset: { error: `${idK}-e` } }) : costoUnico;
                const fila = { variante: v, control: cant, controlCosto: costo, cantidad: () => Number(cant.value) || 0, costo: () => aNumero(costo.value) || 0, nombre };
                filas.push(fila);
                cant.addEventListener("input", pintarSubtotal);
                if (porVariante) costo.addEventListener("input", pintarSubtotal);
                return el("tr", {},
                    el("th", { scope: "row", class: "fw-normal" }, nombre,
                        v.sugerido > 0 ? el("span", { class: "d-block small text-danger-emphasis" }, `Bajo el mínimo: sugerido ${formato.numero(aUnidad(v.sugerido))}${enUnidades ? ` ${plural(unidadCompra, aUnidad(v.sugerido))}` : ` ${p.unidad}`}`)
                            : v.disponible <= 0 ? el("span", { class: "d-block small text-danger-emphasis" }, "Sin stock") : null),
                    el("td", {}, formato.numero(v.disponible)),
                    el("td", {}, formato.numero(v.stockMinimo)),
                    el("td", {}, formato.numero(v.enCamino)),
                    el("td", {}, el("label", { class: "visually-hidden", for: idC }, `Cantidad de ${nombre}`), cant, equivale, el("div", { id: `${idC}-e`, class: "invalid-feedback", "aria-live": "polite" })),
                    porVariante ? el("td", {}, el("label", { class: "visually-hidden", for: idK }, `Costo sin IVA de ${nombre}`), costo, el("div", { id: `${idK}-e`, class: "invalid-feedback", "aria-live": "polite" })) : null);
            })));
        montar(cuerpo,
            p.compra && !factor ? el("p", { class: "small text-body-secondary" }, `Cada ${p.compra.descripcion.toLowerCase()} trae piezas de medida distinta: se pide el total en ${p.unidad} (lo dice la factura del proveedor) y al recibir se mide cada pieza.`) : null,
            enUnidades && p.ventaPorPieza ? el("p", { class: "small text-body-secondary" }, `Cada ${plural(unidadCompra, 1)} entra al inventario como su propia pieza.`) : null,
            envolverOrdenable(tabla, { "aria-label": "Cantidades a pedir (desplazable)" }));
        pintarSubtotal();
    }

    const controles = [];
    if (principal) {
        const sel = campo({ nombre: "principal", etiqueta: principal.nombre, tipo: "seleccion", requerido: true, opciones: principal.valores.map((x) => ({ valor: x, etiqueta: x })), valor });
        sel.querySelector("select").addEventListener("change", (e) => { valor = e.target.value; pintar(); });
        controles.push(sel);
    }
    for (const a of p.atributos.filter((x) => x.valores.length === 1)) controles.push(el("p", { class: "mb-2" }, el("span", { class: "fw-semibold" }, `${a.nombre}: `), a.valores[0]));

    if (costoUnico) {
        costoUnico.addEventListener("input", pintarSubtotal);
        controles.push(el("div", { class: "mb-3" },
            el("label", { class: "form-label fw-semibold", for: idCostoUnico }, `Costo sin IVA por ${enUnidades ? plural(unidadCompra, 1) : p.unidad}`, el("span", { class: "text-danger", "aria-hidden": "true" }, " *")),
            costoUnico,
            el("div", { id: `${idCostoUnico}-ayuda`, class: "form-text" }, "Uno solo para todos los colores y tallas (viene el último pagado). Ej. 1,15"),
            el("div", { id: `${idCostoUnico}-e`, class: "invalid-feedback", "aria-live": "polite" })));
    }

    let d;
    const form = el("form", { novalidate: true }, resumen,
        el("p", { class: "text-body-secondary" }, p.compra
            ? `${p.codigo} · se compra por ${p.compra.descripcion}${factor ? `; al inventario entra en ${p.unidad}` : ""}. Lo sugerido completa el stock mínimo.`
            : `${p.codigo} · cantidades y costos en ${p.unidad} (unidad del inventario). Lo sugerido completa el stock mínimo.`),
        controles, cuerpo, subtotal,
        el("div", { class: "d-flex flex-wrap gap-2 mt-3" },
            el("button", { type: "submit", class: "btn btn-primary" }, "Agregar a la orden"),
            el("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => d.cerrar() }, "Cancelar")));

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const errores = [];
        for (const f of filas) {
            const c = f.control;
            const k = f.controlCosto;
            let m1 = null;
            let m2 = null;
            if (c.value !== "" && (c.validity.badInput || Number(c.value) < 0)) m1 = "Escribe una cantidad válida.";
            else if (f.cantidad() > 0 && entero && !Number.isInteger(f.cantidad())) m1 = enUnidades ? `Se compra en ${plural(unidadCompra)} enteros.` : `Se compra en cantidades enteras (${p.unidad}).`;
            if (porVariante && f.cantidad() > 0 && !(f.costo() > 0)) m2 = Number.isNaN(aNumero(k.value)) && k.value ? "Escribe el costo con números (ej. 1,15)." : "Escribe el costo sin IVA.";
            marcarCampo(c, m1);
            if (porVariante) marcarCampo(k, m2);
            if (m1) errores.push({ control: c, mensaje: `${f.nombre}: ${m1}` });
            if (m2) errores.push({ control: k, mensaje: `${f.nombre}: ${m2}` });
        }
        const elegidas = filas.filter((f) => f.cantidad() > 0);
        if (costoUnico && elegidas.length) {
            const n = aNumero(costoUnico.value);
            const m = n > 0 ? null : costoUnico.value ? "Escribe el costo con números (ej. 1,15)." : "Escribe el costo sin IVA.";
            marcarCampo(costoUnico, m);
            if (m) errores.push({ control: costoUnico, mensaje: m });
        }
        if (!errores.length && !elegidas.length) errores.push({ control: filas[0]?.control ?? null, mensaje: "Escribe la cantidad de al menos una variante." });
        if (errores.length) return mostrarResumen(resumen, errores);
        // cantidad y costo en la unidad de compra; factor convierte a la unidad del inventario al guardar
        alAgregar(elegidas.map((f) => ({ variante: f.variante, cantidad: f.cantidad(), costo: f.costo(), detalle: describir(f.variante), factor: factor ?? 1, unidadCompra })));
        d.cerrar();
        anunciar(`${elegidas.length} línea${elegidas.length === 1 ? "" : "s"} de ${p.nombre} agregada${elegidas.length === 1 ? "" : "s"} a la orden`);
    });

    pintar();
    d = dialogo({ titulo: `Pedir ${p.nombre}`, contenido: form, grande: true });
    return d;
}

/**
 * Recepcion de un paquete de bandas (cuero): debajo del campo "bandas que
 * llegaron" (nombre `b<id>`) aparece un campo de medida por cada banda. Los
 * campos nuevos se registran en las reglas del formulario, asi entran en la
 * misma validacion y en el resumen de errores enfocable. Una linea en vivo
 * informa cuanto suman frente a lo pendiente.
 * Devuelve medidas(): las medidas escritas, en orden.
 */
export function bandasPorPaquete({ form, reglas, id, unidad, pendiente, maximo = 60 }) {
    const control = form.elements.namedItem(`b${id}`);
    const lista = el("div", { class: "grilla-form" });
    const suma = el("p", { class: "small mb-2", "aria-live": "polite" });
    const grupo = el("fieldset", { class: "ancho-completo border rounded-3 px-3 pt-2 mb-3", hidden: true },
        el("legend", { class: "fs-6 fw-semibold float-none w-auto px-1 mb-1" }, `Medida de cada banda (${unidad})`),
        suma, lista);
    control.closest(".mb-3").after(grupo);

    const valores = []; // lo escrito se conserva aunque se baje el numero de bandas
    const nombre = (k) => `m${id}_${k}`;
    const leer = () => [...lista.querySelectorAll("input")].map((i) => Number(String(i.value).replace(",", ".")));

    function actualizarSuma() {
        const medidas = leer().filter((x) => x > 0);
        const total = medidas.reduce((s, x) => s + x, 0);
        const exceso = total > pendiente + 1e-9;
        suma.className = `small mb-2 ${exceso ? "text-danger fw-semibold" : "text-body-secondary"}`;
        suma.textContent = `Suman ${formato.numero(total)} ${unidad} de ${formato.numero(pendiente)} pendientes${exceso ? ": se pasa de lo pendiente." : "."}`;
    }

    function pintar() {
        lista.querySelectorAll("input").forEach((i, k) => { valores[k] = i.value; });
        for (const k of reglas.keys()) if (k.startsWith(`m${id}_`)) reglas.delete(k);
        const n = Math.min(Math.max(Number.parseInt(control.value, 10) || 0, 0), maximo);
        montar(lista, ...Array.from({ length: n }, (_, i) => {
            const k = i + 1;
            // coma o punto decimal (en Ecuador se escribe 23,5), hasta 3 decimales
            const regla = {
                etiqueta: `Banda ${k}`,
                requerido: true,
                validar: (v) => {
                    const texto = String(v).trim();
                    if (!/^\d{1,6}([.,]\d{1,3})?$/.test(texto)) return `Banda ${k}: escribe la medida en ${unidad}, con hasta 3 decimales (ej. 23,5).`;
                    return Number(texto.replace(",", ".")) > 0 ? null : `Banda ${k}: la medida debe ser mayor que 0.`;
                },
            };
            reglas.set(nombre(k), regla);
            const nodo = campo({ nombre: nombre(k), etiqueta: `Banda ${k} (${unidad})`, tipo: "texto", requerido: true, valor: valores[i] ?? "" });
            nodo.querySelector("input")?.setAttribute("inputmode", "decimal");
            nodo.querySelector("input")?.addEventListener("input", actualizarSuma);
            return nodo;
        }));
        grupo.hidden = n === 0;
        actualizarSuma();
    }
    control.addEventListener("input", pintar);
    control.setAttribute("max", String(maximo));
    pintar();
    return {
        medidas: () => leer().filter((x) => x > 0),
        primerCampo: () => control,
    };
}
