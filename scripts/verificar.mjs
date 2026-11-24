// scripts/verificar.mjs — verificacion de la administracion en un navegador
// real (Chromium + Playwright) contra la API corriendo (npm run verificar).
//
//  1. Accesibilidad WCAG 2.2 AA con axe-core en cada pantalla: ingreso,
//     tablero, modulos de negocio y TODOS los CRUD genericos, en modo claro,
//     oscuro y en celular (375 px). Sin errores de JS y sin scroll horizontal.
//  2. Teclado y foco: "Saltar al contenido" es el primer foco; el foco visible
//     es un contorno de 3 px; los dialogos atrapan el foco y cierran con Esc.
//  3. Errores accesibles: resumen enfocable con enlaces, aria-invalid en los
//     campos, mensajes del servidor marcados en su campo.
//  4. Flujos: CRUD generico (regex, alta, edicion, eliminacion con
//     confirmacion), alta de producto con el asistente y cambio de precio.
// La clave del administrador se lee del .env del servidor y nunca se imprime.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { crearServidor } from "./servir.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
// el .env del servidor solo existe en el repositorio completo: si no esta, se usan las variables de entorno
let env = {};
try {
    env = Object.fromEntries(
        readFileSync(resolve(aqui, "../../servidor/.env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
    );
} catch {
    /* sin .env: ADMIN_CORREO y ADMIN_CLAVE del entorno */
}
// ADMIN_CORREO / ADMIN_CLAVE del entorno (una cuenta de pruebas) o, si no, las del .env
const CORREO = process.env.ADMIN_CORREO ?? env.ADMIN_CORREO;
const CLAVE = process.env.ADMIN_CLAVE ?? env.ADMIN_CLAVE;
const PUERTO = 8091;
const BASE = `http://localhost:${PUERTO}/index.html`;

let pruebas = 0;
let fallos = 0;
const ok = (cond, nombre, extra = "") => {
    pruebas += 1;
    if (cond) console.log(`  ✔ ${nombre}`);
    else {
        fallos += 1;
        console.error(`  ✖ ${nombre}${extra ? ` — ${String(extra).slice(0, 600)}` : ""}`);
    }
};
const seccion = (t) => console.log(`\n▶ ${t}`);

const servidor = crearServidor();
await new Promise((r) => servidor.listen(PUERTO, r));
const navegador = await chromium.launch();

async function nuevaPagina({ ancho = 1366, alto = 900, tema = "light" } = {}) {
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, colorScheme: tema === "dark" ? "dark" : "light" });
    const pagina = await contexto.newPage();
    pagina.errores = [];
    pagina.on("pageerror", (e) => pagina.errores.push(`pageerror: ${e.message}`));
    pagina.on("console", (m) => {
        // 4xx esperables de las pruebas de error (clave incorrecta, validaciones) no cuentan
        if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) pagina.errores.push(`console: ${m.text()}`);
    });
    return pagina;
}

async function axe(pagina) {
    await pagina.addScriptTag({ content: AXE });
    return pagina.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
        return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")} — ${v.nodes[0]?.failureSummary?.split("\n")[1] ?? ""}`);
    });
}

async function ingresar(pagina) {
    await pagina.goto(`${BASE}#/`);
    await pagina.waitForSelector("form input[type=email]");
    await pagina.fill("input[type=email]", CORREO);
    await pagina.fill("input[type=password]", CLAVE);
    await pagina.click("button[type=submit]");
    await pagina.waitForSelector("#contenidoMenu a", { state: "attached" });
}

async function visitar(pagina, ruta) {
    await pagina.evaluate((r) => (window.location.hash = r), ruta);
    await pagina.waitForSelector("#tituloVista", { timeout: 15000 });
    await pagina.waitForFunction(() => !document.querySelector("#contenido [role=status] .spinner-border"), null, { timeout: 15000 }).catch(() => {});
    await pagina.waitForTimeout(150);
}

/** El menu "Ordenar por" solo se ve en celular (en escritorio ordenan los encabezados): se elige por codigo. */
async function elegirOrden(pagina, etiqueta) {
    await pagina.$eval("select[id^=ordenar]", (s, t) => {
        const o = [...s.options].find((x) => x.textContent === t);
        if (!o) throw new Error(`No hay la opción de orden «${t}»`);
        s.value = o.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
    }, etiqueta);
}

const sinScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
    // ------------------------------------------------------------ Ingreso
    seccion("Ingreso");
    const p = await nuevaPagina();
    await p.goto(`${BASE}#/`);
    await p.waitForSelector("form input[type=email]");
    let v = await axe(p);
    ok(v.length === 0, "pantalla de ingreso sin violaciones WCAG 2.2 AA", v.join(" | "));
    // La vista mueve el foco a su titulo; el orden de tabulacion del documento
    // debe empezar por el enlace de salto
    ok(await p.evaluate(() => {
        const enfocables = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
            .filter((e) => !e.disabled && !e.closest("[hidden]"));
        return enfocables[0]?.textContent.includes("Saltar al contenido");
    }), "el primer elemento enfocable es “Saltar al contenido principal”");
    await p.click("button[type=submit]");
    await p.waitForSelector("[role=alert]:not([hidden])");
    ok(await p.evaluate(() => document.activeElement?.getAttribute("role") === "alert" && document.querySelectorAll("[aria-invalid=true]").length === 2),
        "enviar vacío: el foco va al resumen y los dos campos quedan aria-invalid");
    await p.fill("input[type=email]", CORREO);
    await p.fill("input[type=password]", "ClaveEquivocada123");
    await p.click("button[type=submit]");
    await p.waitForFunction(() => /Correo o clave incorrectos/.test(document.querySelector("[role=alert]")?.textContent ?? ""));
    ok(true, "clave incorrecta: mensaje genérico del servidor en el resumen");
    await p.fill("input[type=password]", CLAVE);
    await p.click("button[type=submit]");
    await p.waitForSelector("#contenidoMenu a", { state: "attached" });
    ok(await p.waitForFunction(() => document.activeElement?.id === "tituloVista" && /Hola/.test(document.activeElement.textContent), null, { timeout: 10000 }).then(() => true).catch(() => false),
        "tras ingresar el foco va al título del tablero");

    // ------------------------------------------------------------ Todas las pantallas
    seccion("Pantallas: WCAG 2.2 AA, errores de JS y scroll horizontal");
    const meta = await p.evaluate(async () => {
        const r = await fetch(`${window.location.protocol}//${window.location.hostname}:5070/api/v1/meta`, { headers: { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}` } });
        return (await r.json()).data;
    });
    const idProducto = await p.evaluate(async () => {
        const r = await fetch(`${window.location.protocol}//${window.location.hostname}:5070/api/v1/catalogo/productos?limit=1`, { headers: { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}` } });
        return (await r.json()).data[0].idProducto;
    });
    const idVariante = await p.evaluate(async () => {
        const r = await fetch(`${window.location.protocol}//${window.location.hostname}:5070/api/v1/inventario/stock?limit=1`, { headers: { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}` } });
        return (await r.json()).data[0].id_variante;
    });
    const idPedido = await p.evaluate(async () => {
        const r = await fetch(`${window.location.protocol}//${window.location.hostname}:5070/api/v1/ventas/pedidos?limit=1`, { headers: { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}` } });
        return (await r.json()).data[0]?.id_pedido;
    });
    const idOrden = await p.evaluate(async () => {
        const r = await fetch(`${window.location.protocol}//${window.location.hostname}:5070/api/v1/compras/ordenes?limit=1`, { headers: { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}` } });
        return (await r.json()).data[0]?.id_orden_compra;
    });
    const rutas = [
        "/", "/productos", "/productos/nuevo", `/productos/${idProducto}`, "/ofertas", "/combos",
        "/inventario", `/inventario/${idVariante}`, "/compras", "/compras/nueva", "/compras/comprobantes",
        ...(idOrden ? [`/compras/${idOrden}`] : []),
        "/ventas", "/ventas/nueva", "/ventas/cobros", ...(idPedido ? [`/ventas/${idPedido}`] : []),
        "/usuarios", "/roles", "/reportes", "/reportes/ventas-por-canal", "/mi-cuenta",
        ...meta.recursos.map((r) => `/r/${r.ruta}`),
        "/r/provincias/nuevo", "/r/proveedores/nuevo", "/r/empleados/nuevo",
    ];
    for (const ruta of rutas) {
        await visitar(p, ruta);
        const violaciones = await axe(p);
        const sinErrores = p.errores.length === 0;
        ok(violaciones.length === 0 && sinErrores && (await sinScroll(p)), `${ruta}`, [...violaciones, ...p.errores].join(" | "));
        p.errores = [];
    }

    seccion("Tema oscuro y celular (375 px)");
    for (const [nombre, opciones] of [["oscuro", { tema: "dark" }], ["celular", { ancho: 375, alto: 800 }], ["celular oscuro", { ancho: 375, alto: 800, tema: "dark" }]]) {
        const q = await nuevaPagina(opciones);
        await ingresar(q);
        for (const ruta of ["/", "/productos", "/productos/nuevo", `/productos/${idProducto}`, "/inventario", "/ventas/nueva", "/r/proveedores/nuevo", "/usuarios", "/reportes", "/reportes/ventas-por-linea"]) {
            await visitar(q, ruta);
            const violaciones = await axe(q);
            ok(violaciones.length === 0 && q.errores.length === 0 && (await sinScroll(q)), `${nombre} · ${ruta}`, [...violaciones, ...q.errores].join(" | "));
            q.errores = [];
        }
        if (nombre === "celular") {
            ok(await q.isVisible("#botonMenu"), "en celular el menú se abre con un botón");
            await q.click("#botonMenu");
            await q.waitForSelector("#menu.show");
            ok(await q.isVisible("#contenidoMenu button.menu-seccion:has-text('Productos')"), "el menú (offcanvas) muestra las secciones");
            await q.keyboard.press("Escape");
            await q.waitForSelector("#menu:not(.show)", { state: "attached" });
            ok(true, "Esc cierra el menú");
        }
        await q.context().close();
    }

    // ------------------------------------------------------------ Teclado y foco
    seccion("Teclado y foco visible");
    await visitar(p, "/productos");
    await p.focus("#contenido .encabezado-vista a.btn");
    const contorno = await p.evaluate(() => {
        const b = document.activeElement;
        b.blur();
        b.focus({ focusVisible: true });
        const s = getComputedStyle(b);
        return { ancho: s.outlineWidth, estilo: s.outlineStyle };
    });
    ok(contorno.ancho === "3px" && contorno.estilo === "solid", "el foco visible es un contorno sólido de 3 px", JSON.stringify(contorno));
    ok(await p.evaluate(() => document.querySelector("#contenidoMenu a[aria-current=page]")?.dataset.ruta === "/productos"), "el menú marca la sección actual con aria-current");
    // Dibujo real del menu a 1440 px: Bootstrap ponia el contenedor en fila y solo se veia una seccion
    await p.setViewportSize({ width: 1440, height: 1000 });
    const fuera = await p.evaluate(() => {
        const m = document.getElementById("contenidoMenu").getBoundingClientRect();
        return [...document.querySelectorAll("#contenidoMenu .menu-seccion")]
            .filter((b) => { const c = b.getBoundingClientRect(); return c.left < m.left - 1 || c.right > m.right + 1 || c.width === 0; })
            .map((b) => b.textContent.trim());
    });
    ok(fuera.length === 0 && (await p.locator("#contenidoMenu .menu-seccion").count()) >= 8, "a 1440 px todas las secciones del menú están dentro de la barra", fuera.join(" | "));
    ok(await p.isVisible("#contenidoMenu .menu-seccion:has-text('Reportes')"), "Reportes es una sección del menú");
    ok(await p.evaluate(() => [...document.querySelectorAll("#contenidoMenu .menu-seccion")].map((b) => b.textContent.trim())[0] === "Ventas"), "el menú empieza por la tarea más frecuente (Ventas)");
    ok(await p.evaluate(() => !document.querySelector("#contenidoMenu .menu-cuenta")), "el menú no muestra contadores de opciones (ruido visual)");
    ok(await p.isHidden("#contenido .orden-movil"), "en escritorio no se repite el menú «Ordenar por» (ordenan los encabezados)");
    await p.setViewportSize({ width: 1366, height: 900 });

    // Menu plegable: solo la seccion actual abierta
    const abiertas = await p.$$eval("#contenidoMenu .menu-seccion[aria-expanded=true]", (b) => b.map((x) => x.textContent));
    ok(abiertas.length === 1 && /Productos/.test(abiertas[0]), "menú por secciones: solo está abierta la de la página actual", abiertas.join(" | "));
    await p.click("#contenidoMenu .menu-seccion:has-text('Compras')");
    ok(await p.evaluate(() => {
        const compras = [...document.querySelectorAll("#contenidoMenu .menu-seccion")].find((b) => /Compras/.test(b.textContent));
        const productos = [...document.querySelectorAll("#contenidoMenu .menu-seccion")].find((b) => /Productos/.test(b.textContent));
        return compras.getAttribute("aria-expanded") === "true" && !document.getElementById(compras.getAttribute("aria-controls")).hidden
            && productos.getAttribute("aria-expanded") === "false";
    }), "abrir Compras cierra Productos (acordeón con aria-expanded)");
    await p.focus("#contenidoMenu .menu-seccion:has-text('Ventas')");
    await p.keyboard.press("Enter");
    ok(await p.$eval("#contenidoMenu .menu-seccion:has-text('Ventas')", (b) => b.getAttribute("aria-expanded") === "true"), "las secciones se abren con el teclado");

    // Ordenamiento: lista paginada (servidor) y tabla completa (navegador)
    await visitar(p, "/r/provincias");
    await elegirOrden(p, "Nombre: Z → A");
    await p.waitForFunction(() => document.querySelector("th[aria-sort=descending]"));
    const provincias = await p.$$eval(".tabla-admin tbody th", (c) => c.map((x) => x.textContent.trim()));
    ok(provincias[0] === "Zamora Chinchipe", "ordenar por nombre Z → A lo hace el servidor (primera: Zamora Chinchipe)", provincias.slice(0, 3).join(", "));
    await p.click("th[aria-sort=descending] .btn-orden");
    await p.waitForFunction(() => document.querySelector("th[aria-sort=ascending]"));
    ok((await p.$eval(".tabla-admin tbody th", (c) => c.textContent.trim())) === "Azuay", "pulsar el encabezado invierte el orden (A → Z)");
    await visitar(p, `/productos/${idProducto}`);
    const sel = await p.$("section[aria-labelledby=tituloVariantes] select[id^=ordenar]");
    ok(Boolean(sel), "las tablas sin paginar también tienen menú «Ordenar por» (para celular)");
    // Ficha del producto en pestanas (patron ARIA tabs, flechas del teclado)
    const tabs = await p.$$eval("[role=tablist] [role=tab]", (t) => t.map((x) => x.textContent));
    ok(tabs.length === 4 && /Variantes/.test(tabs[0]), "ficha del producto en 4 pestañas", tabs.join(" | "));
    await p.focus("[role=tablist] [role=tab][aria-selected=true]");
    await p.keyboard.press("ArrowRight");
    ok(await p.evaluate(() => document.activeElement.getAttribute("aria-selected") === "true" && /Formas de venta/.test(document.activeElement.textContent)
        && !document.getElementById(document.activeElement.getAttribute("aria-controls")).hidden), "flecha derecha abre la pestaña siguiente y le pasa el foco");

    // ------------------------------------------------------------ CRUD generico
    seccion("CRUD genérico: provincias");
    const unico = Date.now().toString(36).slice(-5);
    await visitar(p, "/r/provincias/nuevo");
    await p.fill("input[name=nombre]", "<x>");
    await p.click("form button[type=submit]");
    await p.waitForSelector("[role=alert]:not([hidden]) a");
    ok(await p.evaluate(() => document.activeElement?.getAttribute("role") === "alert" && document.querySelector("input[name=nombre]").getAttribute("aria-invalid") === "true"),
        "regex del servidor aplicada en el navegador: resumen enfocado y campo aria-invalid");
    await p.click("[role=alert] a");
    ok(await p.evaluate(() => document.activeElement?.name === "nombre"), "el enlace del resumen lleva al campo");
    await p.fill("input[name=nombre]", `Provincia Visual ${unico}`);
    await p.click("form button[type=submit]");
    await p.waitForFunction((u) => document.querySelector(".zona-alertas")?.textContent.includes(u), unico);
    ok(true, "alta: vuelve a la lista con el mensaje de éxito");
    await p.fill("input[name=q]", `visual ${unico}`);
    await p.click("form[role=search] button[type=submit]");
    await p.waitForFunction((u) => [...document.querySelectorAll("tbody th")].some((t) => t.textContent.includes(u)), unico);
    await p.click(`button[aria-label="Eliminar Provincia Visual ${unico}"]`);
    await p.waitForSelector(".modal.show");
    ok(await p.waitForFunction(() => document.querySelector(".modal.show")?.contains(document.activeElement), null, { timeout: 5000 }).then(() => true).catch(() => false),
        "el diálogo de confirmación recibe el foco (al terminar su transición)");
    await p.keyboard.press("Escape");
    await p.waitForSelector(".modal", { state: "detached" });
    ok(await p.evaluate((u) => [...document.querySelectorAll("tbody th")].some((t) => t.textContent.includes(u)), unico), "Esc cancela: no se elimina");
    await p.click(`button[aria-label="Eliminar Provincia Visual ${unico}"]`);
    await p.waitForSelector(".modal.show");
    await p.click(".modal.show .btn-danger");
    await p.waitForFunction((u) => document.querySelector(".zona-alertas")?.textContent.includes("Se eliminó") && ![...document.querySelectorAll("tbody th")].some((t) => t.textContent.includes(u)), unico);
    ok(true, "confirmar elimina y anuncia el resultado");

    // ------------------------------------------------------------ Alta de producto
    seccion("Alta de producto con el asistente");
    await visitar(p, "/productos/nuevo");
    ok(await p.evaluate(() => { const c = document.querySelector("input[name=codigo]"); return c.readOnly && /genera/.test(c.value); }),
        "el código del producto es automático y de solo lectura");
    await p.fill("input[name=nombre]", `Hebilla visual ${unico}`);
    ok(/Elige primero la categoría/.test(await p.textContent("section[aria-labelledby=paso2]")), "sin categoría, el paso 2 pide elegirla primero");
    await p.selectOption("select[name=idCategoria]", { label: "Hebillas" });
    await p.selectOption("select[name=idUnidadMedida]", "u");
    await p.waitForSelector("legend:text('Atributos de esta categoría')");
    await p.locator("section[aria-labelledby=paso2] fieldset:has(legend:text('Atributos de esta categoría')) .form-check:has(label:text-is('Color')) input").check();
    await p.waitForSelector("fieldset:has(legend:text('Valores de Color')) input");
    await p.locator("fieldset:has(legend:text('Valores de Color')) .form-check:has(label:text-is('Negro')) input").check();
    await p.locator("fieldset:has(legend:text('Valores de Color')) .form-check:has(label:text-is('Café')) input").check();
    ok(/Se crearán 2 variantes/.test(await p.textContent("[role=status][aria-live=polite]")), "vista previa: se crearán 2 variantes");
    await p.fill("tbody tr:nth-child(1) input[name=forma_precio]", "0.05");
    await p.click("text=Agregar forma de venta");
    await p.fill("tbody tr:nth-child(2) input[name=forma_descripcion]", "Docena");
    await p.fill("tbody tr:nth-child(2) input[name=forma_factor]", "12");
    await p.fill("tbody tr:nth-child(2) input[name=forma_precio]", "0.50");
    await p.click("button:text('Crear producto')");
    await p.waitForFunction(() => /^CE-7\d{3} · /.test(document.getElementById("tituloVista")?.textContent ?? ""), null, { timeout: 20000 });
    ok(true, "el producto se creó con código automático " + (await p.textContent("#tituloVista")).split(" ")[0]);
    ok(await p.evaluate(() => document.querySelectorAll("#tituloVariantes ~ div tbody tr, section[aria-labelledby=tituloVariantes] tbody tr").length === 2), "ficha del producto con 2 variantes");
    await p.click("[role=tab]:has-text('Formas de venta')");
    await p.click("button[aria-label='Cambiar precio de Docena']");
    await p.waitForSelector(".modal.show input[name=precioConIva]");
    ok(/con IVA/.test(await p.textContent(".modal.show label")), "el diálogo pide el precio CON IVA");
    await p.fill(".modal.show input[name=precioConIva]", "0.52");
    await p.click(".modal.show button[type=submit]");
    await p.waitForFunction(() => /Precio de Docena actualizado/.test(document.querySelector(".zona-alertas")?.textContent ?? ""));
    ok(true, "cambio de precio desde el diálogo");
    ok(/\$0[.,]52/.test(await p.textContent("section[aria-labelledby=tituloFormas]")), "la ficha muestra el precio con IVA");
    ok(await p.isVisible("section[aria-labelledby=tituloFormas]"), "tras cambiar el precio la ficha sigue en la pestaña de formas de venta");

    // ------------------------------------------------------------ Codigos automaticos
    seccion("Códigos automáticos y cuenta");
    await visitar(p, "/r/categorias/nuevo");
    ok(await p.evaluate(() => { const c = document.querySelector("input[name=codigo]"); return Boolean(c?.readOnly) && /genera/.test(c.value); }),
        "categoría nueva: código automático de solo lectura");
    ok(!(await p.locator("header button:text-is('Cambiar clave')").count()), "la cabecera ya no expone el cambio de clave");
    await p.click("#menuCuenta");
    await p.waitForSelector(".dropdown-menu.show a[href='#/mi-cuenta']");
    await p.keyboard.press("Escape");
    await visitar(p, "/mi-cuenta");
    ok(await p.isHidden("#formClave"), "Mi cuenta: el formulario de clave está plegado");
    await p.click("button[aria-controls=formClave]");
    ok(await p.evaluate(() => document.activeElement?.name === "claveActual" && document.querySelector("[aria-controls=formClave]").getAttribute("aria-expanded") === "true"),
        "al desplegarlo, el foco va a la clave actual");
    ok(await p.evaluate(() => document.querySelector("input[name=claveActual]").autocomplete === "current-password" && document.querySelector("input[name=claveNueva]").autocomplete === "new-password"),
        "autocompletado correcto (gestores de claves)");
    await p.mouse.move(0, 0); // fuera del boton: axe mide el color final, no la transicion del hover
    await p.waitForTimeout(300);
    const violacionesCuenta = await axe(p);
    ok(violacionesCuenta.length === 0, "Mi cuenta sin violaciones de axe con el formulario abierto", violacionesCuenta.join(" | "));

    // ------------------------------------------------------------ Venta de mostrador
    seccion("Venta: cliente primero, alta en línea, bandas y tallas en un ingreso");
    await visitar(p, "/ventas/nueva");
    ok(await p.isVisible("section[aria-labelledby=tituloProductos]") && await p.isHidden("section[aria-labelledby=tituloProductos] input[type=search]")
        && /Primero elige o crea el cliente/.test(await p.textContent("section[aria-labelledby=tituloProductos]")),
        "el paso 2 se ve desde el inicio, pero el buscador de productos espera al cliente");
    // cliente que no existe -> se crea ahi mismo con su cedula
    const cedulaVenta = [...Array(10).keys()].map((d) => `171${String(Date.now()).slice(-6)}${d}`).find((c) => {
        const prov = Number(c.slice(0, 2));
        if (!(prov >= 1 && prov <= 24) || Number(c[2]) >= 6) return false;
        const s = [...c.slice(0, 9)].reduce((acc, dig, i) => { let v = Number(dig) * (i % 2 === 0 ? 2 : 1); if (v > 9) v -= 9; return acc + v; }, 0);
        return (10 - (s % 10)) % 10 === Number(c[9]);
    });
    await p.fill("input[placeholder^='Nombre, cédula']", cedulaVenta);
    await p.click("form[aria-label='Buscar cliente'] button[type=submit]");
    await p.waitForSelector("button:text('Crear este cliente')");
    ok(true, "cédula sin cliente: ofrece crearlo");
    await p.click("button:text('Crear este cliente')");
    await p.waitForSelector(".modal.show input[name=identificacion]");
    ok((await p.inputValue(".modal.show input[name=identificacion]")) === cedulaVenta, "la cédula buscada pasa al formulario del cliente nuevo");
    await p.fill(".modal.show input[name=nombres]", `Calzado Visual ${unico}`);
    await p.fill(".modal.show input[name=razonSocial]", `Calzado Visual ${unico}`);
    await p.fill(".modal.show input[name=telefono]", "0987654321");
    await p.mouse.move(0, 0);
    const violCliente = await axe(p);
    ok(violCliente.length === 0, "alta de cliente sin violaciones de axe", violCliente.join(" | "));
    await p.click(".modal.show button:text('Crear cliente y usarlo')");
    await p.waitForSelector(".modal", { state: "detached" });
    ok(new RegExp(`Calzado Visual ${unico}`).test(await p.textContent("section[aria-labelledby=tituloCliente]")), "el cliente creado queda elegido");
    ok(await p.isVisible("section[aria-labelledby=tituloProductos] input[type=search]"), "con el cliente elegido aparece el buscador de productos");

    // pedido a domicilio: la direccion es obligatoria
    await p.check("input[name=entrega][value=domicilio]");
    await p.click("form.card button[type=submit]");
    ok(/dirección de entrega|al menos un producto/i.test(await p.textContent("form.card [role=alert]")), "a domicilio sin dirección: lo pide");
    await p.check("input[name=entrega][value=local]");

    // suelas: varias tallas en un solo ingreso
    await p.fill("input[placeholder^='Nombre, código']", "SR-220");
    await p.click("form[aria-label='Buscar productos para la venta'] button[type=submit]");
    await p.click("button[aria-label='Elegir Suela de caucho antideslizante modelo SR-220']");
    await p.waitForSelector(".modal.show table");
    const filasTallas = await p.locator(".modal.show tbody tr").count();
    ok(filasTallas >= 5, `suela: una fila por talla (${filasTallas}) con su cantidad`);
    // la tabla del dialogo (con campos para escribir) tambien se ordena
    await p.click(".modal.show th button.btn-orden:has-text('Disponible')");
    await p.click(".modal.show th button.btn-orden:has-text('Disponible')");
    const disponibles = await p.$$eval(".modal.show tbody tr", (fs) => fs.map((f) => Number(f.children[2].textContent.replace(/\D/g, "")) || 0));
    ok(disponibles.every((x, i) => i === 0 || disponibles[i - 1] >= x), "el diálogo por tallas se ordena por disponible (mayor a menor)", disponibles.join(","));
    ok(await p.$eval(".modal.show th[aria-sort=descending]", (th) => /Disponible/.test(th.textContent)), "el encabezado indica el orden con aria-sort");
    // las dos tallas con mas stock (las corridas anteriores venden algunas)
    const tallas = await p.$$eval(".modal.show tbody tr", (fs) => fs.map((f) => ({ talla: f.querySelector("th").textContent.trim(), disp: Number(f.children[2].textContent.replace(/\D/g, "")) || 0 }))
        .sort((a, b) => b.disp - a.disp).slice(0, 2).map((x) => x.talla));
    await p.fill(`.modal.show tbody tr:has(th:text-is('${tallas[0]}')) input`, "2");
    await p.fill(`.modal.show tbody tr:has(th:text-is('${tallas[1]}')) input`, "1");
    ok(/2 líneas/.test(await p.textContent(".modal.show [role=status]")), "subtotal en vivo con 2 líneas");
    await p.click(".modal.show button:text('Agregar a la venta')");
    await p.waitForSelector(".modal", { state: "detached" });
    ok((await p.locator(".lineas-tabla tbody tr").count()) === 2, "un ingreso de suelas -> 2 líneas (talla 38 y 40)");

    // cuero: lista de bandas, completa o media
    await p.fill("input[placeholder^='Nombre, código']", "cuero graso");
    await p.click("form[aria-label='Buscar productos para la venta'] button[type=submit]");
    await p.click("button[aria-label^='Elegir Cuero graso']");
    await p.waitForSelector(".modal.show .list-group-item input[type=checkbox]");
    const casillas = p.locator(".modal.show .list-group-item input[type=checkbox]");
    ok((await casillas.count()) >= 2, "cuero: lista de bandas con su medida");
    await casillas.nth(0).check();
    await casillas.nth(1).check();
    await p.locator(".modal.show .list-group-item").nth(1).locator("input[value=media]").check();
    ok(/Media/.test(await p.textContent(".modal.show .list-group-item:nth-child(2)")), "cada banda se marca completa o media");
    await p.mouse.move(0, 0);
    const violBandas = await axe(p);
    ok(violBandas.length === 0, "diálogo de bandas sin violaciones de axe", violBandas.join(" | "));
    await p.click(".modal.show button:text('Agregar a la venta')");
    await p.waitForSelector(".modal", { state: "detached" });
    const textoLineas = await p.textContent(".lineas-tabla tbody");
    ok(/\(completa\)/.test(textoLineas) && /\(media\)/.test(textoLineas), "las líneas dicen banda completa y media banda");

    await p.click("form.card button[type=submit]");
    await p.waitForFunction(() => /^Pedido #\d+/.test(document.getElementById("tituloVista")?.textContent ?? ""), null, { timeout: 20000 })
        .catch(async (e) => { throw new Error(`no se registró la venta: ${(await p.textContent("form.card")).slice(0, 400)}`); });
    ok(true, "venta registrada: " + (await p.textContent("#tituloVista")));

    // el pedido de prueba con bandas se cancela: libera las bandas (si no, cada corrida las agota)
    await p.click("button:text('Cancelar pedido')");
    await p.waitForSelector(".modal.show .btn-danger");
    await p.click(".modal.show .btn-danger");
    await p.waitForFunction(() => /cancelado/i.test(document.querySelector(".zona-alertas")?.textContent ?? ""), null, { timeout: 15000 });
    ok(true, "cancelar el pedido libera las bandas reservadas");

    // comprobante: un pedido de 1 suela, cobrado y facturado a nombre del cliente nuevo; avance de dinero
    await visitar(p, "/ventas/nueva");
    await p.fill("input[placeholder^='Nombre, cédula']", cedulaVenta);
    await p.click("form[aria-label='Buscar cliente'] button[type=submit]");
    await p.click(`button[aria-label='Elegir a Calzado Visual ${unico}']`);
    ok(true, "el cliente se encuentra por su cédula");
    await p.fill("input[placeholder^='Nombre, código']", "SR-220");
    await p.click("form[aria-label='Buscar productos para la venta'] button[type=submit]");
    await p.click("button[aria-label='Elegir Suela de caucho antideslizante modelo SR-220']");
    await p.waitForSelector(".modal.show tbody input[type=number]");
    await p.fill(await p.$$eval(".modal.show tbody tr", (fs) => { const f = fs.sort((a, b) => (Number(b.children[2].textContent.replace(/\\D/g, "")) || 0) - (Number(a.children[2].textContent.replace(/\\D/g, "")) || 0))[0]; return `.modal.show tbody tr:has(th:text-is('${f.querySelector("th").textContent.trim()}')) input`; }), "1");
    await p.click(".modal.show button:text('Agregar a la venta')");
    await p.waitForSelector(".modal", { state: "detached" });
    await p.click("form.card button[type=submit]");
    await p.waitForFunction(() => /^Pedido #\d+/.test(document.getElementById("tituloVista")?.textContent ?? ""), null, { timeout: 20000 });
    await p.click("button:text('Registrar pago')");
    await p.waitForSelector(".modal.show input[name=monto]");
    await p.click(".modal.show button[type=submit]");
    await p.waitForSelector(".modal", { state: "detached" });
    await p.waitForSelector("button:text('Emitir comprobante')");
    await p.click("button:text('Emitir comprobante')");
    await p.waitForSelector(".modal.show input[name=aNombre]");
    ok(new RegExp(cedulaVenta).test(await p.textContent(".modal.show")), "«A nombre de» ofrece los datos del cliente (con su cédula)");
    ok(await p.isVisible(".modal.show button:text('Nuevos datos de facturación')"), "se pueden crear datos de facturación nuevos desde el comprobante");
    await p.click(".modal.show button:text('Emitir')");
    await p.waitForSelector(".modal", { state: "detached" });
    await p.waitForFunction(() => /Comprobante emitido/.test(document.querySelector(".zona-alertas")?.textContent ?? ""));
    ok(true, "factura emitida a nombre del cliente");
    await p.click("button:text('Avance de dinero')");
    await p.waitForSelector(".modal.show input[name=monto]");
    await p.fill(".modal.show input[name=monto]", "5");
    await p.fill(".modal.show input[name=concepto]", "Pasaje de regreso");
    await p.click(".modal.show button[type=submit]");
    await p.waitForSelector(".modal.show [role=alert]:not([hidden])");
    ok(/límite de crédito/.test(await p.textContent(".modal.show [role=alert]")), "sin límite de crédito la base rechaza el avance y el motivo se muestra");
    await p.keyboard.press("Escape");
    await p.waitForSelector(".modal", { state: "detached" });
    // con limite de credito, el avance pasa y queda como cuenta por cobrar
    const idCliente = await p.evaluate(async (nombre) => {
        const h = { Authorization: `Bearer ${localStorage.getItem("ce_admin_token")}`, "Content-Type": "application/json" };
        const api = `${location.protocol}//${location.hostname}:5070/api/v1`;
        const c = (await (await fetch(`${api}/ventas/clientes?q=${encodeURIComponent(nombre)}`, { headers: h })).json()).data[0];
        await fetch(`${api}/clientes/${c.idCliente}`, { method: "PATCH", headers: h, body: JSON.stringify({ limiteCredito: 100 }) });
        return c.idCliente;
    }, `Calzado Visual ${unico}`);
    ok(Boolean(idCliente), "se le da un límite de crédito al cliente");
    await p.click("button:text('Avance de dinero')");
    await p.waitForSelector(".modal.show input[name=monto]");
    await p.fill(".modal.show input[name=monto]", "5");
    await p.fill(".modal.show input[name=concepto]", "Pasaje de regreso");
    await p.click(".modal.show button[type=submit]");
    await p.waitForSelector("section[aria-labelledby=tituloCuentas]", { timeout: 15000 });
    ok(/Avance de dinero/.test(await p.textContent("section[aria-labelledby=tituloCuentas]")), "el avance queda como cuenta por cobrar del pedido");

    // ------------------------------------------------------------ Deudas al cobrar y avance sin plazo
    seccion("Deudas del cliente al cobrar");
    await visitar(p, "/ventas/nueva");
    await p.fill("input[placeholder^='Nombre, cédula']", `Calzado Visual ${unico}`);
    await p.click("form[aria-label='Buscar cliente'] button[type=submit]");
    await p.click(`button[aria-label='Elegir a Calzado Visual ${unico}']`);
    ok(!/\bnull\b/.test(await p.textContent("main")), "la pantalla de venta no muestra «null»");
    await p.fill("input[placeholder^='Nombre, código']", "SR-220");
    await p.click("form[aria-label='Buscar productos para la venta'] button[type=submit]");
    await p.click("button[aria-label='Elegir Suela de caucho antideslizante modelo SR-220']");
    await p.waitForSelector(".modal.show tbody input[type=number]");
    ok(await p.$eval(".modal.show tbody input[type=number]", (i) => i.step === "1" && i.inputMode === "numeric"), "la cantidad es un spinner de enteros para pares");
    ok(!/\bnull\b/.test(await p.textContent(".modal.show")), "el diálogo del producto no muestra «null»");
    await p.fill(await p.$$eval(".modal.show tbody tr", (fs) => { const f = fs.sort((a, b) => (Number(b.children[2].textContent.replace(/\\D/g, "")) || 0) - (Number(a.children[2].textContent.replace(/\\D/g, "")) || 0))[0]; return `.modal.show tbody tr:has(th:text-is('${f.querySelector("th").textContent.trim()}')) input`; }), "1");
    await p.click(".modal.show button:text('Agregar a la venta')");
    await p.waitForSelector(".modal", { state: "detached" });
    await p.click("form.card button[type=submit]");
    await p.waitForFunction(() => /^Pedido #\d+/.test(document.getElementById("tituloVista")?.textContent ?? ""), null, { timeout: 20000 });
    await p.click("button:text('Registrar pago')");
    await p.waitForSelector(".modal.show input[name=monto]");
    ok(/tiene deudas/.test(await p.textContent(".modal.show")), "al cobrar se muestra que el cliente tiene deudas y cuánto");
    await p.click(".modal.show details summary");
    ok(/Pedido/.test(await p.textContent(".modal.show details[open]")), "cada cuenta por cobrar se despliega con su detalle");
    await p.click(".modal.show button:text('Cancelar')");
    await p.waitForSelector(".modal", { state: "detached" });
    await p.click("button:text('Avance de dinero')");
    await p.waitForSelector(".modal.show input[name=monto]");
    ok(!(await p.locator(".modal.show input[name=plazoDias]").count()), "el avance ya no pide un plazo");
    await p.click(".modal.show button:text('Cancelar')");
    await p.waitForSelector(".modal", { state: "detached" });
    await p.click("button:text('Cancelar pedido')");
    await p.waitForSelector(".modal.show .btn-danger");
    await p.click(".modal.show .btn-danger");
    await p.waitForFunction(() => /cancelado/i.test(document.querySelector(".zona-alertas")?.textContent ?? ""), null, { timeout: 15000 });

    // ------------------------------------------------------------ Compras: producto primero
    seccion("Orden de compra con la misma selección de productos");
    await visitar(p, "/compras/nueva");
    await p.selectOption("select[name=idProveedor]", { index: 1 });
    await p.fill("input[placeholder^='Nombre, código o categoría (vacío']", "SR-220");
    await p.click("form[aria-label='Buscar productos para la orden'] button[type=submit]");
    await p.click("button[aria-label='Elegir Suela de caucho antideslizante modelo SR-220']");
    await p.waitForSelector(".modal.show tbody input[type=number]");
    ok((await p.locator(".modal.show tbody tr").count()) >= 5, "compra: una fila por talla con stock, mínimo y en camino");
    ok(await p.$eval(".modal.show tbody tr td:nth-child(6) input", (i) => Number(i.value.replace(",", ".")) > 0), "suela (precio por talla/color): costo por fila, con el último pagado");
    await p.fill(".modal.show tbody tr:has(th:text-is('Talla 41')) td:nth-child(5) input", "12");
    await p.mouse.move(0, 0);
    const violCompra = await axe(p);
    ok(violCompra.length === 0, "diálogo de compra sin violaciones de axe", violCompra.join(" | "));
    await p.click(".modal.show button:text('Agregar a la orden')");
    await p.waitForSelector(".modal", { state: "detached" });
    // cuero: un solo costo para todos los colores, escrito con coma
    await p.fill("input[placeholder^='Nombre, código o categoría (vacío']", "cuero graso");
    await p.click("form[aria-label='Buscar productos para la orden'] button[type=submit]");
    await p.click("button[aria-label^='Elegir Cuero graso']");
    await p.waitForSelector(".modal.show .costo-compra");
    ok((await p.locator(".modal.show .costo-compra").count()) === 1 && (await p.locator(".modal.show thead th").count()) === 5,
        "cuero: UN costo para todos los colores (no una columna de costo por fila)");
    await p.fill(".modal.show .costo-compra", "1,1546");
    await p.fill(".modal.show tbody tr:nth-child(1) input[type=number]", "20");
    await p.fill(".modal.show tbody tr:nth-child(2) input[type=number]", "10.5");
    await p.click(".modal.show button:text('Agregar a la orden')");
    await p.waitForSelector(".modal", { state: "detached" });
    ok((await p.locator(".lineas-tabla tbody tr").count()) >= 3, "costo con coma aceptado: líneas de cuero (más las sugeridas) y de suela");
    await p.click("form.card button[type=submit]");
    await p.waitForFunction(() => /OC-\d+/.test(document.getElementById("tituloVista")?.textContent ?? ""), null, { timeout: 20000 })
        .catch(async () => { throw new Error(`no se guardó la OC: ${await p.textContent("form.card")}`); });
    ok(true, "orden de compra guardada como borrador: " + (await p.textContent("#tituloVista")));
    ok(await p.evaluate(() => document.documentElement.getAttribute("translate") === "no"), "la página pide al navegador no traducirla (Ventas no pasa a «Vientos»)");

    // ------------------------------------------------------------ Unidad de compra (rollos)
    seccion("Compras en la unidad del proveedor");
    await visitar(p, "/compras/nueva");
    await p.selectOption("select[name=idProveedor]", { index: 1 });
    await p.fill("input[placeholder^='Nombre, código o categoría (vacío']", "PU texturizado");
    await p.click("form[aria-label='Buscar productos para la orden'] button[type=submit]");
    await p.click("button[aria-label^='Elegir Sintético PU texturizado']");
    await p.waitForSelector(".modal.show tbody input[type=number]");
    ok(/rollos de 30 m/.test(await p.textContent(".modal.show thead")), "sintético: se pide en rollos de 30 m");
    ok(/por rollo/.test(await p.textContent(".modal.show form")), "el costo es por rollo");
    await p.fill(".modal.show tbody tr:first-child input[type=number]", "3");
    ok(/= 90 m/.test(await p.textContent(".modal.show tbody tr:first-child")), "3 rollos = 90 m (se ve la equivalencia)");
    await p.click(".modal.show button:text('Agregar a la orden')");
    await p.waitForSelector(".modal", { state: "detached" });
    await p.click("form.card button[type=submit]");
    await p.waitForFunction(() => /OC-\d+/.test(document.getElementById("tituloVista")?.textContent ?? ""), null, { timeout: 20000 });
    ok(/90 m/.test(await p.textContent(".tabla-admin tbody")) && /3 rollos/.test(await p.textContent(".tabla-admin tbody")), "la orden guarda 90 m y lo muestra como 3 rollos");
    await p.click("button:text('Emitir al proveedor')");
    await p.click(".modal.show .btn-danger, .modal.show .btn-primary");
    await p.waitForSelector("button:text('Registrar recepción')", { timeout: 15000 });
    await p.click("button:text('Registrar recepción')");
    await p.waitForSelector(".modal.show input[type=text], .modal.show input");
    ok(/rollos recibidos/.test(await p.textContent(".modal.show form")), "la recepción cuenta rollos, no metros");
    await p.click(".modal.show button:text('Cancelar')");
    await p.waitForSelector(".modal", { state: "detached" });
    // Inventario: producto -> variantes -> kardex, con busqueda instantanea
    await visitar(p, "/inventario");
    await p.fill("#contenido input[name=q]", "PU texturizado");
    await p.waitForFunction(() => /Sintético PU texturizado/.test(document.querySelector(".tabla-admin tbody")?.textContent ?? "")
        && document.querySelectorAll(".tabla-admin tbody tr").length === 1, null, { timeout: 10000 });
    ok(await p.evaluate(() => document.activeElement?.name === "q"), "inventario: la búsqueda se aplica al escribir y el foco sigue en el buscador");
    await p.click(".tabla-admin tbody a:has-text('Sintético PU texturizado')");
    await p.waitForSelector("#tituloDetalle", { timeout: 15000 });
    ok(/rollo/.test(await p.textContent("section[aria-labelledby=tituloVariantes] tbody")), "inventario del producto: el sintético también se ve en rollos");
    ok(await p.isVisible("[role=tab][aria-selected=true]:has-text('Kárdex')"), "al abrir el producto se ve el kárdex de una variante");
    const segunda = p.locator("section[aria-labelledby=tituloVariantes] tbody tr:nth-child(2) th a");
    const nombreSegunda = (await segunda.textContent()).trim();
    await segunda.click();
    await p.waitForFunction((n) => document.getElementById("tituloDetalle")?.textContent === n && document.activeElement?.id === "tituloDetalle", nombreSegunda, { timeout: 10000 });
    ok(/\?v=\d+/.test(await p.evaluate(() => window.location.hash)) && (await p.locator("tr.fila-elegida").count()) === 1,
        "elegir otra variante cambia el detalle sin recargar, marca la fila y queda en la URL");
    await p.click("[role=tab]:has-text('Lotes con saldo')");
    ok(/pestana=lotes/.test(await p.evaluate(() => window.location.hash)), "la pestaña de lotes queda en la URL");
    await p.mouse.move(0, 0);
    const violInv = await axe(p);
    ok(violInv.length === 0, "inventario del producto sin violaciones de axe", violInv.join(" | "));

    // ------------------------------------------------------------ Recibo con numero automatico
    await visitar(p, "/compras/comprobantes");
    await p.click("button:text('Registrar factura')");
    await p.waitForSelector(".modal.show select[name=tipo]");
    await p.waitForTimeout(400);
    await p.selectOption(".modal.show select[name=tipo]", "00");
    ok(await p.$eval(".modal.show input[name=numero]", (i) => i.readOnly && /genera/.test(i.value)), "recibo: el número es automático y de solo lectura");
    ok(await p.$eval(".modal.show input[name=iva]", (i) => i.disabled), "recibo: sin IVA (campos de IVA deshabilitados)");
    await p.selectOption(".modal.show select[name=tipo]", "01");
    ok(await p.$eval(".modal.show input[name=numero]", (i) => !i.readOnly && i.value === ""), "factura: el número vuelve a escribirse");
    await p.click(".modal.show .btn-close");
    await p.waitForSelector(".modal", { state: "detached" });

    // ------------------------------------------------------------ Orden en columnas calculadas
    seccion("Todas las tablas se ordenan");
    await visitar(p, "/productos");
    await elegirOrden(p, "Disponible: de mayor a menor");
    await p.waitForFunction(() => document.querySelector("th[aria-sort=descending]")?.textContent.includes("Disponible"), null, { timeout: 15000 });
    const dispProductos = await p.$$eval(".tabla-admin tbody tr", (fs) => fs.map((f) => Number(f.children[6].textContent.replace(/[^\d,]/g, "").replace(",", ".")) || 0));
    ok(dispProductos.every((x, i) => i === 0 || dispProductos[i - 1] >= x), "productos por disponible (columna calculada, la ordena el servidor)", dispProductos.join(","));
    await visitar(p, "/r/ciudades");
    await elegirOrden(p, "Provincia: Z → A");
    await p.waitForFunction(() => document.querySelector("th[aria-sort=descending]"), null, { timeout: 15000 });
    ok(/Zamora/.test(await p.textContent(".tabla-admin tbody tr:first-child")), "ciudades por provincia (clave foránea ordenada por su nombre)");
    await visitar(p, "/usuarios");
    ok((await p.$$eval("select[id^=ordenar] option", (os) => os.map((o) => o.textContent))).some((x) => /^Roles/.test(x)), "usuarios: también por rol y por empleado");

    // ------------------------------------------------------------ Seguridad e inventario
    seccion("Roles editables, usuario estándar y ajustes de inventario");
    await visitar(p, "/roles");
    await p.click("button:text('Nuevo rol')");
    await p.waitForSelector(".modal.show input[name=nombre]");
    await p.fill(".modal.show input[name=nombre]", `Cajero visual ${unico.replace(/\d/g, "x")}`);
    await p.locator(".modal.show input[name=permisos][value=VENTA_REGISTRAR]").check();
    await p.mouse.move(0, 0);
    const violRol = await axe(p);
    ok(violRol.length === 0, "diálogo de rol sin violaciones de axe", violRol.join(" | "));
    await p.click(".modal.show button:text('Crear rol')");
    await p.waitForFunction(() => /Rol creado/.test(document.querySelector(".zona-alertas")?.textContent ?? ""), null, { timeout: 15000 });
    ok(true, "rol creado desde su sección, con sus permisos");
    await p.click(`button[aria-label^='Eliminar el rol Cajero visual']`);
    await p.click(".modal.show .btn-danger");
    await p.waitForFunction(() => /eliminado/.test(document.querySelector(".zona-alertas")?.textContent ?? ""), null, { timeout: 15000 });
    ok(true, "rol sin usuarios eliminado");
    await p.click("button[aria-label='Editar el rol Administrador'], button[aria-label^='Editar el rol Admin']");
    await p.waitForSelector(".modal.show input[name=permisos]");
    ok(await p.$eval(".modal.show input[value=USUARIO_GESTIONAR]", (i) => i.disabled && i.checked), "ADMIN conserva siempre el permiso de gestionar usuarios");
    await p.click(".modal.show button:text('Cancelar')");
    await p.waitForSelector(".modal", { state: "detached" });

    await visitar(p, "/usuarios");
    await p.click("button:text('Nuevo usuario')");
    await p.waitForSelector(".modal.show input[name=nombres]");
    await p.fill(".modal.show input[name=nombres]", "José María");
    await p.fill(".modal.show input[name=apellidos]", "Pérez Núñez");
    await p.press(".modal.show input[name=apellidos]", "Tab");
    await p.waitForFunction(() => /^joperez\d*@comercialelite\.ec$/.test(document.querySelector(".modal.show input[name=usuarioGenerado]")?.value ?? ""), null, { timeout: 10000 });
    ok(true, "usuario estándar: José María Pérez → joperez@comercialelite.ec (solo lectura)");
    await p.click(".modal.show button:text('Cancelar')");
    await p.waitForSelector(".modal", { state: "detached" });

    await visitar(p, "/inventario");
    await p.click(".tabla-admin tbody tr:first-child th + td a");
    await p.waitForSelector("#tituloDetalle", { timeout: 15000 });
    await p.click("button:text('Registrar ajuste')");
    await p.waitForSelector(".modal.show select[name=tipo]");
    ok(/Stock físico actual/.test(await p.textContent(".modal.show")), "inventario: «Registrar ajuste» de la variante elegida, con el stock actual a la vista");
    await p.click(".modal.show button:text('Cancelar')");
    await p.waitForSelector(".modal", { state: "detached" });

    // ------------------------------------------------------------ Reportes y tableros
    seccion("Reportes y tableros");
    await visitar(p, "/reportes");
    await p.waitForSelector(".grilla-indicadores .indicador");
    ok((await p.locator(".grilla-indicadores .indicador").count()) >= 6, "indicadores del período con su comparación");
    await p.waitForFunction(() => document.querySelectorAll(".grilla-widgets .grafico-barras, .grilla-widgets .tabla-con-orden, .grilla-widgets [role=status]").length >= 4, null, { timeout: 15000 });
    ok(true, "el tablero general carga sus widgets desde la configuración de la API");
    ok((await p.locator(".grilla-reportes li").count()) >= 10, "catálogo de reportes por categoría, cada uno con su pregunta");
    await p.mouse.move(0, 0);
    await p.waitForTimeout(300);
    const violacionesReportes = await axe(p);
    ok(violacionesReportes.length === 0, "reportes y tablero sin violaciones de axe", violacionesReportes.join(" | "));
    ok(await p.isHidden("input[id^=desde]"), "con un atajo de período, las fechas no se muestran");
    await p.selectOption("select[id^=atajo]", "otro");
    ok(await p.isVisible("input[id^=desde]"), "«Otras fechas…» muestra Desde y Hasta");
    await p.fill("input[id^=desde]", "2026-11-30");
    await p.fill("input[id^=hasta]", "2026-11-01");
    await p.click("form.filtro-periodo button[type=submit]");
    ok(/anterior o igual/.test(await p.textContent("form.filtro-periodo")), "período al revés: error en texto junto al filtro");
    await visitar(p, "/reportes/categoria/Ventas");
    ok((await p.locator(".grilla-reportes li").count()) >= 4, "Reportes de ventas: solo los de esa categoría");
        await visitar(p, "/reportes/ventas-por-periodo?desde=2026-11-01&hasta=2026-11-30&agrupar=dia");
    ok(await p.isVisible(".grafico-barras"), "reporte con gráfico de barras accesible");
    ok(/Totales: Pedidos/.test(await p.textContent(".totales-reporte")), "el reporte muestra sus totales");
    const [descarga] = await Promise.all([p.waitForEvent("download"), p.click("button:text('Descargar CSV (Excel)')")]);
    ok(/ventas-por-periodo\.csv$/.test(descarga.suggestedFilename()), "descarga CSV del reporte");
    const violacionesReporte = await axe(p);
    ok(violacionesReporte.length === 0, "detalle del reporte sin violaciones de axe", violacionesReporte.join(" | "));

    // ------------------------------------------------------------ Varias ventanas
    seccion("Sesión compartida entre ventanas");
    const otra = await p.context().newPage();
    await otra.goto(`${BASE}#/productos`);
    ok(await otra.waitForSelector("#contenidoMenu a", { state: "attached", timeout: 10000 }).then(() => true).catch(() => false),
        "otra ventana del mismo navegador entra sin volver a iniciar sesión");
    await otra.click("#menuCuenta");
    await otra.click(".dropdown-menu.show button:text('Cerrar sesión')");
    ok(await p.waitForSelector("form input[type=email]", { timeout: 10000 }).then(() => true).catch(() => false),
        "cerrar sesión en una ventana la cierra en las demás");
    await otra.close();
    await ingresar(p);
    ok(p.errores.length === 0, "sin errores de JavaScript en los flujos", p.errores.join(" | "));
} catch (error) {
    fallos += 1;
    console.error("✖ La verificación se interrumpió:", error.message);
} finally {
    await navegador.close();
    servidor.close();
}

console.log(`\n${fallos === 0 ? "✔" : "✖"} ${pruebas - fallos} de ${pruebas} verificaciones en navegador.`);
process.exit(fallos === 0 ? 0 : 1);
