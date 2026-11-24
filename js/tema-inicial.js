// js/tema-inicial.js — se ejecuta antes de pintar la pagina: aplica el tema
// guardado o, si no hay, el del sistema (prefers-color-scheme). Script clasico
// (no modulo) para que corra de inmediato en el <head>.
(function () {
  var guardado = null;
  try {
    guardado = window.localStorage.getItem("ce_admin_tema");
  } catch (e) {
    guardado = null;
  }
  var oscuro = guardado ? guardado === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-bs-theme", oscuro ? "dark" : "light");
})();
