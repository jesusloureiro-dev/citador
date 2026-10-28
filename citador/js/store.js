/*
 * Citador — almacenamiento.
 *  - Biblioteca personal y bibliotecas con nombre: almacenamiento local del complemento.
 *  - Datos del documento (referencias del artículo, citas, estilo): una parte XML
 *    propia dentro del .docx («Custom XML Part»). La puede leer cualquier versión de
 *    Citador, sea cual sea su identificador, y viaja con el archivo.
 */
(function (root) {
  "use strict";

  var LIB_KEY = "citador.library.v1";
  var PREF_KEY = "citador.prefs.v1";
  var NS = "urn:citador:document:v1";

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function newKey(n) {
    var s = "", chars = "abcdefghijkmnpqrstuvwxyz23456789";
    var arr = new Uint32Array(n || 6);
    (root.crypto || window.crypto).getRandomValues(arr);
    for (var i = 0; i < arr.length; i++) s += chars[arr[i] % chars.length];
    return s;
  }

  // ---------------------------------------------------------------------------
  // Biblioteca personal
  // ---------------------------------------------------------------------------
  var lib = { items: {} };
  (function load() {
    var raw = safeGet(LIB_KEY);
    if (raw) { try { lib = JSON.parse(raw) || lib; } catch (e) { /* vacía */ } }
    if (!lib.items) lib.items = {};
  })();

  var saveTimer = null, lastSaveOk = true;
  function saveLib() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { lastSaveOk = safeSet(LIB_KEY, JSON.stringify(lib)); }, 150);
  }

  function index(items) {
    var idx = {};
    Object.keys(items).forEach(function (k) {
      root.CitadorImport.identityKeys(items[k]).forEach(function (ik) { idx[ik] = k; });
    });
    return idx;
  }

  /** Añade referencias evitando duplicados. Devuelve {keys, added, existing}. */
  function addItems(items, extraPool) {
    var pool = {};
    Object.keys(lib.items).forEach(function (k) { pool[k] = lib.items[k]; });
    if (extraPool) Object.keys(extraPool).forEach(function (k) { if (!pool[k]) pool[k] = extraPool[k]; });
    var idx = index(pool);
    var keys = [], added = 0, existing = 0;
    items.forEach(function (it) {
      var found = null;
      root.CitadorImport.identityKeys(it).some(function (ik) { if (idx[ik]) { found = idx[ik]; return true; } return false; });
      if (found) {
        existing++;
        if (!lib.items[found] && pool[found]) lib.items[found] = pool[found];
        if (keys.indexOf(found) < 0) keys.push(found);
        return;
      }
      var k = it.id && !pool[it.id] && /^[a-z0-9]{4,12}$/.test(it.id) ? it.id : newKey(6);
      while (pool[k]) k = newKey(6);
      var copy = JSON.parse(JSON.stringify(it));
      copy.id = k;
      copy._added = Date.now();
      lib.items[k] = copy;
      pool[k] = copy;
      root.CitadorImport.identityKeys(copy).forEach(function (ik) { idx[ik] = k; });
      keys.push(k);
      added++;
    });
    saveLib();
    return { keys: keys, added: added, existing: existing };
  }

  function putItem(key, item) {
    var copy = JSON.parse(JSON.stringify(item));
    copy.id = key;
    if (!copy._added) copy._added = (lib.items[key] && lib.items[key]._added) || Date.now();
    lib.items[key] = copy;
    saveLib();
    return copy;
  }

  function deleteItem(key) {
    delete lib.items[key];
    var cols = getPref("collections", []) || [];
    cols.forEach(function (c) { c.keys = c.keys.filter(function (k) { return k !== key; }); });
    setPref("collections", cols);
    saveLib();
  }
  function getItem(key) { return lib.items[key] || null; }
  function allItems() { return lib.items; }

  function mergeFromDocument(docItems) {
    var n = 0;
    Object.keys(docItems || {}).forEach(function (k) {
      if (!lib.items[k]) { lib.items[k] = JSON.parse(JSON.stringify(docItems[k])); n++; }
    });
    if (n) saveLib();
    return n;
  }

  // ---------------------------------------------------------------------------
  // Preferencias
  // ---------------------------------------------------------------------------
  var prefs = {};
  (function () { var raw = safeGet(PREF_KEY); if (raw) { try { prefs = JSON.parse(raw) || {}; } catch (e) { prefs = {}; } } })();
  function getPref(k, d) { return prefs[k] === undefined ? d : JSON.parse(JSON.stringify(prefs[k])); }
  function setPref(k, v) { prefs[k] = v; safeSet(PREF_KEY, JSON.stringify(prefs)); }

  // ---------------------------------------------------------------------------
  // Bibliotecas con nombre
  // ---------------------------------------------------------------------------
  function collections() { return getPref("collections", []) || []; }
  function saveCollections(c) { setPref("collections", c); }
  function createCollection(name, keys) {
    var cols = collections();
    var c = { id: newKey(8), name: name, keys: (keys || []).slice() };
    cols.push(c); saveCollections(cols);
    return c;
  }
  function addToCollection(id, keys) {
    var cols = collections();
    cols.forEach(function (c) {
      if (c.id !== id) return;
      keys.forEach(function (k) { if (c.keys.indexOf(k) < 0) c.keys.push(k); });
    });
    saveCollections(cols);
  }
  function removeFromCollection(id, keys) {
    var cols = collections();
    cols.forEach(function (c) { if (c.id === id) c.keys = c.keys.filter(function (k) { return keys.indexOf(k) < 0; }); });
    saveCollections(cols);
  }
  function renameCollection(id, name) {
    var cols = collections();
    cols.forEach(function (c) { if (c.id === id) c.name = name; });
    saveCollections(cols);
  }
  function deleteCollection(id) { saveCollections(collections().filter(function (c) { return c.id !== id; })); }

  // ---------------------------------------------------------------------------
  // Datos del documento: Custom XML Part
  // ---------------------------------------------------------------------------
  var memoryDoc = null;

  function hasXmlParts() {
    return !!(root.Office && Office.context && Office.context.document && Office.context.document.customXmlParts);
  }

  function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function toXml(doc) {
    return '<citador xmlns="' + NS + '" version="2"><data>' + xmlEsc(JSON.stringify({
      items: doc.items, cites: doc.cites, config: doc.config, library: doc.library || null
    })) + "</data></citador>";
  }

  function fromXml(xml) {
    var d = new DOMParser().parseFromString(xml, "application/xml");
    var el = d.getElementsByTagNameNS(NS, "data")[0] || d.getElementsByTagName("data")[0];
    return el ? JSON.parse(el.textContent) : null;
  }

  function call(fn) {
    return new Promise(function (resolve, reject) {
      fn(function (res) {
        if (res.status === Office.AsyncResultStatus.Failed) reject(res.error); else resolve(res.value);
      });
    });
  }

  function legacySettings() {
    try {
      var s = Office.context.document.settings;
      var items = s.get("citador.items"), cites = s.get("citador.cites"), config = s.get("citador.config");
      if (items || cites) return { items: items || {}, cites: cites || {}, config: config || null };
    } catch (e) { /* sin datos antiguos */ }
    return null;
  }

  /** Lee los datos del documento (Promise). */
  function readDoc() {
    var empty = { items: {}, cites: {}, config: null, library: null };
    if (!hasXmlParts()) return Promise.resolve(memoryDoc ? JSON.parse(JSON.stringify(memoryDoc)) : empty);
    var parts = Office.context.document.customXmlParts;
    return call(function (cb) { parts.getByNamespaceAsync(NS, cb); }).then(function (list) {
      if (!list || !list.length) {
        var legacy = legacySettings();
        return legacy ? Object.assign(empty, legacy, { migrated: true }) : empty;
      }
      return call(function (cb) { list[list.length - 1].getXmlAsync(cb); }).then(function (xml) {
        var d = fromXml(xml) || {};
        return { items: d.items || {}, cites: d.cites || {}, config: d.config || null, library: d.library || null };
      });
    }).catch(function () { return legacySettings() || empty; });
  }

  var writeChain = Promise.resolve(), writeTimer = null, pendingDoc = null;

  function writeNow(doc) {
    if (!hasXmlParts()) { memoryDoc = JSON.parse(JSON.stringify(doc)); return Promise.resolve(); }
    var parts = Office.context.document.customXmlParts;
    var xml = toXml(doc);
    return call(function (cb) { parts.getByNamespaceAsync(NS, cb); }).then(function (list) {
      return (list || []).reduce(function (p, part) {
        return p.then(function () { return call(function (cb) { part.deleteAsync(cb); }); });
      }, Promise.resolve());
    }).then(function () {
      return call(function (cb) { parts.addAsync(xml, cb); });
    });
  }

  /** Guarda los datos del documento (agrupa cambios seguidos). */
  function writeDoc(doc) {
    pendingDoc = doc;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(function () {
      var d = JSON.parse(JSON.stringify(pendingDoc));
      writeChain = writeChain.then(function () { return writeNow(d); }).catch(function (e) { console.error("Citador: no se pudo guardar en el documento", e); });
    }, 400);
  }

  root.CitadorStore = {
    NS: NS,
    newKey: newKey,
    addItems: addItems, putItem: putItem, deleteItem: deleteItem, getItem: getItem, allItems: allItems,
    mergeFromDocument: mergeFromDocument,
    getPref: getPref, setPref: setPref,
    collections: collections, createCollection: createCollection, addToCollection: addToCollection,
    removeFromCollection: removeFromCollection, renameCollection: renameCollection, deleteCollection: deleteCollection,
    readDoc: readDoc, writeDoc: writeDoc, toXml: toXml, fromXml: fromXml,
    lastSaveOk: function () { return lastSaveOk; }
  };
})(window);
