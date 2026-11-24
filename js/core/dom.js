// js/core/dom.js
// Utilidades de las VISTAS. Todo se construye con nodos y textContent: los
// datos de la base nunca se insertan como HTML (no hay innerHTML con datos).

/**
 * Crea un elemento: el("button", { class: "btn", type: "button", onclick }, "Texto", otroNodo)
 * Atributos que empiezan con "on" se registran como eventos; null/false se omiten.
 */
export function el(etiqueta, atributos = {}, ...hijos) {
    const nodo = document.createElement(etiqueta);
    for (const [clave, valor] of Object.entries(atributos ?? {})) {
        if (valor === null || valor === undefined || valor === false) continue;
        if (clave.startsWith("on") && typeof valor === "function") nodo.addEventListener(clave.slice(2), valor);
        else if (clave === "class") nodo.className = valor;
        else if (clave === "dataset") Object.assign(nodo.dataset, valor);
        else if (valor === true) nodo.setAttribute(clave, "");
        else nodo.setAttribute(clave, String(valor));
    }
    agregar(nodo, hijos);
    return nodo;
}

function agregar(nodo, hijos) {
    for (const h of hijos.flat(Infinity)) {
        if (h === null || h === undefined || h === false) continue;
        nodo.append(h instanceof Node ? h : document.createTextNode(String(h)));
    }
}

/** Reemplaza el contenido de un contenedor. */
export function montar(contenedor, ...hijos) {
    contenedor.replaceChildren();
    agregar(contenedor, hijos);
}

let contadorIds = 0;
export const nuevoId = (prefijo = "id") => `${prefijo}-${++contadorIds}`;

/** Anuncio para lectores de pantalla (region aria-live del layout). */
export function anunciar(texto, { urgente = false } = {}) {
    const region = document.getElementById(urgente ? "anuncioUrgente" : "anuncio");
    if (!region) return;
    region.textContent = "";
    // el cambio en dos tiempos garantiza que se lea aunque el texto se repita
    window.setTimeout(() => (region.textContent = texto), 50);
}

const moneda = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" });
const numero = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 3 });
const fechaCorta = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium" });
const fechaHora = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" });

export const formato = {
    dinero: (v) => (v === null || v === undefined || v === "" ? "—" : moneda.format(Number(v))),
    numero: (v) => (v === null || v === undefined || v === "" ? "—" : numero.format(Number(v))),
    fecha: (v) => (v ? fechaCorta.format(new Date(v)) : "—"),
    fechaHora: (v) => (v ? fechaHora.format(new Date(v)) : "—"),
    siNo: (v) => (v === true || v === 1 ? "Sí" : "No"),
    texto: (v) => (v === null || v === undefined || v === "" ? "—" : String(v)),
};

// ---- Unidad de compra ("Rollo × 30 m" -> rollos) ----------------------------
/** "Rollo × 30 m" -> "Rollo"; "Plancha (12 pie²)" -> "Plancha"; "Paquete de bandas" -> igual. */
export const nombreCompra = (descripcion) => String(descripcion ?? "").split(/\s+[×(]/)[0].trim();
/** Plural en español: rollo->rollos, galón->galones, millar->millares. */
export function plural(palabra, n = 2) {
    const p = String(palabra ?? "").toLowerCase();
    if (n === 1) return p;
    if (/ón$/.test(p)) return p.replace(/ón$/, "ones");
    if (/[aeiouáéíóú]$/.test(p)) return `${p}s`;
    return `${p}es`;
}
/**
 * Cantidad en la unidad de compra: 375 m con "Rollo × 30 m" -> "12 rollos + 15 m".
 * Sin factor (piezas que se miden): "N piezas". Sin unidad de compra: null.
 */
export function enUnidadCompra(cantidadBase, { descripcion, factor, unidad, piezas = null } = {}) {
    if (!descripcion) return null;
    if (!factor) return piezas === null ? null : `${piezas} ${piezas === 1 ? "pieza" : "piezas"}`;
    const n = Math.floor((Number(cantidadBase) + 1e-9) / factor);
    const resto = Math.round((Number(cantidadBase) - n * factor) * 1000) / 1000;
    const nombre = plural(nombreCompra(descripcion), n);
    return [n > 0 ? `${n} ${nombre}` : null, resto > 0 ? `${formato.numero(resto)} ${unidad ?? ""}`.trim() : null].filter(Boolean).join(" + ") || `0 ${plural(nombreCompra(descripcion))}`;
}
