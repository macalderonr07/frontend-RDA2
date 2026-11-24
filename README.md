# Administración de Comercial Elite (frontend)

Interfaz web de la administración: tablero, productos (alta guiada con
variantes y formas de venta), ofertas, combos, inventario (existencias,
lotes o bandas, kárdex, ajustes, fraccionamiento), compras (órdenes,
recepción, facturas de proveedores), ventas (pedidos, venta de mostrador,
pagos, comprobantes, cobros), talento humano, usuarios y roles, reportes y
el CRUD de todos los catálogos.

- **HTML5 semántico**: `header`, `nav`, `main`, `section`, `footer`, títulos
  jerárquicos, tablas con `caption` y `th scope`, formularios con `label`,
  `fieldset` y `legend`.
- **Bootstrap 5.3.3** (CDN con versión fija e integridad SRI verificada) +
  **CSS3 propio** (`css/admin.css`) con **CSS Grid** adaptable: el menú
  lateral pasa a offcanvas en celular; las grillas de formularios e
  indicadores se acomodan solas (`auto-fit`, `minmax`).
- **Tema claro y oscuro** (diseño reversible): sigue `prefers-color-scheme`,
  tiene un botón con `aria-pressed` y se recuerda en el navegador.
- **JavaScript ES6+ en módulos** con arquitectura **MVC**, sin frameworks de
  JS más allá de Bootstrap.
- **Datos en JSON** desde la API de administración (`../servidor`), con
  `fetch`.

## Arquitectura MVC

```
index.html            marco de la aplicación (cabecera, menú, contenido, pie, regiones aria-live)
css/admin.css         tokens de color con contraste medido, foco visible, grid
js/app.js             arranque: sesión, menú por permisos, tema y rutas
js/core/
  api.js              cliente fetch JSON: token, tiempo límite, ErrorApi con errores por campo
  sesion.js           sesion compartida entre ventanas (localStorage), cierre por 30 min de inactividad
  router.js           router por hash (#/productos/12?pagina=2)
  validacion.js       regex de /api/v1/meta, aria-invalid, resumen de errores
  dom.js              el()/montar(): DOM con textContent (nunca innerHTML con datos), anuncios
js/models/            MODELO: AuthModelo, RecursoModelo (CRUD genérico) y modelos de negocio
js/views/             VISTA: componentes accesibles, formulario genérico, vistas por módulo
js/controllers/       CONTROLADOR: une modelo y vista por sección, maneja errores
scripts/servir.mjs    servidor estático de desarrollo
scripts/verificar.mjs verificación en navegador (Playwright + axe-core)
```

Los módulos pequeños (compras, ventas, seguridad, reportes) componen su vista
dentro del controlador con los componentes de `views/componentes.js`. Los de
más lógica de presentación (productos, inventario, CRUD genérico) tienen su
archivo de vista propio.

**El CRUD de los catálogos no se programa tabla por tabla.** La API publica en
`GET /api/v1/meta` la descripción de cada recurso (campos, tipos, relaciones,
permiso) y las expresiones regulares. El controlador genérico arma con eso la
lista (búsqueda, filtros, paginación) y el formulario. Las regex son las
**mismas** que aplica el servidor: lo que el navegador acepta, el servidor
también.

## Accesibilidad (WCAG 2.2 AA)

- **Teclado:** todo es operable con teclado, porque los controles son nativos
  (`button`, `a`, `input`, `select`).
  - "Saltar al contenido principal" es el primer elemento enfocable.
  - Los diálogos atrapan el foco, cierran con Esc y devuelven el foco a quien
    los abrió.
- **Foco visible:** contorno sólido de 3 px con separación, en todos los
  controles y en los dos temas.
- **Navegación:** al cambiar de sección, el foco va al título (`h1`
  enfocable) y `document.title` cambia. El menú marca la sección actual con
  `aria-current="page"`.
- **Errores accesibles:**
  - Cada campo inválido lleva `aria-invalid` y su mensaje está enlazado con
    `aria-describedby`.
  - Al enviar con errores aparece un **resumen** (`role="alert"`) que recibe
    el foco, con un enlace por error que lleva al campo.
  - Los errores que devuelve el servidor se marcan en su campo.
  - Los avisos van a regiones `aria-live`.
- **Contraste:** todos los colores de texto y controles se midieron (cifras en
  `css/admin.css`). En modo oscuro se corrigieron los botones de contorno de
  Bootstrap, que quedaban en 3.79:1.
- **Objetivos de al menos 44 px**, `prefers-reduced-motion` respetado, sin
  scroll horizontal a 375 px y tablas anchas desplazables y enfocables.
- **El estado nunca se indica solo con color:** las insignias dicen su estado
  en texto.

## Experiencia de uso (IHC)

Revisión del 24/11/2026 con capturas reales del panel, contra las
heurísticas de Nielsen y la ley de Hick. Lo que se cambió y por qué:

| Problema encontrado | Principio | Cambio |
|---|---|---|
| El inventario era una lista plana de 245 SKU (10 páginas), con dos botones por fila; para ver el kárdex de un color había que adivinar su SKU | Coincidencia con el mundo real; reconocer antes que recordar | **Producto → variantes → kárdex/lotes**, igual que en Productos: lista de productos, ficha con totales, tabla de variantes (maestro) y el kárdex o los lotes de la elegida (detalle) en pestañas, sin recargar la página. La variante y la pestaña quedan en la URL (`#/inventario/producto/3?v=5&pestana=lotes`) |
| La ficha de producto apilaba cuatro bloques largos (formas, variantes, descuentos, formulario) | Divulgación progresiva; estética minimalista | Pestañas accesibles (patrón ARIA *tabs*: flechas, Inicio y Fin). La pestaña abierta se conserva tras cada acción |
| Menú con contadores, tablas auxiliares (teléfonos, direcciones, provincias…) mezcladas con las tareas y orden que no seguía el uso | Ley de Hick; estética minimalista | Secciones en orden de uso (Ventas, Productos, Inventario, Compras, Reportes…), cada una empieza por su tarea principal; las tablas auxiliares van en **Configuración**; sin contadores |
| Filtros con botón «Aplicar» | Eficiencia; visibilidad del estado | Búsqueda instantánea (espera de 400 ms) y filtros que se aplican al cambiar; el foco y el cursor siguen en el buscador |
| «Ordenar por» encima de cada tabla, también en escritorio, donde los encabezados ya ordenan | Consistencia; minimalismo | El menú solo aparece en celular, donde los encabezados quedan fuera de la vista |
| La venta mostraba los pasos 1 y 3; el 2 aparecía de golpe | Visibilidad del estado del sistema | El paso 2 se ve siempre, con la indicación «Primero elige o crea el cliente» |
| Sin atajos a las tareas frecuentes | Flexibilidad y eficiencia | Accesos rápidos en el Inicio (Nueva venta, Nueva orden de compra, Nuevo producto, Consultar inventario), según los permisos |
| Kárdex con códigos internos (`FRE · …`) y correos completos | Lenguaje del usuario | Nombre del movimiento con su documento debajo, entradas `+` y salidas `−` (signo y color), usuario corto con el correo en el `title` |

## Uso

Requiere la API de administración corriendo (repositorio
[Backend-RDA2](https://github.com/macalderonr07/Backend-RDA2), carpeta
`api-administracion`, puerto 5070).

```bash
npm install          # solo para la verificación (Playwright y axe-core)
npm run serve        # http://localhost:8090
npm run verificar    # 196 verificaciones en navegador (la API debe estar corriendo)
npm run verificar:sin-api   # accesibilidad del ingreso, teclado y errores, sin API
```

`npm run auditar:formularios` recorre **todos** los formularios (el CRUD de
cada recurso, los asistentes y los diálogos: 45) y comprueba en cada campo:
etiqueta, mensaje de error enlazado con `aria-describedby`, `aria-invalid` al
fallar, resumen de errores que recibe el foco y enlaces que llevan el foco a
cada campo.

`npm run verificar` recorre las 49 pantallas en modo claro, y una muestra en
oscuro y en celular, con axe-core (WCAG 2.2 AA). Revisa además teclado, foco,
errores accesibles y los flujos de CRUD genérico, alta de producto con el
asistente y cambio de precio. Ingresa con el administrador del `.env` del
servidor, sin mostrar la clave.

> La API vive en el puerto **5070**: el 5060 es un puerto prohibido para
> `fetch` en todos los navegadores.

## Publicación (GitHub Pages)

[`verificar-y-publicar.yml`](.github/workflows/verificar-y-publicar.yml) hace
tres cosas:

1. Verifica:
   - la sintaxis de todos los módulos;
   - Bootstrap con SRI;
   - `npm run verificar:sin-api` en Chromium.
2. Revisa la seguridad con `npm audit` y gitleaks.
3. Solo si todo pasa, publica en Pages.

La URL de la API sale de la variable del repositorio **`ADMIN_API_URL`**, que
debe ser https. Está en *Settings › Secrets and variables › Actions ›
Variables*, y el workflow la escribe en `js/config.js`.

- **Sin la variable:** el ingreso avisa que falta configurar la API.
- **En la API:** el dominio de Pages debe estar en `CLIENT_ORIGIN`, por CORS.
