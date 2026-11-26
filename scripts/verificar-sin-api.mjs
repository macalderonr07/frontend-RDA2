// scripts/verificar-sin-api.mjs — verificacion del frontend SIN la API
// (npm run verificar:sin-api). La usa GitHub Actions del repositorio del
// frontend, donde no corre Oracle. Comprueba en Chromium real:
//  1. Todos los modulos JS cargan sin errores (el import de app.js arrastra
//     todo el MVC: un error de sintaxis o un import roto aparece aqui).
//  2. Pantalla de ingreso sin violaciones WCAG 2.2 AA (axe) en claro, oscuro
//     y celular (375 px), sin scroll horizontal.
//  3. "Saltar al contenido" es el primer foco; foco visible de 3 px.
//  4. Errores accesibles: campos vacios -> resumen enfocado con enlaces y
//     aria-invalid; API caida -> mensaje claro en el resumen.
// La verificacion completa (todas las pantallas y flujos) es npm run verificar,
// que necesita la API de administracion corriendo.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { crearServidor } from "./servir.mjs";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const PUERTO = 8092;
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

const servidor = crearServidor();
await new Promise((r) => servidor.listen(PUERTO, r));
const navegador = await chromium.launch();

async function axe(pagina) {
    await pagina.addScriptTag({ content: AXE });
    const r = await pagina.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }));
    return r.violations.map((v) => `${v.id}: ${v.nodes.length}`);
}

try {
    for (const caso of [
        { nombre: "claro, escritorio", ancho: 1366, tema: "light" },
        { nombre: "oscuro, escritorio", ancho: 1366, tema: "dark" },
        { nombre: "claro, celular 375 px", ancho: 375, tema: "light" },
    ]) {
        console.log(`\n▶ Ingreso (${caso.nombre})`);
        const contexto = await navegador.newContext({ viewport: { width: caso.ancho, height: 800 }, colorScheme: caso.tema === "dark" ? "dark" : "light" });
        const p = await contexto.newPage();
        const errores = [];
        p.on("pageerror", (e) => errores.push(e.message));
        await p.goto(BASE);
        await p.waitForSelector("#tituloVista");
        if (caso.tema === "dark") await p.evaluate(() => document.documentElement.setAttribute("data-bs-theme", "dark"));
        ok(errores.length === 0, "los módulos JS cargan sin errores", errores.join(" | "));
        const violaciones = await axe(p);
        ok(violaciones.length === 0, "sin violaciones de axe (WCAG 2.2 AA)", violaciones.join(" | "));
        ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "sin scroll horizontal");
        await contexto.close();
    }

    console.log("\n▶ Teclado y errores accesibles");
    const p = await navegador.newPage();
    await p.goto(BASE);
    await p.waitForSelector("#tituloVista");
    // el orden de tabulacion empieza por el enlace de salto (al cargar, el foco esta en el titulo)
    ok(await p.evaluate(() => {
        const enfocables = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
            .filter((e) => !e.disabled && !e.closest("[hidden]"));
        return enfocables[0]?.textContent.includes("Saltar al contenido");
    }), "«Saltar al contenido» es el primer elemento enfocable");
    await p.focus("input[name=correo]");
    const contorno = await p.evaluate(() => {
        const b = document.querySelector("form button[type=submit]");
        b.focus({ focusVisible: true });
        const s = getComputedStyle(b);
        return { ancho: s.outlineWidth, estilo: s.outlineStyle };
    });
    ok(contorno.ancho === "3px" && contorno.estilo === "solid", "foco visible: contorno sólido de 3 px", JSON.stringify(contorno));
    const tienda = p.getByRole("link", { name: "Ir a la tienda en línea" });
    ok((await tienda.count()) === 1 && (await tienda.getAttribute("href")) === "http://localhost:8080/",
        "el ingreso tiene un enlace a la tienda (en local, el puerto 8080)", await tienda.getAttribute("href").catch(() => ""));

    await p.click("form button[type=submit]");
    ok(await p.evaluate(() => document.activeElement?.matches("[role=alert], .resumen-errores, [tabindex='-1']") && /Revisa estos datos/.test(document.activeElement.textContent)),
        "enviar vacío: el resumen de errores recibe el foco");
    ok((await p.locator("[aria-invalid=true]").count()) === 2, "los dos campos quedan con aria-invalid");
    await p.click("text=Escribe tu clave.");
    ok(await p.evaluate(() => document.activeElement?.name === "clave"), "el enlace del resumen lleva el foco al campo");

    await p.fill("input[name=correo]", "nadie@comercialelite.ec");
    await p.fill("input[name=clave]", "una-clave-cualquiera");
    await p.click("form button[type=submit]");
    await p.waitForFunction(() => !document.querySelector("form button[aria-busy=true]"), null, { timeout: 20000 });
    const mensaje = (await p.textContent("form")) ?? "";
    ok(/API|conectar|servidor|red/i.test(mensaje), "API caída: el ingreso muestra un mensaje claro", mensaje.slice(0, 200));
} catch (error) {
    fallos += 1;
    console.error(`✖ La verificación se interrumpió: ${error.message}`);
} finally {
    await navegador.close();
    servidor.close();
}

console.log(`\n${fallos ? "✖" : "✔"} ${pruebas - fallos} de ${pruebas} verificaciones sin API.`);
process.exit(fallos ? 1 : 0);
