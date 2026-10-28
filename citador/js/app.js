/*
 * Citador — panel lateral.
 */
(function () {
  "use strict";

  var E = window.CitadorEngine, I = window.CitadorImport, S = window.CitadorStore,
      ST = window.CitadorStyles, W = window.CitadorWord, B = window.CitadorBib;

  var DEFAULT_CONFIG = {
    styleId: "vancouver",
    styleDef: null,
    intext: E.normalizeIntext({ mode: "number", enclose: "brackets", sup: false, compress: true, dash: "-", numSep: "," }),
    bib: { includeDOI: true, includePMID: false, includeURL: false },
    heading: "Referencias"
  };

  var SAMPLE = {
    s1: { id: "s1", type: "article-journal", title: "Low-dose quadruple combination for hypertension", author: [{ family: "Ruiz", given: "M." }, { family: "Ortega", given: "L." }], "container-title": "Revista Española de Cardiología", "container-title-short": "Rev Esp Cardiol", issued: { "date-parts": [[2021]] }, volume: "74", issue: "5", page: "400-410", DOI: "10.1016/j.rec.2021.01.001" },
    s2: { id: "s2", type: "article-journal", title: "Adherence to single-pill combinations in primary care", author: [{ family: "Chen", given: "Y." }, { family: "Patel", given: "S." }, { family: "Moreau", given: "A." }, { family: "Ito", given: "K." }, { family: "Novak", given: "P." }, { family: "Silva", given: "R." }, { family: "Okafor", given: "C." }], "container-title": "Hypertension", "container-title-short": "Hypertension", issued: { "date-parts": [[2019]] }, volume: "73", issue: "2", page: "321-329" },
    s3: { id: "s3", type: "article-journal", title: "Blood pressure targets revisited", author: [{ family: "Müller", given: "T." }], "container-title": "The Lancet", "container-title-short": "Lancet", issued: { "date-parts": [[2020]] }, volume: "395", page: "1501-1503" }
  };
  var SAMPLE_CITES = [{ cid: "x1", ids: ["s1"] }, { cid: "x2", ids: ["s2", "s3", "s1"] }];

  var adapter = null;
  var doc = { items: {}, cites: {}, config: null, library: null };
  var state = {
    view: "cite", q: "", sort: "recent", selected: [], currentCite: null,
    numbers: {}, inDoc: {}, citeScope: null, libScope: "doc", libQ: "", pubmed: null
  };

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function cfg() { return doc.config; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  var statusTimer;
  function status(msg, kind, sticky) {
    var el = $("status");
    el.textContent = msg || "";
    el.className = "status" + (msg ? " is-on" : "") + (kind ? " " + kind : "");
    clearTimeout(statusTimer);
    if (msg && !sticky) statusTimer = setTimeout(function () { el.className = "status"; }, kind === "error" ? 7000 : 3200);
  }

  function errMsg(e) {
    if (!e) return "Error desconocido.";
    if (e.status === 404) return "No encontrado.";
    if (/Failed to fetch|NetworkError|Load failed|TypeError/.test(String(e.message || e))) return "Sin conexión con el servidor. Comprueba Internet.";
    return e.message || String(e);
  }

  function cleanItem(it) {
    var c = {};
    Object.keys(it).forEach(function (k) { if (k.charAt(0) !== "_") c[k] = it[k]; });
    return c;
  }

  /** Todas las referencias conocidas (biblioteca personal + documento). */
  function allItems() {
    var lib = S.allItems(), out = {};
    Object.keys(doc.items).forEach(function (k) { out[k] = doc.items[k]; });
    Object.keys(lib).forEach(function (k) { out[k] = lib[k]; });
    return out;
  }
  function itemFor(key) { return S.getItem(key) || doc.items[key] || null; }

  function saveDoc() { S.writeDoc(doc); }

  /** Añade referencias a la biblioteca del documento. */
  function addToDoc(keys) {
    var n = 0;
    keys.forEach(function (k) {
      if (doc.items[k]) return;
      var it = itemFor(k);
      if (it) { doc.items[k] = cleanItem(it); doc.items[k].id = k; n++; }
    });
    if (n) saveDoc();
    return n;
  }

  function scopeItems(scope) {
    var all = allItems();
    if (scope === "doc") return doc.items;
    if (scope === "all") return all;
    if (scope && scope.indexOf("col:") === 0) {
      var col = S.collections().filter(function (c) { return "col:" + c.id === scope; })[0];
      var out = {};
      if (col) col.keys.forEach(function (k) { if (all[k]) out[k] = all[k]; });
      return out;
    }
    return all;
  }

  function scopeName(scope) {
    if (scope === "doc") return "este documento";
    if (scope === "all") return "toda mi biblioteca";
    var col = S.collections().filter(function (c) { return "col:" + c.id === scope; })[0];
    return col ? col.name : "";
  }

  function scopeOptions(withCounts) {
    var all = allItems();
    var html = "<option value='doc'>Este documento" + (withCounts ? " (" + Object.keys(doc.items).length + ")" : "") + "</option>" +
      "<option value='all'>Toda mi biblioteca" + (withCounts ? " (" + Object.keys(all).length + ")" : "") + "</option>";
    var cols = S.collections();
    if (cols.length) {
      html += "<optgroup label='Mis bibliotecas'>" + cols.map(function (c) {
        return "<option value='col:" + esc(c.id) + "'>" + esc(c.name) + (withCounts ? " (" + c.keys.length + ")" : "") + "</option>";
      }).join("") + "</optgroup>";
    }
    return html;
  }

  // presentación de una referencia en las listas
  function authorsShort(it) {
    var n = it.author || it.editor || [];
    if (!n.length) return "Sin autor";
    var names = n.slice(0, 3).map(function (a) { return a.literal || a.family || a.given || ""; });
    return names.join(", ") + (n.length > 3 ? " et al." : "");
  }
  function sourceLine(it) {
    var parts = [];
    var c = it["container-title-short"] || it["container-title"] || it.publisher || "";
    if (c) parts.push(c);
    var y = E.yearOf(it, "");
    if (y) parts.push(y);
    var vol = it.volume ? it.volume + (it.issue ? "(" + it.issue + ")" : "") : "";
    if (vol) parts.push(vol);
    return parts.join(". ");
  }
  function idLine(it) {
    if (it.PMID) return "PMID " + it.PMID;
    if (it.DOI) return "doi " + it.DOI;
    return "";
  }

  // ---------------------------------------------------------------------------
  // Estilo actual
  // ---------------------------------------------------------------------------
  function currentStyle() {
    var c = cfg();
    if (c.styleDef) return B.completeStyle(c.styleDef);
    return ST.find(c.styleId) || ST.find("vancouver");
  }

  /** Ajusta el estilo a las citas del texto (autor-año: lista alfabética sin números). */
  function effectiveStyle() {
    var s = currentStyle();
    var c = cfg().intext;
    if (c.mode === "author-year") {
      s.options.order = "alphabetical";
      s.options.label = "";
      s.options.hanging = true;
    }
    return s;
  }

  function buildBibliography(items, ids) {
    var c = cfg();
    var style = effectiveStyle();
    var bib = B.makeBibliography(style, items, ids, {
      yearSuffix: c.intext.mode === "author-year",
      includeDOI: c.bib.includeDOI !== false, includePMID: !!c.bib.includePMID, includeURL: !!c.bib.includeURL
    });
    var textNumeric = c.intext.mode !== "author-year";
    var layout = E.bibliographyParagraphs(bib, textNumeric && !style.options.label);
    return { bib: bib, layout: layout, style: style };
  }

  // ---------------------------------------------------------------------------
  // Documento: actualizar citas y bibliografía
  // ---------------------------------------------------------------------------
  var refreshing = null, again = false;

  function refresh() {
    if (!adapter) return Promise.resolve();
    if (refreshing) { again = true; return refreshing; }
    refreshing = Promise.resolve().then(doRefresh).catch(function (e) {
      console.error(e);
      status("No se pudo actualizar el documento: " + errMsg(e), "error");
    }).then(function () {
      refreshing = null;
      if (again) { again = false; return refresh(); }
    });
    return refreshing;
  }

  function doRefresh() {
    return adapter.refresh(compute).then(function (res) {
      saveDoc();
      renderDocStat(res);
      renderCiteList();
      renderLibList();
      renderEditPanel();
      renderBibPreview();
    });
  }

  function compute(docCites) {
    var c = cfg();
    var cites = docCites.map(function (d) {
      var data = doc.cites[d.cid];
      if (!data && d.tagIds && d.tagIds.length) data = doc.cites[d.cid] = { ids: d.tagIds.slice() };
      if (!data) data = { ids: [] };
      return { cid: d.cid, ids: data.ids || [], loc: data.loc || {}, narrative: !!data.narrative, text: d.text };
    });

    var items = {};
    cites.forEach(function (ct) {
      ct.ids.forEach(function (id) {
        var it = S.getItem(id) || doc.items[id];
        if (it) { items[id] = cleanItem(it); items[id].id = id; doc.items[id] = items[id]; }
      });
    });

    var order = E.firstAppearanceOrder(cites, items);
    var built;
    try { built = buildBibliography(items, order); }
    catch (e) {
      console.error(e);
      status("El estilo de bibliografía dio un error: " + errMsg(e), "error");
      built = { bib: { order: order, entries: [], params: {}, suffix: {} }, layout: { layout: "plain", paragraphs: [], labelWidth: 0 } };
    }
    var noDate = (built.style && built.style.options.noDate) || "s.f.";
    var comp = E.computeCitations(cites, items, c.intext, built.bib.order, built.bib.suffix, noDate);
    state.numbers = comp.numbers;
    state.inDoc = {};
    order.forEach(function (id) { state.inDoc[id] = true; });
    var ooxml = E.wrapOoxml(E.bibliographyBodyXml(built.layout));

    var out = comp.citations.map(function (r, i) {
      var sig = JSON.stringify(r.runs);
      var data = doc.cites[r.cid];
      var force = !data || data.sig !== sig;
      if (data) data.sig = sig;
      return { cid: r.cid, ids: cites[i].ids, runs: r.runs, text: r.text, force: force };
    });
    return {
      citations: out, bibOoxml: ooxml, bibLayout: built.layout,
      duplicate: function (cid) {
        var nc = S.newKey(5);
        doc.cites[nc] = JSON.parse(JSON.stringify(doc.cites[cid] || { ids: [] }));
        return nc;
      }
    };
  }

  function renderDocStat(res) {
    var nCites = res ? res.citations : 0;
    var nRefs = Object.keys(state.inDoc).length;
    $("docstat").textContent = nCites ? plural(nCites, "cita", "citas") + ", " + plural(nRefs, "referencia", "referencias") : "Sin citas";
  }

  // ---------------------------------------------------------------------------
  // Insertar citas
  // ---------------------------------------------------------------------------
  function insertSelected(keys) {
    keys = (keys || state.selected).slice();
    if (!keys.length) return;
    addToDoc(keys);
    if (state.currentCite && doc.cites[state.currentCite]) { addToCite(state.currentCite, keys); return; }
    var cid = S.newKey(5);
    $("btnInsert").disabled = true;
    adapter.insertCitation(cid, keys, placeholderFor()).then(function (res) {
      if (res && res.mergeInto) { addToCite(res.mergeInto, keys); return; }
      doc.cites[cid] = { ids: keys };
      state.selected = [];
      saveDoc();
      return refresh().then(function () { status(keys.length > 1 ? "Cita con " + keys.length + " referencias insertada" : "Cita insertada", "ok"); });
    }).catch(function (e) { status(errMsg(e), "error"); }).then(updateActionBar);
  }

  function placeholderFor() {
    var c = cfg().intext;
    if (c.mode === "author-year") return "(…)";
    return c.enclose === "brackets" ? "[…]" : c.enclose === "parens" ? "(…)" : "…";
  }

  function addToCite(cid, keys) {
    var data = doc.cites[cid] || (doc.cites[cid] = { ids: [] });
    var added = 0;
    keys.forEach(function (k) { if (data.ids.indexOf(k) < 0) { data.ids.push(k); added++; } });
    state.selected = [];
    saveDoc();
    refresh().then(function () {
      status(added ? "Añadida a la cita seleccionada" : "Esa referencia ya estaba en la cita", added ? "ok" : "");
      updateActionBar();
    });
  }

  // ---------------------------------------------------------------------------
  // Lista de referencias (pestaña Citar)
  // ---------------------------------------------------------------------------
  function matches(it, q) {
    if (!q) return true;
    var hay = norm([authorsShort(it), (it.author || []).map(function (a) { return a.family || a.literal; }).join(" "),
      it.title, it["container-title"], it["container-title-short"], E.yearOf(it, ""), it.PMID, it.DOI].join(" "));
    return norm(q).split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function sortedKeys(items, sort) {
    var keys = Object.keys(items);
    var by = {
      recent: function (a, b) { return (items[b]._added || 0) - (items[a]._added || 0); },
      author: function (a, b) { return norm(authorsShort(items[a])) < norm(authorsShort(items[b])) ? -1 : 1; },
      year: function (a, b) { return (E.yearOf(items[b], "0") + "").localeCompare(E.yearOf(items[a], "0") + ""); },
      doc: function (a, b) {
        var na = state.numbers[a] || 1e9, nb = state.numbers[b] || 1e9;
        return na !== nb ? na - nb : (items[b]._added || 0) - (items[a]._added || 0);
      }
    };
    return keys.sort(by[sort] || by.recent);
  }

  function refRow(key, it, opts) {
    var selIdx = state.selected.indexOf(key);
    var n = state.inDoc[key] ? state.numbers[key] : null;
    var c = cfg().intext;
    var docTag = n ? "<span class='indoc' title='Citada en el documento'>" + (c.mode === "author-year" ? "citada" : "nº " + n) + "</span>" : "";
    var actions = "";
    if (opts && opts.manage) {
      var a = ["<button class='linkbtn' data-act='edit' data-key='" + key + "'>Editar</button>"];
      if (state.libScope !== "doc" && !doc.items[key]) a.push("<button class='linkbtn' data-act='todoc' data-key='" + key + "'>Añadir al documento</button>");
      if (state.libScope === "doc") a.push(state.inDoc[key] ? "<span class='muted small'>citada</span>" : "<button class='linkbtn danger' data-act='undoc' data-key='" + key + "'>Quitar del documento</button>");
      else if (state.libScope.indexOf("col:") === 0) a.push("<button class='linkbtn danger' data-act='uncol' data-key='" + key + "'>Quitar de esta biblioteca</button>");
      else a.push("<button class='linkbtn danger' data-act='del' data-key='" + key + "'>Eliminar</button>");
      actions = "<div class='rowactions'>" + a.join("") + "</div>";
    }
    return "<li class='ref" + (selIdx >= 0 ? " is-sel" : "") + "' data-key='" + key + "' tabindex='0'>" +
      (opts && opts.manage ? "" : "<span class='pick' aria-hidden='true'>" + (selIdx >= 0 ? selIdx + 1 : "") + "</span>") +
      "<div class='refbody'>" +
      "<div class='ref-auth'>" + esc(authorsShort(it)) + docTag + "</div>" +
      "<div class='ref-title'>" + esc(it.title || "(sin título)") + "</div>" +
      "<div class='ref-src'>" + esc(sourceLine(it)) + (idLine(it) ? " <span class='muted'>" + esc(idLine(it)) + "</span>" : "") + "</div>" +
      actions + "</div></li>";
  }

  var MAX_ROWS = 150;

  function renderCiteScope() {
    var sel = $("citeScope");
    var v = state.citeScope;
    sel.innerHTML = scopeOptions(true);
    sel.value = v;
    if (sel.value !== v) { state.citeScope = "all"; sel.value = "all"; }
  }

  function renderCiteList() {
    renderCiteScope();
    var items = scopeItems(state.citeScope);
    var q = state.q;
    var idsMode = q && I.looksLikeIdentifiers(q);
    var keys = sortedKeys(items, state.sort).filter(function (k) { return idsMode ? false : matches(items[k], q); });
    var total = Object.keys(items).length;
    var html = keys.slice(0, MAX_ROWS).map(function (k) { return refRow(k, items[k]); }).join("");
    if (!total) {
      html = state.citeScope === "doc"
        ? "<li class='empty'><strong>Este documento aún no tiene referencias.</strong><br>Pega arriba un PMID o un DOI y pulsa Intro, o elige «Toda mi biblioteca» para citar algo que ya tengas.</li>"
        : "<li class='empty'><strong>No hay referencias aquí.</strong><br>Pega arriba un PMID o un DOI y pulsa Intro, o importa un archivo desde la pestaña Biblioteca.</li>";
    } else if (!keys.length && !idsMode) {
      html = "<li class='empty'>Nada en " + esc(scopeName(state.citeScope)) + " coincide con «" + esc(q) + "».</li>";
    }
    $("citeList").innerHTML = html;
    $("listCount").textContent = idsMode ? "" : (keys.length > MAX_ROWS ? "Mostrando " + MAX_ROWS + " de " + keys.length : plural(keys.length, "referencia", "referencias"));
    renderQuick(idsMode);
    updateActionBar();
  }

  function renderQuick(idsMode) {
    var q = state.q.trim();
    var el = $("quick");
    if (!q) { el.innerHTML = ""; return; }
    if (idsMode) {
      var ids = I.parseIdentifiers(q);
      var n = ids.pmids.length + ids.dois.length;
      el.innerHTML = "<button class='quickbtn primary-soft' id='qImportCite'>Importar y citar " + (n === 1 ? "esta referencia" : "estas " + n + " referencias") + "</button>" +
        "<button class='linkbtn' id='qImport'>Solo añadir</button>";
      $("qImportCite").onclick = function () { importIds(q, true); };
      $("qImport").onclick = function () { importIds(q, false); };
    } else {
      el.innerHTML = "<button class='linkbtn' id='qPubmed'>Buscar «" + esc(q.length > 40 ? q.slice(0, 40) + "…" : q) + "» en PubMed</button>";
      $("qPubmed").onclick = function () { pubmedSearch(q); };
    }
  }

  function updateActionBar() {
    var n = state.selected.length;
    var btn = $("btnInsert");
    var inCite = state.currentCite && doc.cites[state.currentCite];
    btn.disabled = n === 0;
    btn.textContent = inCite ? "Añadir a la cita" : (n > 1 ? "Insertar cita (" + n + ")" : "Insertar cita");
    if (n) $("selInfo").innerHTML = (n === 1 ? "1 seleccionada" : n + " seleccionadas") + " <button class='linkbtn' id='clearSel'>Quitar</button>";
    else $("selInfo").textContent = "Elige una o varias referencias";
    var cs = $("clearSel");
    if (cs) cs.onclick = function () { state.selected = []; markSelection(); };
  }

  function toggleSelect(key) {
    var i = state.selected.indexOf(key);
    if (i >= 0) state.selected.splice(i, 1); else state.selected.push(key);
    markSelection();
  }

  function markSelection() {
    Array.prototype.forEach.call($("citeList").querySelectorAll("li.ref"), function (li) {
      var idx = state.selected.indexOf(li.getAttribute("data-key"));
      li.classList.toggle("is-sel", idx >= 0);
      var pk = li.querySelector(".pick");
      if (pk) pk.textContent = idx >= 0 ? idx + 1 : "";
    });
    updateActionBar();
  }

  // ---------------------------------------------------------------------------
  // Importación
  // ---------------------------------------------------------------------------
  /** Tras importar: al documento (si procede) y a la biblioteca con nombre activa. */
  function placeImported(keys, scope) {
    if ($("impToDoc").checked || scope === "doc") addToDoc(keys);
    if (scope && scope.indexOf("col:") === 0) S.addToCollection(scope.slice(4), keys);
  }

  function importIds(text, thenCite) {
    var ids = I.parseIdentifiers(text);
    var n = ids.pmids.length + ids.dois.length;
    if (!n) { status("No he encontrado ningún PMID ni DOI en el texto.", "error"); return Promise.resolve(); }
    status(n === 1 ? "Buscando la referencia…" : "Buscando " + n + " referencias…", "", true);
    var scope = state.view === "library" ? state.libScope : state.citeScope;
    return I.fetchIdentifiers(text).then(function (r) {
      var res = S.addItems(r.items, doc.items);
      placeImported(res.keys, scope);
      var msg = [];
      if (res.added) msg.push(plural(res.added, "referencia añadida", "referencias añadidas"));
      if (res.existing) msg.push(res.existing === 1 ? "1 ya estaba en tu biblioteca" : res.existing + " ya estaban en tu biblioteca");
      if (r.missing.length) msg.push("no encontrado: " + r.missing.join(", "));
      status(msg.join("; ") || "Sin resultados", r.missing.length ? "error" : "ok");
      if (thenCite && res.keys.length) {
        state.q = ""; $("q").value = "";
        state.selected = res.keys;
        renderCiteList();
        insertSelected(res.keys);
      } else if (res.keys.length) {
        state.selected = state.selected.concat(res.keys.filter(function (k) { return state.selected.indexOf(k) < 0; }));
        if (state.view === "cite") { state.q = ""; $("q").value = ""; }
        $("idsBox").value = "";
      }
      renderCiteList(); renderLibList();
    }).catch(function (e) { status("No se pudo importar: " + errMsg(e), "error"); });
  }

  function pubmedSearch(term) {
    var box = $("pubmed");
    box.hidden = false;
    box.innerHTML = "<div class='pm-head'><span>PubMed</span><button class='linkbtn' id='pmClose'>Cerrar</button></div><p class='muted pad'>Buscando…</p>";
    $("pmClose").onclick = closePubmed;
    I.searchPubmed(term, 20).then(function (r) {
      state.pubmed = r.items;
      var html = "<div class='pm-head'><span>PubMed: " + r.count.toLocaleString("es-ES") + " resultados" + (r.count > 20 ? " (los 20 más relevantes)" : "") + "</span><button class='linkbtn' id='pmClose'>Cerrar</button></div>";
      html += "<ul class='reflist pm'>" + r.items.map(function (it, i) {
        return "<li class='ref'><div class='refbody'><div class='ref-auth'>" + esc(authorsShort(it)) + "</div><div class='ref-title'>" + esc(it.title) +
          "</div><div class='ref-src'>" + esc(sourceLine(it)) + " <span class='muted'>PMID " + esc(it.PMID) + "</span></div>" +
          "<div class='rowactions'><button class='linkbtn strong' data-pm='" + i + "' data-act='cite'>Citar</button><button class='linkbtn' data-pm='" + i + "' data-act='add'>Añadir</button></div></div></li>";
      }).join("") + "</ul>";
      if (!r.items.length) html += "<p class='muted pad'>Sin resultados. Prueba con otras palabras.</p>";
      box.innerHTML = html;
      $("pmClose").onclick = closePubmed;
    }).catch(function (e) {
      box.innerHTML = "<div class='pm-head'><span>PubMed</span><button class='linkbtn' id='pmClose'>Cerrar</button></div><p class='pad error'>" + esc(errMsg(e)) + "</p>";
      $("pmClose").onclick = closePubmed;
    });
  }

  function closePubmed() { $("pubmed").hidden = true; $("pubmed").innerHTML = ""; state.pubmed = null; }

  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsText(file);
    });
  }

  /** Archivo .citador: biblioteca con nombre compartida por otro usuario. */
  function parseCitadorLibrary(text) {
    try {
      var j = JSON.parse(text);
      if (j && j.format === "citador-library" && Array.isArray(j.items)) return j;
    } catch (e) { /* no es JSON */ }
    return null;
  }

  function importFiles(files) {
    var total = { added: 0, existing: 0 }, errors = [], named = [];
    var scope = state.libScope;
    status("Leyendo archivos…", "", true);
    return Array.prototype.reduce.call(files, function (p, f) {
      return p.then(function () {
        return readFile(f).then(function (text) {
          var lib = parseCitadorLibrary(text);
          if (lib) {
            var r0 = S.addItems(lib.items, doc.items);
            var col = S.createCollection(lib.name || f.name.replace(/\.[^.]+$/, ""), r0.keys);
            named.push(col.name);
            total.added += r0.added; total.existing += r0.existing;
            placeImported(r0.keys, scope);
            return null;
          }
          var parsed = I.parseFile(text, f.name);
          if (parsed.format === "ids") return I.fetchIdentifiers(text).then(function (r) { return r.items; });
          return parsed.items;
        }).then(function (items) {
          if (!items) return;
          var r = S.addItems(items, doc.items);
          total.added += r.added; total.existing += r.existing;
          placeImported(r.keys, scope);
        }).catch(function (e) { errors.push(f.name + ": " + errMsg(e)); });
      });
    }, Promise.resolve()).then(function () {
      var msg = plural(total.added, "referencia importada", "referencias importadas");
      if (total.existing) msg += " (" + total.existing + " ya estaban)";
      if (named.length) msg += ". Biblioteca creada: " + named.join(", ");
      if (errors.length) msg += ". " + errors.join(" ");
      status(msg, errors.length ? "error" : "ok");
      renderLibScope(); renderCiteList(); renderLibList();
    });
  }

  // ---------------------------------------------------------------------------
  // Biblioteca
  // ---------------------------------------------------------------------------
  function renderLibScope() {
    var sel = $("libScope");
    var v = state.libScope;
    sel.innerHTML = scopeOptions(true);
    sel.value = v;
    if (sel.value !== v) { state.libScope = "doc"; sel.value = "doc"; }
    var isCol = state.libScope.indexOf("col:") === 0;
    var acts = [];
    if (state.libScope === "doc") acts.push("<button class='linkbtn' id='laSaveCol'>Guardar como biblioteca con nombre…</button>");
    if (state.libScope === "all") acts.push("<button class='linkbtn' id='laNewCol'>Nueva biblioteca con nombre…</button>");
    if (isCol) {
      acts.push("<button class='linkbtn' id='laColToDoc'>Añadir todas al documento</button>");
      acts.push("<button class='linkbtn' id='laRename'>Cambiar nombre</button>");
      acts.push("<button class='linkbtn danger' id='laDelCol'>Borrar esta biblioteca</button>");
    }
    $("libActions").innerHTML = acts.join("");
    if ($("laSaveCol")) $("laSaveCol").onclick = function () {
      askText("Guardar como biblioteca con nombre", "Nombre", "").then(function (name) {
        if (!name) return;
        var c = S.createCollection(name, Object.keys(doc.items));
        S.addItems(Object.keys(doc.items).map(function (k) { return doc.items[k]; }), doc.items);
        state.libScope = "col:" + c.id;
        renderLibScope(); renderLibList(); renderCiteScope();
        status("Biblioteca «" + name + "» guardada", "ok");
      });
    };
    if ($("laNewCol")) $("laNewCol").onclick = function () {
      askText("Nueva biblioteca con nombre", "Nombre", "").then(function (name) {
        if (!name) return;
        var c = S.createCollection(name, []);
        state.libScope = "col:" + c.id;
        renderLibScope(); renderLibList(); renderCiteScope();
      });
    };
    if ($("laColToDoc")) $("laColToDoc").onclick = function () {
      var n = addToDoc(Object.keys(scopeItems(state.libScope)));
      status(n ? plural(n, "referencia añadida", "referencias añadidas") + " al documento" : "Ya estaban todas en el documento", "ok");
      renderLibScope(); renderCiteList();
    };
    if ($("laRename")) $("laRename").onclick = function () {
      var id = state.libScope.slice(4);
      askText("Cambiar nombre", "Nombre", scopeName(state.libScope)).then(function (name) {
        if (!name) return;
        S.renameCollection(id, name); renderLibScope(); renderCiteScope();
      });
    };
    if ($("laDelCol")) $("laDelCol").onclick = function () {
      var id = state.libScope.slice(4);
      confirmDlg("Borrar biblioteca", "<p>Se borra la biblioteca «" + esc(scopeName(state.libScope)) + "». Las referencias siguen en tu biblioteca general.</p>", "Borrar", true).then(function (ok) {
        if (!ok) return;
        S.deleteCollection(id); state.libScope = "all"; renderLibScope(); renderLibList(); renderCiteScope();
      });
    };
  }

  function renderLibList() {
    renderLibScope();
    var items = scopeItems(state.libScope);
    var keys = sortedKeys(items, "recent").filter(function (k) { return matches(items[k], state.libQ); });
    if (state.libScope === "doc") keys.sort(function (a, b) { return (state.numbers[a] || 1e9) - (state.numbers[b] || 1e9); });
    var html = keys.slice(0, MAX_ROWS).map(function (k) { return refRow(k, items[k], { manage: true }); }).join("");
    if (!keys.length) html = "<li class='empty'>" + (state.libScope === "doc" ? "Este documento aún no tiene referencias. Lo que importes aquí quedará guardado dentro del documento." : "No hay referencias que mostrar.") + "</li>";
    if (keys.length > MAX_ROWS) html += "<li class='empty'>Y " + (keys.length - MAX_ROWS) + " más. Usa el filtro para encontrarlas.</li>";
    $("libList").innerHTML = html;
  }

  function deleteItem(key) {
    var it = itemFor(key);
    var cited = !!state.inDoc[key];
    confirmDlg("Eliminar referencia",
      "<p>" + esc(authorsShort(it)) + ". <em>" + esc(it.title) + "</em></p>" +
      (cited ? "<p class='warn'>Está citada en este documento: se quita de tu biblioteca, pero el documento conserva sus datos.</p>" : ""),
      "Eliminar", true).then(function (ok) {
        if (!ok) return;
        S.deleteItem(key);
        state.selected = state.selected.filter(function (k) { return k !== key; });
        renderLibList(); renderCiteList();
        status("Referencia eliminada", "ok");
      });
  }

  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    return url;
  }

  function exportScope() {
    var items = scopeItems(state.libScope);
    var list = Object.keys(items).map(function (k) { var c = cleanItem(items[k]); c.id = k; return c; });
    if (!list.length) { status("No hay referencias para exportar.", "error"); return; }
    var name = state.libScope === "doc" ? (cfg().libName || "Referencias del documento") : (state.libScope === "all" ? "Mi biblioteca" : scopeName(state.libScope));
    var fileBase = norm(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "biblioteca";
    showDlg("Exportar " + plural(list.length, "referencia", "referencias"),
      "<p class='hint'>El archivo <strong>.citador</strong> conserva el nombre y lo abre cualquier usuario de Citador desde <em>Biblioteca → Desde archivo</em>. RIS sirve para EndNote, Zotero o Mendeley.</p>" +
      "<div class='exportfmt'><label class='check'><input type='radio' name='xf' value='citador' checked> Biblioteca de Citador (.citador)</label>" +
      "<label class='check'><input type='radio' name='xf' value='ris'> RIS</label><label class='check'><input type='radio' name='xf' value='json'> CSL-JSON</label></div>",
      [{ label: "Descargar", cls: "primary", fn: function () {
        var f = document.querySelector("input[name=xf]:checked").value;
        var text, fname, type;
        if (f === "citador") { text = JSON.stringify({ format: "citador-library", version: 1, name: name, exported: new Date().toISOString(), items: list }, null, 1); fname = fileBase + ".citador"; type = "application/json"; }
        else if (f === "ris") { text = I.toRIS(list); fname = fileBase + ".ris"; type = "application/x-research-info-systems"; }
        else { text = I.toCSLJSON(list); fname = fileBase + ".json"; type = "application/json"; }
        var a = document.createElement("a");
        a.href = download(fname, text, type); a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        status("Archivo preparado: " + fname, "ok");
      } }]);
  }

  // ---------------------------------------------------------------------------
  // Formulario de referencia
  // ---------------------------------------------------------------------------
  var editingKey = null;

  function namesToText(list) {
    return (list || []).map(function (n) { return n.literal ? n.literal : (n.family || "") + (n.given ? ", " + n.given : ""); }).join("\n");
  }
  function textToNames(t) {
    return String(t || "").split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      if (l.indexOf(",") < 0 && /\s(of|for|and|de|del|y)\s|group|society|organi|committee|grupo|sociedad|ministerio/i.test(l)) return { literal: l };
      return I.parseName(l);
    }).filter(Boolean);
  }

  function openItemForm(key) {
    editingKey = key || null;
    var it = key ? itemFor(key) : { type: "article-journal" };
    var f = $("itemForm");
    $("itemTitle").textContent = key ? "Editar referencia" : "Nueva referencia";
    f.type.value = it.type || "article-journal";
    if (!f.type.value) f.type.value = "article-journal";
    f.authors.value = namesToText(it.author);
    f.editors.value = namesToText(it.editor);
    f.title.value = it.title || "";
    f.container.value = it["container-title"] || "";
    f.containerShort.value = it["container-title-short"] || "";
    f.year.value = E.yearOf(it, "");
    f.volume.value = it.volume || ""; f.issue.value = it.issue || ""; f.page.value = it.page || "";
    f.edition.value = it.edition || ""; f.publisher.value = it.publisher || ""; f.place.value = it["publisher-place"] || "";
    f.DOI.value = it.DOI || ""; f.PMID.value = it.PMID || ""; f.URL.value = it.URL || "";
    var acc = it.accessed && it.accessed["date-parts"] && it.accessed["date-parts"][0];
    f.accessed.value = acc && acc.length === 3 ? acc[0] + "-" + ("0" + acc[1]).slice(-2) + "-" + ("0" + acc[2]).slice(-2) : "";
    syncFormType();
    $("itemModal").hidden = false;
    setTimeout(function () { f.title.focus(); }, 30);
  }

  function syncFormType() {
    var f = $("itemForm"), t = f.type.value;
    Array.prototype.forEach.call(f.querySelectorAll("[data-for]"), function (el) {
      el.hidden = el.getAttribute("data-for").split(" ").indexOf(t) < 0;
    });
    var lbl = { "article-journal": "Revista", chapter: "Título del libro", webpage: "Nombre del sitio web", "paper-conference": "Congreso / actas", article: "Repositorio (p. ej. medRxiv)" };
    f.querySelector(".lbl-cont").textContent = lbl[t] || "Revista";
  }

  function submitItemForm(ev) {
    ev.preventDefault();
    var f = $("itemForm");
    var base = editingKey ? JSON.parse(JSON.stringify(itemFor(editingKey))) : {};
    var it = { type: f.type.value };
    if (base._added) it._added = base._added;
    var au = textToNames(f.authors.value); if (au.length) it.author = au;
    var ed = textToNames(f.editors.value); if (ed.length && it.type === "chapter") it.editor = ed;
    it.title = f.title.value.trim();
    function set(k, v) { v = String(v || "").trim(); if (v) it[k] = v; }
    set("container-title", f.container.value);
    if (it.type === "article-journal") set("container-title-short", f.containerShort.value);
    var y = f.year.value.trim();
    if (y) it.issued = /^\d{4}$/.test(y) ? { "date-parts": [[parseInt(y, 10)]] } : (I.parseDate(y) || { literal: y });
    if (base.issued && base.issued["date-parts"] && String(base.issued["date-parts"][0][0]) === y) it.issued = base.issued;
    set("volume", f.volume.value); set("issue", f.issue.value); set("page", f.page.value);
    set("edition", f.edition.value); set("publisher", f.publisher.value); set("publisher-place", f.place.value);
    set("DOI", I.normalizeDOI(f.DOI.value) || f.DOI.value); set("PMID", f.PMID.value); set("URL", f.URL.value);
    if (f.accessed.value) it.accessed = I.parseDate(f.accessed.value);
    ["abstract", "ISSN", "ISBN", "PMCID", "language", "genre"].forEach(function (k) { if (base[k]) it[k] = base[k]; });
    if (!it.title) { f.title.focus(); return; }
    if (editingKey) {
      S.putItem(editingKey, it);
      if (doc.items[editingKey]) { doc.items[editingKey] = cleanItem(S.getItem(editingKey)); saveDoc(); }
      status("Referencia guardada", "ok");
      if (state.inDoc[editingKey]) refresh();
    } else {
      var r = S.addItems([it], doc.items);
      placeImported(r.keys, state.view === "library" ? state.libScope : state.citeScope);
      status(r.added ? "Referencia añadida" : "Ya existía una referencia igual en tu biblioteca", r.added ? "ok" : "");
      if (r.keys[0] && state.selected.indexOf(r.keys[0]) < 0) state.selected.push(r.keys[0]);
    }
    $("itemModal").hidden = true;
    renderLibList(); renderCiteList();
  }

  // ---------------------------------------------------------------------------
  // Cita seleccionada en el documento
  // ---------------------------------------------------------------------------
  var checkSelection = debounce(function () {
    if (!adapter) return;
    adapter.getSelectedCitation().then(function (cid) {
      if (cid !== state.currentCite) {
        state.currentCite = cid;
        renderEditPanel();
        updateActionBar();
      }
    }).catch(function () { /* nada */ });
  }, 200);

  function renderEditPanel() {
    var cid = state.currentCite;
    var data = cid && doc.cites[cid];
    var box = $("editCite");
    if (!data) { box.hidden = true; return; }
    box.hidden = false;
    var items = allItems();
    var preview = E.computeCitations([{ cid: cid, ids: data.ids, loc: data.loc, narrative: data.narrative }],
      buildItemsFor(data.ids), cfg().intext, orderFromNumbers(), {}, "s.f.").citations[0];
    $("editPreview").innerHTML = preview.runs.map(function (r) { return r.sup ? "<sup>" + esc(r.t) + "</sup>" : esc(r.t); }).join("");
    $("editList").innerHTML = data.ids.map(function (k) {
      var it = items[k];
      var lab = it ? esc(E.authorLabel(it, E.normalizeIntext(cfg().intext)) + ", " + E.yearOf(it, "s.f.")) : "<span class='error'>referencia desconocida</span>";
      var num = state.numbers[k] && cfg().intext.mode !== "author-year" ? "<span class='num'>" + state.numbers[k] + "</span>" : "";
      return "<li data-key='" + k + "'>" + num + "<span class='who' title='" + esc(it ? it.title : "") + "'>" + lab + "</span>" +
        "<input class='loc' data-key='" + k + "' placeholder='p. 12' value='" + esc((data.loc || {})[k] || "") + "' aria-label='Página o localizador'>" +
        "<button class='x' data-key='" + k + "' title='Quitar de la cita' aria-label='Quitar de la cita'>×</button></li>";
    }).join("");
    $("editNarrative").checked = !!data.narrative;
  }

  function buildItemsFor(ids) {
    var out = {};
    ids.forEach(function (k) { var it = itemFor(k); if (it) out[k] = it; });
    return out;
  }

  function orderFromNumbers() {
    return Object.keys(state.numbers).sort(function (a, b) { return state.numbers[a] - state.numbers[b]; });
  }

  // ---------------------------------------------------------------------------
  // Formato: citas en el texto
  // ---------------------------------------------------------------------------
  function runsHtml(runs) {
    return runs.map(function (x) {
      var t = esc(x.t);
      if (x.i) t = "<i>" + t + "</i>"; if (x.b) t = "<b>" + t + "</b>"; if (x.sup) t = "<sup>" + t + "</sup>";
      return t;
    }).join("");
  }

  function renderPresets() {
    var cur = E.normalizeIntext(cfg().intext);
    var current = E.matchPreset(cur);
    $("presets").innerHTML = E.PRESETS.map(function (p) {
      var c = E.normalizeIntext(Object.assign({}, cur, p.cfg));
      var r = E.computeCitations([{ cid: "p", ids: ["s3"] }], SAMPLE, c, ["s3"], {}).citations[0];
      return "<button class='preset" + (current === p.id ? " is-on" : "") + "' data-preset='" + p.id + "' aria-pressed='" + (current === p.id) + "'>" +
        "<span class='glyph'>" + runsHtml(r.runs) + "</span><span class='plabel'>" + esc(p.label) + "</span></button>";
    }).join("");
  }

  function renderSample() {
    var c = cfg().intext;
    var r = E.computeCitations(SAMPLE_CITES, SAMPLE, c, c.mode === "author-year" ? null : ["s1", "s2", "s3"], {}, "s.f.");
    function h(runs) { return "<mark>" + runsHtml(runs) + "</mark>"; }
    var sp = function (runs) { return (runs.length === 1 && runs[0].sup) ? "" : " "; };
    var a = r.citations[0].runs, b = r.citations[1].runs;
    $("sample").innerHTML = "La combinación cuádruple a dosis bajas redujo la presión arterial" + sp(a) + h(a) +
      " y mejoró la adherencia frente a la monoterapia" + sp(b) + h(b) + ".";
  }

  function renderFine() {
    var c = E.normalizeIntext(cfg().intext);
    $("fMode").value = c.mode; $("fEnclose").value = c.enclose; $("fNumSep").value = c.numSep; $("fDash").value = c.dash;
    $("fAyInner").value = c.ayInner; $("fMultiSep").value = c.multiSep; $("fEtAlMin").value = String(c.etAlMin);
    $("fEtAl").value = c.etAl; $("fAnd").value = c.and; $("fSup").checked = !!c.sup; $("fCompress").checked = !!c.compress;
    $("fAuto").checked = !!c.autoFromStyle;
    var isNum = c.mode !== "author-year";
    Array.prototype.forEach.call(document.querySelectorAll(".numopt"), function (el) { el.hidden = !isNum; });
    Array.prototype.forEach.call(document.querySelectorAll(".ayopt"), function (el) { el.hidden = isNum; });
  }

  function renderMixWarn() {
    var c = cfg().intext, s = currentStyle(), w = $("mixWarn");
    var msg = "";
    if (c.mode === "author-year" && s.options.order === "appearance") msg = "Con citas autor-año la bibliografía se ordena alfabéticamente y sin números.";
    else if (c.mode !== "author-year" && s.options.order === "alphabetical") msg = "Este estilo ordena la bibliografía alfabéticamente: Citador la numerará en ese orden para que coincida con tus citas.";
    w.hidden = !msg; w.textContent = msg;
  }

  function setIntext(patch) {
    cfg().intext = E.normalizeIntext(Object.assign({}, cfg().intext, patch));
    S.setPref("lastConfig", cfg());
    saveDoc();
    renderSample(); renderPresets(); renderFine(); renderMixWarn(); renderBibPreview();
    renderEditPanel();
    refreshSoon();
  }

  var refreshSoon = debounce(function () { refresh().then(function () { status("Documento actualizado", "ok"); }); }, 350);

  // ---------------------------------------------------------------------------
  // Formato: estilos de bibliografía
  // ---------------------------------------------------------------------------
  function styleSummary(s) {
    var o = s.options || {};
    var bits = [o.order === "alphabetical" ? "alfabético" : "numérico"];
    if (s.createdFrom === "examples") bits.push("creado con ejemplos");
    return bits.join(", ");
  }

  function renderStyles() {
    var cur = currentStyle();
    var c = cfg();
    function row(s, extra) {
      var on = c.styleId === s.id;
      return "<li><button class='stylerow" + (on ? " is-on" : "") + "' data-style='" + esc(s.id) + "' aria-pressed='" + on + "'>" +
        "<span class='sname'>" + esc(s.name) + "</span><span class='muted'>" + esc(extra || styleSummary(s)) + "</span></button></li>";
    }
    var mine = ST.userStyles();
    var html = "<li class='grouplbl'>Incluidos</li>" + ST.builtins().map(function (s) { return row(s); }).join("");
    html += "<li class='grouplbl'>Mis estilos</li>" + (mine.length ? mine.map(function (s) { return row(s); }).join("") : "<li class='muted small pad0'>Aún no has creado ninguno.</li>");
    if (c.styleDef && !ST.find(c.styleDef.id)) {
      html += "<li class='grouplbl'>De este documento</li>" + row(B.completeStyle(c.styleDef), "viene con el documento") +
        "<li><button class='linkbtn' id='saveDocStyle'>Guardar en mis estilos</button></li>";
    }
    $("styleList").innerHTML = html;
    if ($("saveDocStyle")) $("saveDocStyle").onclick = function () {
      var s = ST.save(Object.assign({}, c.styleDef, { id: c.styleDef.id }));
      applyStyle(s, true);
      status("Estilo guardado en tus estilos", "ok");
    };
    $("styleEdit").textContent = cur.builtin ? "Copiar y editar" : "Editar";
    $("styleDel").hidden = !ST.isMine(cur.id);
  }

  /** Aplica un estilo al documento; el estilo completo viaja dentro del documento. */
  function applyStyle(style, silent) {
    var c = cfg();
    c.styleId = style.id;
    c.styleDef = style.builtin ? null : B.clone(style);
    if (c.intext.autoFromStyle && style.citation && style.citation.mode) {
      c.intext = E.normalizeIntext(Object.assign({}, c.intext, style.citation));
    }
    S.setPref("lastConfig", c);
    saveDoc();
    renderFormat();
    return refresh().then(function () { if (!silent) status("Estilo aplicado: " + style.name, "ok"); });
  }

  function renderFormat() {
    renderSample(); renderPresets(); renderFine(); renderStyles(); renderMixWarn();
    $("bDOI").checked = cfg().bib.includeDOI !== false;
    $("bPMID").checked = !!cfg().bib.includePMID;
    $("bURL").checked = !!cfg().bib.includeURL;
    renderBibPreview();
  }

  function renderBibPreview() {
    if (state.view !== "format") return;
    var docIds = orderFromNumbers().slice(0, 3);
    var items = docIds.length ? buildItemsFor(docIds) : SAMPLE;
    var ids = docIds.length ? docIds : ["s1", "s2", "s3"];
    var el = $("bibPreview");
    try {
      var built = buildBibliography(items, ids);
      var lay = built.layout;
      el.innerHTML = "<div class='pv-label'>" + (docIds.length ? "Vista previa con tus referencias" : "Vista previa") + "</div>" +
        lay.paragraphs.map(function (p) {
          return "<p class='pv " + lay.layout + "'>" + (lay.layout === "label" ? "<span class='n'>" + esc(p.label) + "</span>" : "") +
            "<span>" + runsHtml(p.body) + "</span></p>";
        }).join("");
    } catch (e) {
      el.innerHTML = "<p class='error'>El estilo tiene un error: " + esc(errMsg(e)) + "</p>";
    }
  }

  function openStyleEditor(style, isNew) {
    window.CitadorStyleUI.openEditor(style, {
      onSave: function (s) {
        var saved = ST.save(s);
        applyStyle(saved);
      },
      sampleItems: sampleForEditor(),
      isNew: isNew
    });
  }

  function sampleForEditor() {
    var out = [];
    var docIds = orderFromNumbers().slice(0, 4);
    docIds.forEach(function (k) { var it = itemFor(k); if (it) out.push(it); });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Diálogos
  // ---------------------------------------------------------------------------
  function showDlg(title, bodyHtml, actions) {
    return new Promise(function (resolve) {
      $("dlgTitle").textContent = title;
      $("dlgBody").innerHTML = bodyHtml;
      var box = $("dlgActions");
      box.innerHTML = "";
      var hasCancel = actions.some(function (a) { return a.value === false; });
      if (!hasCancel) {
        var close = document.createElement("button");
        close.className = "secondary";
        close.textContent = "Cerrar";
        close.onclick = function () { $("dlg").hidden = true; resolve(null); };
        box.appendChild(close);
      }
      actions.forEach(function (a) {
        var b = document.createElement("button");
        b.className = a.cls || "secondary";
        b.textContent = a.label;
        b.onclick = function () {
          var r = a.fn ? a.fn() : a.value;
          if (r === false) return;
          $("dlg").hidden = true;
          resolve(a.value !== undefined ? a.value : r);
        };
        box.appendChild(b);
      });
      $("dlg").hidden = false;
    });
  }

  function confirmDlg(title, html, okLabel, danger) {
    return showDlg(title, html, [{ label: "Cancelar", cls: "secondary", value: false }, { label: okLabel, cls: danger ? "danger-btn" : "primary", value: true }]);
  }

  function askText(title, label, value) {
    return showDlg(title, "<label class='stack'>" + esc(label) + "<input id='askInput' class='field' value='" + esc(value || "") + "'></label>",
      [{ label: "Cancelar", cls: "secondary", value: false }, { label: "Guardar", cls: "primary", fn: function () { return $("askInput").value.trim() || false; } }])
      .then(function (v) { return typeof v === "string" ? v : null; });
  }

  window.CitadorDialogs = { show: showDlg, confirm: confirmDlg, ask: askText, status: status, errMsg: errMsg };

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------
  function setView(v) {
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      var on = t.getAttribute("data-view") === v;
      t.classList.toggle("is-on", on); t.setAttribute("aria-selected", on);
    });
    ["cite", "library", "format"].forEach(function (x) { $("view-" + x).hidden = x !== v; });
    if (v === "format") renderFormat();
    if (v === "library") renderLibList();
    if (v === "cite") renderCiteList();
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.onclick = function () { setView(t.getAttribute("data-view")); };
    });
    $("btnRefresh").onclick = function () { status("Actualizando…", "", true); refresh().then(function () { status("Documento actualizado", "ok"); }); };

    // Citar
    var q = $("q");
    q.addEventListener("input", debounce(function () { state.q = q.value; renderCiteList(); }, 120));
    q.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      state.q = q.value;
      if (I.looksLikeIdentifiers(q.value)) { importIds(q.value, !ev.shiftKey); return; }
      if (state.selected.length) { insertSelected(); return; }
      var first = $("citeList").querySelector("li.ref");
      if (first) toggleSelect(first.getAttribute("data-key"));
      else if (q.value.trim()) pubmedSearch(q.value.trim());
    });
    $("citeScope").onchange = function () { state.citeScope = this.value; renderCiteList(); };
    $("sortSel").onchange = function () { state.sort = this.value; renderCiteList(); };
    $("citeList").addEventListener("click", function (ev) {
      var li = ev.target.closest("li.ref"); if (!li) return;
      toggleSelect(li.getAttribute("data-key"));
    });
    $("citeList").addEventListener("dblclick", function (ev) {
      var li = ev.target.closest("li.ref"); if (!li) return;
      var k = li.getAttribute("data-key");
      if (state.selected.indexOf(k) < 0) state.selected.push(k);
      markSelection();
      insertSelected();
    });
    $("citeList").addEventListener("keydown", function (ev) {
      var li = ev.target.closest("li.ref"); if (!li) return;
      if (ev.key === " ") { ev.preventDefault(); toggleSelect(li.getAttribute("data-key")); }
      if (ev.key === "Enter") { ev.preventDefault(); var k = li.getAttribute("data-key"); if (state.selected.indexOf(k) < 0) state.selected.push(k); insertSelected(); }
    });
    $("btnInsert").onclick = function () { insertSelected(); };
    $("pubmed").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-pm]"); if (!b || !state.pubmed) return;
      var it = state.pubmed[parseInt(b.getAttribute("data-pm"), 10)];
      var r = S.addItems([it], doc.items);
      placeImported(r.keys, state.citeScope);
      if (b.getAttribute("data-act") === "cite") insertSelected(r.keys);
      else { status(r.added ? "Añadida" : "Ya estaba en tu biblioteca", "ok"); b.textContent = "Añadida"; b.disabled = true; }
      renderCiteList();
    });

    // Cita seleccionada
    $("editList").addEventListener("click", function (ev) {
      var b = ev.target.closest("button.x"); if (!b) return;
      var cid = state.currentCite, data = doc.cites[cid]; if (!data) return;
      var k = b.getAttribute("data-key");
      data.ids = data.ids.filter(function (x) { return x !== k; });
      if (data.loc) delete data.loc[k];
      if (!data.ids.length) {
        adapter.deleteCitation(cid).then(function () { delete doc.cites[cid]; state.currentCite = null; saveDoc(); return refresh(); });
        return;
      }
      saveDoc(); refresh();
    });
    $("editList").addEventListener("input", debounce(function (ev) {
      var inp = ev.target.closest("input.loc"); if (!inp) return;
      var data = doc.cites[state.currentCite]; if (!data) return;
      data.loc = data.loc || {};
      var v = inp.value.trim();
      if (v) data.loc[inp.getAttribute("data-key")] = v; else delete data.loc[inp.getAttribute("data-key")];
      saveDoc(); refresh();
    }, 500));
    $("editNarrative").onchange = function () {
      var data = doc.cites[state.currentCite]; if (!data) return;
      data.narrative = this.checked; saveDoc(); refresh();
    };
    $("btnDeleteCite").onclick = function () {
      var cid = state.currentCite; if (!cid) return;
      adapter.deleteCitation(cid).then(function () {
        delete doc.cites[cid]; state.currentCite = null; saveDoc();
        return refresh();
      }).then(function () { status("Cita borrada", "ok"); });
    };

    // Biblioteca
    $("btnImportIds").onclick = function () { importIds($("idsBox").value, false); };
    $("fileIn").onchange = function () { if (this.files.length) importFiles(this.files).then(function () { $("fileIn").value = ""; }); };
    $("btnManual").onclick = function () { openItemForm(null); };
    $("impToDoc").checked = S.getPref("importToDoc", true) !== false;
    $("impToDoc").onchange = function () { S.setPref("importToDoc", this.checked); };
    $("libScope").onchange = function () { state.libScope = this.value; renderLibList(); };
    $("libQ").addEventListener("input", debounce(function () { state.libQ = $("libQ").value; renderLibList(); }, 120));
    $("libList").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-act]"); if (!b) return;
      var k = b.getAttribute("data-key"), act = b.getAttribute("data-act");
      if (act === "edit") openItemForm(k);
      if (act === "del") deleteItem(k);
      if (act === "todoc") { addToDoc([k]); status("Añadida al documento", "ok"); renderLibList(); renderCiteList(); }
      if (act === "undoc") { delete doc.items[k]; saveDoc(); renderLibList(); renderCiteList(); status("Quitada del documento", "ok"); }
      if (act === "uncol") { S.removeFromCollection(state.libScope.slice(4), [k]); renderLibList(); }
    });
    $("btnExport").onclick = exportScope;

    // Formulario
    $("itemForm").addEventListener("submit", submitItemForm);
    $("itemForm").type.addEventListener("change", syncFormType);
    $("itemCancel").onclick = function () { $("itemModal").hidden = true; };
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { $("itemModal").hidden = true; } });

    // Formato: citas en el texto
    $("presets").addEventListener("click", function (ev) {
      var b = ev.target.closest(".preset"); if (!b) return;
      var p = E.PRESETS.filter(function (x) { return x.id === b.getAttribute("data-preset"); })[0];
      setIntext(p.cfg);
    });
    var fineMap = { fMode: "mode", fEnclose: "enclose", fNumSep: "numSep", fDash: "dash", fAyInner: "ayInner", fMultiSep: "multiSep", fEtAl: "etAl", fAnd: "and" };
    Object.keys(fineMap).forEach(function (id) { $(id).onchange = function () { var p = {}; p[fineMap[id]] = this.value; setIntext(p); }; });
    $("fEtAlMin").onchange = function () { setIntext({ etAlMin: parseInt(this.value, 10) }); };
    $("fSup").onchange = function () { setIntext({ sup: this.checked }); };
    $("fCompress").onchange = function () { setIntext({ compress: this.checked }); };
    $("fAuto").onchange = function () { setIntext({ autoFromStyle: this.checked }); };

    // Formato: estilos
    $("styleList").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-style]"); if (!b) return;
      var id = b.getAttribute("data-style");
      var s = ST.find(id) || (cfg().styleDef && cfg().styleDef.id === id ? B.completeStyle(cfg().styleDef) : null);
      if (s) applyStyle(s);
    });
    $("styleWizard").onclick = function () {
      window.CitadorStyleUI.openWizard({
        library: allItems(),
        onSave: function (s) { var saved = ST.save(s); applyStyle(saved); status("Estilo «" + saved.name + "» creado y aplicado", "ok"); },
        onEdit: function (s) { openStyleEditor(s, true); }
      });
    };
    $("styleEdit").onclick = function () {
      var s = B.clone(currentStyle());
      if (s.builtin) { s.name = s.name + " (copia)"; s.id = ""; delete s.builtin; }
      openStyleEditor(s, !ST.isMine(s.id));
    };
    $("styleDel").onclick = function () {
      var s = currentStyle();
      confirmDlg("Borrar estilo", "<p>Se borra «" + esc(s.name) + "» de tus estilos. Los documentos que lo usan lo conservan.</p>", "Borrar", true).then(function (ok) {
        if (!ok) return;
        ST.remove(s.id);
        renderStyles();
        status("Estilo borrado", "ok");
      });
    };
    $("styleExport").onclick = function () {
      var s = currentStyle();
      var text = ST.toFile(s);
      var fname = norm(s.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".citador-estilo.json";
      var a = document.createElement("a");
      a.href = download(fname, text, "application/json"); a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      status("Estilo exportado: " + fname, "ok");
    };
    $("styleIn").onchange = function () {
      var f = this.files[0]; if (!f) return;
      readFile(f).then(function (text) {
        var s = ST.fromFile(text);
        var saved = ST.save(s);
        applyStyle(saved);
        status("Estilo «" + saved.name + "» importado", "ok");
      }).catch(function (e) { status("No se pudo importar el estilo: " + errMsg(e), "error"); });
      this.value = "";
    };
    function bibOpt(id, key) {
      $(id).onchange = function () { cfg().bib[key] = this.checked; S.setPref("lastConfig", cfg()); saveDoc(); renderBibPreview(); refreshSoon(); };
    }
    bibOpt("bDOI", "includeDOI"); bibOpt("bPMID", "includePMID"); bibOpt("bURL", "includeURL");
    $("bHeading").value = cfg().heading || "Referencias";
    $("bHeading").onchange = function () { cfg().heading = this.value; saveDoc(); };
    $("btnBib").onclick = function () {
      var heading = $("bHeadingOn").checked ? $("bHeading").value.trim() : "";
      adapter.insertBibliography(heading).then(function (r) {
        if (r === "exists") { status("El documento ya tiene bibliografía; te he llevado a ella."); return; }
        return refresh().then(function () { status("Bibliografía insertada", "ok"); });
      }).catch(function (e) { status(errMsg(e), "error"); });
    };
    $("btnUnlink").onclick = function () {
      confirmDlg("Convertir en texto normal",
        "<p>Las citas y la bibliografía dejarán de actualizarse. Hazlo solo en la copia que envíes a la revista.</p><p class='muted'>Puedes deshacerlo justo después con " + (/Mac/.test(navigator.platform) ? "Cmd+Z" : "Ctrl+Z") + ".</p>",
        "Convertir", true).then(function (ok) {
          if (!ok) return;
          adapter.removeCodes().then(function (n) {
            doc.cites = {}; saveDoc();
            state.inDoc = {}; state.numbers = {}; state.currentCite = null;
            renderDocStat({ citations: 0 }); renderEditPanel();
            status(n + " elementos convertidos en texto", "ok");
          });
        });
    };
  }

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------
  function start(ad) {
    adapter = ad;
    S.readDoc().then(function (d) {
      doc.items = d.items || {};
      doc.cites = d.cites || {};
      var last = S.getPref("lastConfig", null);
      var conf = d.config || JSON.parse(JSON.stringify(last || DEFAULT_CONFIG));
      // configuración de la versión 1 (estilos CSL)
      if (conf.style && !conf.styleId) { conf.styleId = "vancouver"; delete conf.style; delete conf.lang; }
      if (!conf.styleId) conf.styleId = DEFAULT_CONFIG.styleId;
      if (conf.styleId !== "vancouver" && !conf.styleDef && !ST.find(conf.styleId)) conf.styleId = "vancouver";
      conf.intext = E.normalizeIntext(conf.intext);
      conf.bib = Object.assign({}, DEFAULT_CONFIG.bib, conf.bib || {});
      doc.config = conf;
      state.citeScope = Object.keys(doc.items).length ? "doc" : "all";
      var merged = S.mergeFromDocument(doc.items);
      bind();
      renderCiteList();
      adapter.onSelectionChange(checkSelection);
      if (d.migrated) saveDoc();
      return refresh().then(function () {
        if (merged) status(plural(merged, "referencia de este documento añadida", "referencias de este documento añadidas") + " a tu biblioteca", "ok");
      });
    });
    if (!S.lastSaveOk()) status("No se puede guardar la biblioteca en este equipo.", "error");
  }

  function boot() {
    var demo = /[?&]demo=1/.test(location.search);
    if (demo || !window.Office) {
      window.CitadorDemo.setup();
      start(window.CitadorDemo.adapter);
      return;
    }
    Office.onReady(function (info) {
      if (info.host === Office.HostType.Word) {
        if (!Office.context.requirements.isSetSupported("WordApi", "1.3")) {
          status("Esta versión de Word es demasiado antigua. Citador necesita Word 2016 o posterior.", "error", true);
        }
        start(W.adapter);
      } else {
        window.CitadorDemo.setup();
        start(window.CitadorDemo.adapter);
      }
    });
  }

  window.CitadorApp = { refresh: refresh, state: state, doc: doc, insertSelected: insertSelected, applyStyle: applyStyle, setIntext: setIntext };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
