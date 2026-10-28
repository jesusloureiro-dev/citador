/*
 * Citador — estilos de bibliografía.
 * Estilos incluidos (escritos para Citador), estilos propios del usuario y el estilo
 * que viaja dentro de cada documento.
 */
(function (root) {
  "use strict";

  var B = root.CitadorBib, S = root.CitadorStore;

  function builtins() { return B.builtinStyles().map(B.completeStyle); }

  function userStyles() {
    var all = S.getPref("userStyles", {}) || {};
    return Object.keys(all).map(function (k) { return B.completeStyle(all[k]); });
  }

  function find(id) {
    var list = builtins().concat(userStyles());
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function save(style) {
    var all = S.getPref("userStyles", {}) || {};
    var s = B.clone(style);
    delete s.builtin;
    if (!s.id || /^(vancouver|ama|apa|harvard)$/.test(s.id)) s.id = "user-" + S.newKey(6);
    s.updated = Date.now();
    all[s.id] = s;
    S.setPref("userStyles", all);
    return B.completeStyle(s);
  }

  function remove(id) {
    var all = S.getPref("userStyles", {}) || {};
    delete all[id];
    S.setPref("userStyles", all);
  }

  function isMine(id) { var all = S.getPref("userStyles", {}) || {}; return !!all[id]; }

  /** Archivo para compartir un estilo. */
  function toFile(style) {
    var s = B.clone(style);
    delete s.builtin;
    return JSON.stringify({ format: "citador-style", version: 1, style: s }, null, 2);
  }

  function fromFile(text) {
    var j = JSON.parse(text);
    var s = j && j.format === "citador-style" ? j.style : j;
    if (!s || !s.templates || !s.names) throw new Error("El archivo no es un estilo de Citador.");
    return B.completeStyle(s);
  }

  root.CitadorStyles = { builtins: builtins, userStyles: userStyles, find: find, save: save, remove: remove, isMine: isMine, toFile: toFile, fromFile: fromFile };
})(window);
