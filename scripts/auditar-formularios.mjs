// scripts/auditar-formularios.mjs — npm run auditar:formularios
// Recorre TODOS los formularios de la administracion (el CRUD de cada recurso
// que publica /meta, los asistentes y los dialogos) y comprueba, campo por
// campo (WCAG 2.2: 1.3.1, 3.3.1, 3.3.2, 3.3.3, 4.1.2):
//  1. nombre accesible (label) en cada campo;
//  2. un contenedor de error propio, enlazado con aria-describedby;
//  3. al enviar vacio o invalido: aparece el RESUMEN de errores (role=alert)
//     y recibe el foco; cada campo con error queda aria-invalid="true" y su
//     mensaje es visible para el lector de pantalla;
//  4. cada enlace del resumen lleva el FOCO a su campo (el campo es enfocable).
// No guarda nada: solo envia formularios invalidos (la validacion los detiene
// en el navegador antes de llegar a la API).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { crearServidor } from "./servir.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
    readFileSync(resolve(aqui, "../../servidor/.env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const CORREO = process.env.ADMIN_CORREO ?? env.ADMIN_CORREO;
const CLAVE = process.env.ADMIN_CLAVE ?? env.ADMIN_CLAVE;
const PUERTO = 8092;
const BASE = `http://localhost:${PUERTO}/index.html`;

let formularios = 0;
let fallos = 0;
const hallazgos = [];
const servidor = crearServidor();
await new Promise((ok) => servidor.listen(PUERTO, ok));
const navegador = await chromium.launch();
const p = await (await navegador.newContext({ viewport: { width: 1366, height: 900 } })).newPage();

async function visitar(ruta) {
    await p.evaluate((r) => (window.location.hash = r), ruta);
    await p.waitForSelector("#tituloVista", { timeout: 15000 });
    await p.waitForFunction(() => !document.querySelector("#contenido [role=status] .spinner-border"), null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(250);
}

/**
 * Audita un formulario. contenedor: selector del form (o del dialogo).
 * invalido: valores que se escriben antes de enviar ({ selector: valor }) para
 * probar las regex, ademas del envio en vacio.
 */
async function auditar(nombre, contenedor, { invalido = {}, enviar = "button[type=submit]", minimoErrores = 1 } = {}) {
    formularios += 1;
    const problemas = [];
    // 1 y 2: etiqueta y error enlazado de cada campo visible y editable
    const campos = await p.$$eval(`${contenedor} input, ${contenedor} select, ${contenedor} textarea`, (controles) =>
        controles
            // fuera: el menu "Ordenar por" (no es un dato) y los buscadores (no se validan al escribir)
            .filter((c) => c.type !== "hidden" && !c.disabled && !c.readOnly && c.offsetParent !== null && c.type !== "search" && !c.id.startsWith("ordenar"))
            .map((c) => {
                const nombre = c.labels?.[0]?.textContent.trim() || c.getAttribute("aria-label") || (c.getAttribute("aria-labelledby") && document.getElementById(c.getAttribute("aria-labelledby"))?.textContent) || "";
                const describe = (c.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
                const idError = c.dataset.error;
                const enGrupo = c.type === "checkbox" || c.type === "radio"; // su error va en el fieldset (legend + mensaje)
                return { id: c.id, name: c.name, tipo: c.type, nombre: nombre.trim(), enGrupo,
                    errorEnlazado: enGrupo || Boolean(idError && describe.includes(idError) && document.getElementById(idError)) };
            }));
    for (const c of campos) {
        if (!c.nombre) problemas.push(`campo ${c.name || c.id} (${c.tipo}) sin etiqueta`);
        if (!c.errorEnlazado) problemas.push(`campo «${c.nombre || c.name}» sin mensaje de error enlazado (aria-describedby)`);
    }
    // valores invalidos (regex)
    for (const [sel, valor] of Object.entries(invalido)) {
        const loc = p.locator(`${contenedor} ${sel}`).first();
        if (await loc.count()) await loc.fill(valor);
    }
    // 3: enviar -> resumen enfocado, aria-invalid y mensaje
    await p.locator(`${contenedor} ${enviar}`).first().click();
    await p.waitForTimeout(400);
    const r = await p.evaluate((sel) => {
        const raiz = document.querySelector(sel);
        const resumen = raiz?.querySelector("[role=alert]:not([hidden])");
        const zona = raiz?.closest(".modal") ?? document.getElementById("contenido") ?? raiz;
        const invalidos = [...(zona?.querySelectorAll("[aria-invalid=true]") ?? [])].map((c) => ({
            id: c.id,
            mensaje: (c.getAttribute("aria-describedby") ?? "").split(/\s+/).map((i) => document.getElementById(i)?.textContent.trim()).filter(Boolean).join(" "),
        }));
        return {
            resumen: Boolean(resumen),
            enfocado: Boolean(resumen && (document.activeElement === resumen || resumen.contains(document.activeElement))),
            enlaces: [...(resumen?.querySelectorAll("a[href^='#']") ?? [])].map((a) => a.getAttribute("href").slice(1)),
            invalidos,
        };
    }, contenedor);
    if (!r.resumen) problemas.push("al enviar inválido no aparece el resumen de errores (role=alert)");
    else if (!r.enfocado) problemas.push("el resumen de errores no recibe el foco");
    if (r.invalidos.length < minimoErrores) problemas.push(`ningún campo quedó marcado con aria-invalid (se esperaban ≥ ${minimoErrores})`);
    for (const c of r.invalidos) if (!c.mensaje) problemas.push(`el campo #${c.id} está aria-invalid pero su mensaje no se lee`);
    // 4: cada enlace del resumen enfoca su campo
    for (const id of r.enlaces) {
        const foco = await p.evaluate((idCampo) => {
            const a = document.querySelector(`[role=alert] a[href="#${CSS.escape(idCampo)}"]`);
            if (!a) return "sin enlace";
            a.click();
            return document.activeElement?.id === idCampo ? "ok" : `el foco quedó en ${document.activeElement?.id || document.activeElement?.tagName}`;
        }, id);
        if (foco !== "ok") problemas.push(`el enlace del resumen a #${id} no lo enfoca (${foco})`);
    }
    if (problemas.length) {
        fallos += 1;
        hallazgos.push({ nombre, problemas });
        console.error(`  ✖ ${nombre}\n      - ${problemas.join("\n      - ")}`);
    } else {
        console.log(`  ✔ ${nombre} (${campos.length} campos, ${r.invalidos.length} errores enfocables)`);
    }
}

async function abrirDialogo(boton) {
    await p.locator(boton).first().click();
    await p.waitForSelector(".modal.show form", { timeout: 15000 });
    await p.waitForTimeout(400); // transicion del dialogo
}
async function cerrarDialogo() {
    if (await p.locator(".modal.show").count()) {
        await p.locator(".modal.show .btn-close").first().click();
        await p.waitForSelector(".modal", { state: "detached", timeout: 10000 }).catch(() => {});
    }
}

try {
    // --------------------------------------------------------------- Ingreso
    console.log("▶ Ingreso");
    await p.goto(`${BASE}#/`);
    await p.waitForSelector("form input[type=email]");
    await auditar("Ingreso a la administración", "main form", { invalido: { "input[type=email]": "no-es-correo" } });
    await p.fill("input[type=email]", CORREO);
    await p.fill("input[type=password]", CLAVE);
    await p.click("button[type=submit]");
    await p.waitForSelector("#contenidoMenu a", { state: "attached" });

    // --------------------------------------------------------------- CRUD de todos los recursos
    console.log("\n▶ Catálogos (formulario de cada recurso de /meta)");
    const recursos = await p.evaluate(async () => {
        const r = await fetch(`${location.protocol}//${location.hostname}:5070/api/v1/meta`, { headers: { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}` } });
        return (await r.json()).data.recursos.filter((x) => !x.soloLectura).map((x) => ({ ruta: x.ruta, titulo: x.titulo }));
    });
    for (const rec of recursos) {
        await visitar(`/r/${rec.ruta}/nuevo`);
        if (!(await p.locator("#contenido form").count())) continue;
        // texto con < > rompe la regex de cualquier campo de texto
        const invalido = {};
        const primerTexto = await p.$eval("#contenido form", (f) => [...f.querySelectorAll("input[type=text], input:not([type])")].find((i) => !i.readOnly)?.name ?? null).catch(() => null);
        if (primerTexto) invalido[`[name="${primerTexto}"]`] = "<x>";
        await auditar(`${rec.titulo}: nuevo`, "#contenido form", { invalido });
    }

    // --------------------------------------------------------------- Asistentes y pantallas
    console.log("\n▶ Asistentes y pantallas");
    await visitar("/productos/nuevo");
    await auditar("Alta de producto (asistente)", "#contenido form", { invalido: { "input[name=nombre]": "<x>", "input[name=imagenUrl]": "no-es-url" } });
    await visitar("/compras/nueva");
    await auditar("Nueva orden de compra", "#contenido form.card");
    await visitar("/ventas/nueva");
    await auditar("Nueva venta (registrar)", "#contenido form.card");
    await visitar("/mi-cuenta");
    await p.click("button[aria-controls=formClave]");
    await auditar("Mi cuenta: cambiar clave", "#formClave", { invalido: { "input[name=claveNueva]": "corta" } });

    // --------------------------------------------------------------- Dialogos
    console.log("\n▶ Diálogos");
    await visitar("/ventas/nueva");
    await abrirDialogo("button:text('Cliente nuevo')");
    await auditar("Cliente nuevo (desde la venta)", ".modal.show form", { invalido: { "input[name=telefono]": "123", "input[name=correo]": "x@" } });
    await p.locator(".modal.show input[name=facturacion][value=identificado]").check();
    await auditar("Cliente nuevo con cédula inválida", ".modal.show form", { invalido: { "input[name=identificacion]": "1712345678" } });
    await cerrarDialogo();

    await visitar("/usuarios");
    await abrirDialogo("button:text('Nuevo usuario')");
    await auditar("Nuevo usuario", ".modal.show form", { invalido: { "input[name=identificacion]": "1712345678", "input[name=clave]": "corta" } });
    await cerrarDialogo();

    await visitar("/roles");
    await abrirDialogo("button:text('Nuevo rol')");
    await auditar("Nuevo rol", ".modal.show form");
    await cerrarDialogo();

    await visitar("/inventario");
    await p.click(".tabla-admin tbody tr:first-child th + td a");
    await p.waitForSelector("#tituloDetalle", { timeout: 15000 });
    await abrirDialogo("button:text('Registrar ajuste')");
    await auditar("Ajuste de inventario", ".modal.show form", { invalido: { "input[name=cantidad]": "-3" } });
    await cerrarDialogo();

    await visitar("/combos");
    await abrirDialogo("button:text('Nuevo combo')");
    await auditar("Nuevo combo", ".modal.show form");
    await cerrarDialogo();

    await visitar("/ofertas");
    if (await p.locator("button:text('Nueva oferta')").count()) {
        await abrirDialogo("button:text('Nueva oferta')");
        await auditar("Nueva oferta", ".modal.show form", { invalido: { "input[name=porcentaje]": "150" } });
        await cerrarDialogo();
    }

    await visitar("/compras/comprobantes");
    if (await p.locator("button:text('Registrar factura')").count()) {
        await abrirDialogo("button:text('Registrar factura')");
        await auditar("Factura de proveedor", ".modal.show form");
        await cerrarDialogo();
    }

    await visitar("/ventas/cobros");
    if (await p.locator("button:text('Registrar abono')").count()) {
        await abrirDialogo("button:text('Registrar abono')");
        await auditar("Abono de cliente", ".modal.show form");
        await cerrarDialogo();
    }

    // un producto: precio, forma de venta y variante
    const idProducto = await p.evaluate(async () => {
        const r = await fetch(`${location.protocol}//${location.hostname}:5070/api/v1/catalogo/productos?q=sr-220&limit=1`, { headers: { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}` } });
        return (await r.json()).data[0]?.idProducto;
    });
    if (idProducto) {
        await visitar(`/productos/${idProducto}`);
        await p.click("[role=tab]:has-text('Formas de venta')");
        await abrirDialogo("button[aria-label^='Cambiar precio']");
        await auditar("Cambiar precio", ".modal.show form", { invalido: { "input[name=precioConIva]": "abc" } });
        await cerrarDialogo();
        await abrirDialogo("button:text('Agregar forma de venta')");
        await auditar("Nueva forma de venta", ".modal.show form");
        await cerrarDialogo();
        await p.click("[role=tab]:has-text('Datos generales')");
        await auditar("Datos generales del producto", "section[aria-labelledby=tituloGeneral] form", { invalido: { "input[name=nombre]": "<x>" } });
    }

    // dialogos de la venta: producto por tallas y direccion del cliente
    await visitar("/ventas/nueva");
    await p.fill("input[placeholder^='Nombre, cédula']", "Calzado Visual");
    await p.click("form[aria-label='Buscar cliente'] button[type=submit]");
    await p.locator("button[aria-label^='Elegir a Calzado Visual']").first().click();
    await p.check("input[name=entrega][value=domicilio]");
    await abrirDialogo("button:text('Agregar dirección')");
    await auditar("Dirección de entrega", ".modal.show form");
    await cerrarDialogo();
    await p.check("input[name=entrega][value=local]");
    await p.fill("input[placeholder^='Nombre, código']", "SR-220");
    await p.click("form[aria-label='Buscar productos para la venta'] button[type=submit]");
    await abrirDialogo("button[aria-label='Elegir Suela de caucho antideslizante modelo SR-220']");
    await auditar("Venta: producto por tallas", ".modal.show form", { invalido: { "tbody tr:first-child input[type=number]": "0.5" } });
    await cerrarDialogo();

    await visitar("/compras/nueva");
    await p.fill("input[placeholder^='Nombre, código o categoría (vacío']", "cuero graso");
    await p.click("form[aria-label='Buscar productos para la orden'] button[type=submit]");
    await abrirDialogo("button[aria-label^='Elegir Cuero graso']");
    await auditar("Compra: producto con costo único", ".modal.show form", { invalido: { ".costo-compra": "abc", "tbody tr:first-child input[type=number]": "5" } });
    await cerrarDialogo();

    // dialogos de un pedido pendiente: pago, avance y factura a credito
    const idPedido = await p.evaluate(async () => {
        const r = await fetch(`${location.protocol}//${location.hostname}:5070/api/v1/ventas/pedidos?estado=PEN&limit=1`, { headers: { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}` } });
        return (await r.json()).data[0]?.id_pedido;
    });
    if (idPedido) {
        await visitar(`/ventas/${idPedido}`);
        await abrirDialogo("button:text('Registrar pago')");
        await auditar("Registrar pago", ".modal.show form", { invalido: { "input[name=monto]": "abc" } });
        await cerrarDialogo();
        await abrirDialogo("button:text('Avance de dinero')");
        await auditar("Avance de dinero", ".modal.show form");
        await cerrarDialogo();
        if (await p.locator("button:text('Facturar a crédito')").count()) {
            await abrirDialogo("button:text('Facturar a crédito')");
            await auditar("Factura a crédito", ".modal.show form", { invalido: { "input[name=plazoDias]": "999" } });
            await p.click(".modal.show button:text('Nuevos datos de facturación')");
            await auditar("Nuevos datos de facturación (primera factura)", ".modal.show form:nth-of-type(2), .modal.show div > form:not(:first-child)", { invalido: { "input[name=identificacion]": "1712345678" } });
            await cerrarDialogo();
        }
    }

    await visitar("/usuarios");
    await abrirDialogo("button[aria-label^='Restablecer']");
    await auditar("Restablecer clave de un usuario", ".modal.show form", { invalido: { "input[name=clave]": "corta" } });
    await cerrarDialogo();
} catch (error) {
    fallos += 1;
    console.error("✖ La auditoría se interrumpió:", error.message);
} finally {
    await navegador.close();
    servidor.close();
}

console.log(`\n${fallos === 0 ? "✔" : "✖"} ${formularios - (fallos > formularios ? formularios : fallos)} de ${formularios} formularios con validación y errores enfocables.`);
process.exit(fallos === 0 ? 0 : 1);
