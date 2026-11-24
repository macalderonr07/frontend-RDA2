// js/views/recurso.view.js
// VISTAS del CRUD generico: lista (busqueda, filtros, tabla, paginacion) y
// pagina de formulario. No piden datos: los reciben del controlador junto con
// las funciones a llamar en cada accion.
import { el, formato, nuevoId } from "../core/dom.js";
import { encabezado, paginacion, tabla } from "./componentes.js";
import { formulario } from "./formulario.js";

/** Texto de una celda segun el tipo del campo (las claves foraneas por su nombre). */
export function valorCelda(c, fila, etiquetas) {
    const v = fila[c.nombre];
    if (c.tipo === "booleano") return formato.siNo(v);
    if (c.tipo === "seleccion") return v === null || v === undefined ? "—" : (etiquetas[c.nombre]?.get(String(v)) ?? String(v));
    if (c.tipo === "opciones") return c.opciones?.find((o) => o.valor === v)?.etiqueta ?? formato.texto(v);
    if (c.tipo === "fecha") return formato.fecha(v);
    if (c.tipo === "dinero") return formato.dinero(v);
    if (c.tipo === "cantidad" || c.tipo === "porcentaje") return formato.numero(v);
    return formato.texto(v);
}

/**
 * recurso: descripcion de /meta. estado: { filas, meta, q, filtros }.
 * acciones: { buscar(q, filtros), pagina(n), nuevo(), editar(fila), eliminar(fila) }
 */
export function vistaLista({ recurso, estado, etiquetas, opcionesFiltro, puedeEscribir, acciones, alertas }) {
    const columnas = recurso.campos.slice(0, 6).map((c) => ({
        titulo: c.etiqueta,
        numerica: ["dinero", "cantidad", "porcentaje", "entero"].includes(c.tipo),
        valor: (f) => valorCelda(c, f, etiquetas),
        // el servidor ordena por la columna (una clave foranea, por el nombre de lo que apunta)
        clave: c.nombre,
    }));
    const idBusqueda = nuevoId("buscar");
    const busqueda = el("input", { id: idBusqueda, type: "search", name: "q", class: "form-control", value: estado.q ?? "", autocomplete: "off" });
    const filtros = (recurso.filtros ?? []).map((nombre) => {
        const c = recurso.campos.find((x) => x.nombre === nombre);
        const id = nuevoId(`filtro-${nombre}`);
        return el("div", {},
            el("label", { class: "form-label", for: id }, `Filtrar por ${c?.etiqueta.toLowerCase() ?? nombre}`),
            el("select", { id, name: nombre, class: "form-select" },
                el("option", { value: "" }, "Todos"),
                (opcionesFiltro[nombre] ?? []).map((o) => el("option", { value: o.valor, selected: String(estado.filtros?.[nombre] ?? "") === String(o.valor) }, o.etiqueta))));
    });
    const formBusqueda = el("form", {
        role: "search",
        "aria-label": `Buscar ${recurso.titulo.toLowerCase()}`,
        class: "barra-lista",
        onsubmit: (e) => {
            e.preventDefault();
            const datos = new FormData(e.currentTarget);
            const f = {};
            for (const nombre of recurso.filtros ?? []) f[nombre] = datos.get(nombre) || "";
            acciones.buscar(String(datos.get("q") ?? "").trim(), f);
        },
    },
        recurso.buscable ? el("div", {}, el("label", { class: "form-label", for: idBusqueda }, "Buscar"), busqueda) : null,
        filtros,
        (recurso.buscable || filtros.length) ? el("div", {}, el("button", { type: "submit", class: "btn btn-outline-primary w-100" }, "Aplicar")) : null);

    return el("section", { "aria-labelledby": "tituloVista" },
        encabezado({
            titulo: recurso.titulo,
            descripcion: recurso.ayuda,
            acciones: puedeEscribir && !recurso.soloLectura
                ? [el("button", { type: "button", class: "btn btn-primary", onclick: acciones.nuevo }, `Nuevo: ${recurso.singular}`)]
                : [],
        }),
        alertas.nodo,
        recurso.soloLectura ? el("p", { class: "alert alert-light border" }, "Catálogo de solo lectura (códigos oficiales).") : null,
        formBusqueda,
        tabla({
            titulo: `Lista de ${recurso.titulo.toLowerCase()}`,
            columnas,
            filas: estado.filas,
            orden: acciones.orden,
            vacio: estado.q ? `No hay ${recurso.titulo.toLowerCase()} que coincidan con “${estado.q}”.` : `Todavía no hay ${recurso.titulo.toLowerCase()}.`,
            acciones: puedeEscribir && !recurso.soloLectura
                ? (f) => [
                      el("button", { type: "button", class: "btn btn-sm btn-outline-primary", onclick: () => acciones.editar(f), "aria-label": `Editar ${f.etiqueta}` }, "Editar"),
                      recurso.sinEliminar ? null : el("button", { type: "button", class: "btn btn-sm btn-outline-danger", onclick: () => acciones.eliminar(f), "aria-label": `Eliminar ${f.etiqueta}` }, "Eliminar"),
                  ]
                : null,
        }),
        paginacion(estado.meta, acciones.pagina));
}

/** Pagina de alta o edicion. */
export function vistaFormulario({ recurso, valores, esNuevo, campos, alertas, alEnviar, alCancelar }) {
    const { form } = formulario({
        campos,
        valores,
        alEnviar,
        alCancelar,
        textoEnviar: esNuevo ? `Crear ${recurso.singular}` : "Guardar cambios",
        // la clave de catalogos con codigo propio no se cambia al editar
        deshabilitados: !esNuevo && recurso.pkEditable ? [recurso.pk] : [],
    });
    return el("section", { "aria-labelledby": "tituloVista" },
        encabezado({
            titulo: esNuevo ? `Nuevo: ${recurso.singular}` : `Editar ${recurso.singular}`,
            descripcion: recurso.ayuda,
            miga: [{ texto: recurso.titulo, href: `#/r/${recurso.ruta}` }, { texto: esNuevo ? "Nuevo" : (valores.etiqueta ?? "Editar") }],
        }),
        alertas.nodo,
        el("div", { class: "card" }, el("div", { class: "card-body" }, form)));
}
