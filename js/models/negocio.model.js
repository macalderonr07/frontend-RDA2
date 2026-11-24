// js/models/negocio.model.js — MODELOS de los modulos con logica propia.
// Cada funcion es una operacion de negocio con nombre; las reglas (stock,
// precios, permisos) las aplican la API y la base.
import { api } from "../core/api.js";

const datos = (r) => r.data;

export const ProductoModelo = {
    listar: (filtros) => api.get("/catalogo/productos", filtros),
    obtener: (id) => api.get(`/catalogo/productos/${id}`).then(datos),
    // { propios: [...], otros: [...] } con sus valores (ver el asistente de alta)
    atributosDeCategoria: (idCategoria) => api.get(`/catalogo/categorias/${idCategoria}/atributos`).then(datos),
    crear: (producto) => api.post("/catalogo/productos", producto).then(datos),
    actualizar: (id, cambios) => api.patch(`/catalogo/productos/${id}`, cambios).then(datos),
    agregarVariante: (id, variante) => api.post(`/catalogo/productos/${id}/variantes`, variante).then(datos),
    actualizarVariante: (idVariante, cambios) => api.patch(`/catalogo/variantes/${idVariante}`, cambios).then(datos),
    agregarFormaDeVenta: (id, forma) => api.post(`/catalogo/productos/${id}/formas-de-venta`, forma).then(datos),
    actualizarFormaDeVenta: (id, cambios) => api.patch(`/catalogo/productos/${id}/formas-de-venta`, cambios).then(datos),
    registrarPrecio: (id, precio) => api.post(`/catalogo/productos/${id}/precios`, precio).then(datos),
    historialPrecios: (id) => api.get(`/catalogo/productos/${id}/precios`).then(datos),
    ofertas: () => api.get("/catalogo/ofertas").then(datos),
    crearOferta: (oferta) => api.post("/catalogo/ofertas", oferta).then(datos),
    cambiarOferta: (idOferta, cambios) => api.patch(`/catalogo/ofertas/${idOferta}`, cambios),
    combos: () => api.get("/catalogo/combos").then(datos),
    guardarCombo: (idCombo, combo) => (idCombo ? api.put(`/catalogo/combos/${idCombo}`, combo) : api.post("/catalogo/combos", combo)).then(datos),
    eliminarCombo: (idCombo) => api.delete(`/catalogo/combos/${idCombo}`),
};

export const InventarioModelo = {
    stock: (filtros) => api.get("/inventario/stock", filtros),
    lotes: (idVariante) => api.get(`/inventario/variantes/${idVariante}/lotes`).then(datos),
    kardex: (idVariante) => api.get(`/inventario/variantes/${idVariante}/kardex`).then(datos),
    ajustar: (ajuste) => api.post("/inventario/ajustes", ajuste).then(datos),
    fraccionar: (idLote, piezas, motivo) => api.post(`/inventario/lotes/${idLote}/fraccionar`, { piezas, motivo }).then(datos),
    devolver: (idLote, cantidad, motivo) => api.post(`/inventario/lotes/${idLote}/devolver`, { cantidad, motivo }).then(datos),
};

export const CompraModelo = {
    productos: (q) => api.get("/compras/productos", { q }).then(datos),
    producto: (id) => api.get(`/compras/productos/${id}`).then(datos),
    ordenes: (filtros) => api.get("/compras/ordenes", filtros),
    orden: (id) => api.get(`/compras/ordenes/${id}`).then(datos),
    crearOrden: (orden) => api.post("/compras/ordenes", orden).then(datos),
    cambiarEstado: (id, estado) => api.post(`/compras/ordenes/${id}/estado`, { estado }).then(datos),
    recepcionar: (id, recepcion) => api.post(`/compras/ordenes/${id}/recepciones`, recepcion).then(datos),
    comprobantes: (filtros) => api.get("/compras/comprobantes", filtros),
    registrarComprobante: (c) => api.post("/compras/comprobantes", c).then(datos),
    porFacturar: () => api.get("/compras/por-facturar").then(datos),
};

export const VentaModelo = {
    pedidos: (filtros) => api.get("/ventas/pedidos", filtros),
    pedido: (id) => api.get(`/ventas/pedidos/${id}`).then(datos),
    crearPedido: (pedido) => api.post("/ventas/pedidos", pedido).then(datos),
    pagar: (id, pago) => api.post(`/ventas/pedidos/${id}/pagos`, pago).then(datos),
    facturar: (id, factura) => api.post(`/ventas/pedidos/${id}/factura`, factura).then(datos),
    cambiarEstado: (id, estado, observacion) => api.post(`/ventas/pedidos/${id}/estado`, { estado, observacion }).then(datos),
    presentaciones: (q) => api.get("/ventas/presentaciones", { q }).then(datos),
    productos: (q) => api.get("/ventas/productos", { q }).then(datos),
    clientes: (q) => api.get("/ventas/clientes", { q }).then(datos),
    cliente: (id) => api.get(`/ventas/clientes/${id}`).then(datos),
    crearCliente: (d) => api.post("/ventas/clientes", d).then(datos),
    agregarFacturacion: (id, d) => api.post(`/ventas/clientes/${id}/facturacion`, d).then(datos),
    agregarDireccion: (id, d) => api.post(`/ventas/clientes/${id}/direcciones`, d).then(datos),
    registrarAvance: (idPedido, d) => api.post(`/ventas/pedidos/${idPedido}/avances`, d).then(datos),
    deudas: (idCliente) => api.get(`/ventas/clientes/${idCliente}/deudas`).then(datos),
    producto: (id) => api.get(`/ventas/productos/${id}`).then(datos),
    cuentasPorCobrar: () => api.get("/ventas/cuentas-por-cobrar").then(datos),
    abonar: (abono) => api.post("/ventas/abonos", abono).then(datos),
};

export const SeguridadModelo = {
    usuarios: (filtros) => api.get("/seguridad/usuarios", filtros),
    usuario: (id) => api.get(`/seguridad/usuarios/${id}`).then(datos),
    crear: (u) => api.post("/seguridad/usuarios", u).then(datos),
    actualizar: (id, cambios) => api.patch(`/seguridad/usuarios/${id}`, cambios).then(datos),
    restablecerClave: (id, clave) => api.put(`/seguridad/usuarios/${id}/clave`, { clave }),
    roles: () => api.get("/seguridad/roles").then(datos),
    permisos: () => api.get("/seguridad/permisos").then(datos),
    crearRol: (r) => api.post("/seguridad/roles", r).then(datos),
    actualizarRol: (codigo, r) => api.put(`/seguridad/roles/${codigo}`, r).then(datos),
    eliminarRol: (codigo) => api.delete(`/seguridad/roles/${codigo}`),
    correoSugerido: (nombres, apellidos) => api.get("/seguridad/usuarios/correo-sugerido", { nombres, apellidos }).then(datos),
};

export const ReporteModelo = {
    resumen: () => api.get("/reportes/resumen").then(datos),
    // catalogo: { data: [reportes con metadatos], meta: { categorias } }
    catalogo: () => api.get("/reportes"),
    tableros: () => api.get("/reportes/tableros").then(datos),
    indicadores: (periodo) => api.get("/reportes/indicadores", periodo).then(datos),
    // { data: filas, meta: { reporte, parametros, totales, totalItems, generado } }
    ejecutar: (id, periodo = {}) => api.get(`/reportes/${encodeURIComponent(id)}`, periodo),
};
