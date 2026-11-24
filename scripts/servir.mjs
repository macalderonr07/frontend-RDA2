// scripts/servir.mjs — servidor estatico de desarrollo (npm run serve):
// http://localhost:8090. Solo sirve archivos de esta carpeta (sin salir de ella).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = Number(process.env.PORT ?? 8090);
const TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
};

export function crearServidor() {
    return createServer(async (req, res) => {
        const ruta = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[/\\]+/, "") || "index.html";
        const archivo = join(RAIZ, ruta);
        if (!archivo.startsWith(RAIZ + sep) || ruta.includes("node_modules") || ruta.startsWith("scripts")) {
            res.writeHead(404).end("No encontrado");
            return;
        }
        try {
            const cuerpo = await readFile(archivo);
            res.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] ?? "application/octet-stream", "Cache-Control": "no-store" });
            res.end(cuerpo);
        } catch {
            res.writeHead(404).end("No encontrado");
        }
    });
}

// fileURLToPath: la ruta del repo tiene espacios (la URL los trae como %20)
if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    crearServidor().listen(PUERTO, () => console.log(`Administración en http://localhost:${PUERTO}`));
}
