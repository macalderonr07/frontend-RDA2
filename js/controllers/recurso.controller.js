// js/controllers/recurso.controller.js
// CONTROLADOR del CRUD generico: une el modelo (RecursoModelo) con las vistas
// de lista y formulario. La descripcion de cada recurso viene de /meta.
import { anunciar, montar } from "../core/dom.js";
import { navegar } from "../core/router.js";
import { sesion } from "../core/sesion.js";
import { RecursoModelo } from "../models/recurso.model.js";
import { ordenServidor, paramsOrden, alerta, cargando, confirmar, encabezado, zonaAlertas } from "../views/componentes.js";
import { vistaFormulario, vistaLista } from "../views/recurso.view.js";

let meta = null;
export const fijarMeta = (m) => (meta = m);
export const recursoPorRuta = (ruta) => meta?.recursos.find((r) => r.ruta === ruta) ?? null;

const contenido = () => document.getElementById("contenido");

// Opciones de las listas de seleccion (con cache por pagina: se refrescan al navegar)
const cacheOpciones = new Map();
async function opciones(ruta, filtros = {}) {
    const clave = `${ruta}?${new URLSearchParams(filtros)}`;
    if (!cacheOpciones.has(clave)) cacheOpciones.set(clave, RecursoModelo.opciones(ruta, filtros).catch(() => []));
    return cacheOpciones.get(clave);
}
export const limpiarOpciones = () => cacheOpciones.clear();

/** Campos con sus opciones cargadas (para <select>). */
async function camposConOpciones(recurso) {
    return Promise.all(
        recurso.campos.map(async (c) => (c.tipo === "seleccion" ? { ...c, opciones: await opciones(c.recurso) } : c))
    );
}

function noEncontrado(ruta) {
    montar(contenido(), encabezado({ titulo: "Sección no encontrada" }), alerta("warning", `No existe la sección “${ruta}”.`));
}

// Estado de la lista por recurso (busqueda y pagina se conservan al volver)
const estados = new Map();

export async function lista({ recurso: ruta, consulta }) {
    const recurso = recursoPorRuta(ruta);
    if (!recurso) return noEncontrado(ruta);
    const alertas = zonaAlertas();
    const estado = estados.get(ruta) ?? { page: 1, q: "", filtros: {}, filas: [], meta: null };
    estados.set(ruta, estado);
    // Filtros desde la URL (#/r/descuentos-volumen?idProducto=12): enlaces entre secciones
    for (const nombre of recurso.filtros ?? []) {
        if (consulta?.has(nombre)) {
            estado.filtros = { ...estado.filtros, [nombre]: consulta.get(nombre) };
            estado.page = 1;
        }
    }
    montar(contenido(), cargando(`Cargando ${recurso.titulo.toLowerCase()}…`));
    limpiarOpciones();

    const campos = await camposConOpciones(recurso);
    const etiquetas = Object.fromEntries(
        campos.filter((c) => c.tipo === "seleccion").map((c) => [c.nombre, new Map(c.opciones.map((o) => [String(o.valor), o.etiqueta]))])
    );
    const opcionesFiltro = Object.fromEntries((recurso.filtros ?? []).map((n) => [n, campos.find((c) => c.nombre === n)?.opciones ?? []]));

    async function cargar(mensaje = null) {
        try {
            const { data, meta: m } = await RecursoModelo.listar(ruta, { page: estado.page, limit: 20, q: estado.q, ...estado.filtros, ...paramsOrden(estado) });
            estado.filas = data;
            estado.meta = m;
        } catch (error) {
            alertas.error(error, `No se pudo cargar ${recurso.titulo.toLowerCase()}`);
            estado.filas = [];
            estado.meta = null;
        }
        montar(contenido(), vistaLista({
            recurso: { ...recurso, campos },
            estado,
            etiquetas,
            opcionesFiltro,
            puedeEscribir: sesion.puede(recurso.permiso),
            alertas,
            acciones: {
                orden: ordenServidor(estado, cargar),
                buscar: (q, filtros) => {
                    Object.assign(estado, { q, filtros, page: 1 });
                    cargar().then(() => anunciar(`${estado.meta?.totalItems ?? 0} resultados`));
                },
                pagina: (n) => {
                    estado.page = n;
                    cargar().then(() => anunciar(`Página ${n}`));
                },
                nuevo: () => navegar(`/r/${ruta}/nuevo`),
                editar: (f) => navegar(`/r/${ruta}/${encodeURIComponent(f.id)}`),
                eliminar: async (f) => {
                    const ok = await confirmar({
                        titulo: `Eliminar ${recurso.singular}`,
                        mensaje: `¿Eliminar “${f.etiqueta}”? Si está en uso por otros datos, la base no lo permitirá (puedes desactivarlo).`,
                        textoConfirmar: "Eliminar",
                    });
                    if (!ok) return;
                    try {
                        await RecursoModelo.eliminar(ruta, f.id);
                        await cargar();
                        alertas.exito(`Se eliminó “${f.etiqueta}”.`);
                    } catch (error) {
                        alertas.error(error, "No se pudo eliminar");
                    }
                },
            },
        }));
        if (mensaje) alertas.exito(mensaje);
    }
    await cargar(sessionStorage.getItem("ce_admin_mensaje"));
    sessionStorage.removeItem("ce_admin_mensaje");
}

export async function formulario({ recurso: ruta, id }) {
    const recurso = recursoPorRuta(ruta);
    if (!recurso) return noEncontrado(ruta);
    const esNuevo = id === "nuevo";
    const alertas = zonaAlertas();
    montar(contenido(), cargando());
    if (!sesion.puede(recurso.permiso) || recurso.soloLectura) {
        montar(contenido(), encabezado({ titulo: recurso.titulo }), alerta("warning", "No tienes permiso para modificar este catálogo."));
        return;
    }
    limpiarOpciones();
    let valores = {};
    try {
        const campos = await camposConOpciones(recurso);
        if (!esNuevo) valores = await RecursoModelo.obtener(ruta, id);
        montar(contenido(), vistaFormulario({
            recurso,
            valores,
            esNuevo,
            campos,
            alertas,
            alCancelar: () => navegar(`/r/${ruta}`),
            alEnviar: async (datos) => {
                const guardado = esNuevo ? await RecursoModelo.crear(ruta, datos) : await RecursoModelo.actualizar(ruta, id, datos);
                sessionStorage.setItem("ce_admin_mensaje", `${esNuevo ? "Se creó" : "Se guardó"} “${guardado.etiqueta}”.`);
                navegar(`/r/${ruta}`);
            },
        }));
    } catch (error) {
        montar(contenido(), encabezado({ titulo: recurso.titulo }), alerta("danger", error.message, { titulo: "No se pudo abrir el registro" }));
    }
}
