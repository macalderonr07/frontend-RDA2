// js/models/recurso.model.js — MODELO generico de los recursos con CRUD
// (provincias, marcas, proveedores...): mismas operaciones para todos.
import { api } from "../core/api.js";

export const RecursoModelo = {
    listar: (ruta, { page = 1, limit = 20, q = "", ...filtros } = {}) => api.get(`/${ruta}`, { page, limit, q, ...filtros }),
    obtener: (ruta, id) => api.get(`/${ruta}/${encodeURIComponent(id)}`).then((r) => r.data),
    opciones: (ruta, filtros = {}) => api.get(`/${ruta}/opciones`, filtros).then((r) => r.data),
    crear: (ruta, datos) => api.post(`/${ruta}`, datos).then((r) => r.data),
    actualizar: (ruta, id, datos) => api.patch(`/${ruta}/${encodeURIComponent(id)}`, datos).then((r) => r.data),
    eliminar: (ruta, id) => api.delete(`/${ruta}/${encodeURIComponent(id)}`),
};
