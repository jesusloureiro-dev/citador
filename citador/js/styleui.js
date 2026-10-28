/*
 * Citador — asistente para crear estilos a partir de ejemplos y editor de estilos.
 */
(function (root) {
  "use strict";

  var B = root.CitadorBib, D = root.CitadorDetect, E = root.CitadorEngine;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function dlg() { return root.CitadorDialogs; }

  var TEST_ITEMS = [
    { id: "t1", type: "article-journal", title: "Effect of a polypill strategy on cardiovascular outcomes in older adults", author: [{ family: "García-López", given: "Ana María" }, { family: "Smith", given: "John R." }, { family: "Okafor", given: "C." }, { family: "Lindqvist", given: "Eva" }, { family: "Moreau", given: "Jean-Pierre" }, { family: "Ito", given: "Kenji" }, { family: "Novak", given: "Petra" }, { family: "Silva", given: "Rui" }], "container-title": "New England Journal of Medicine", "container-title-short": "N Engl J Med", issued: { "date-parts": [[2022, 9, 1]] }, volume: "387", issue: "11", page: "967-977", DOI: "10.1056/NEJMoa2208275" },
    { id: "t2", type: "article-journal", title: "Single-pill combinations in primary care: a pragmatic trial", author: [{ family: "Chen", given: "Y." }, { family: "Patel", given: "Sunil" }], "container-title": "Journal of Clinical Medicine", "container-title-short": "J Clin Med", issued: { "date-parts": [[2024]] }, volume: "13", page: "e1043", DOI: "10.3390/jcm13041043" },
    { id: "t3", type: "book", title: "Harrison's principles of internal medicine", author: [{ family: "Loscalzo", given: "Joseph" }, { family: "Fauci", given: "Anthony S." }], publisher: "McGraw-Hill", "publisher-place": "New York", issued: { "date-parts": [[2022]] }, edition: "21" },
    { id: "t4", type: "chapter", title: "Hypertensive emergencies", author: [{ family: "Pérez", given: "Ana" }], editor: [{ family: "Gómez", given: "Beatriz" }, { family: "Ruiz", given: "Carlos" }], "container-title": "Manual de urgencias", publisher: "Elsevier", "publisher-place": "Madrid", issued: { "date-parts": [[2021]] }, page: "210-225" },
    { id: "t5", type: "webpage", title: "Hypertension fact sheet", author: [{ literal: "World Health Organization" }], "container-title": "WHO", issued: { "date-parts": [[2023]] }, URL: "https://www.who.int/news-room/fact-sheets/detail/hypertension", accessed: { "date-parts": [[2025, 3, 1]] } }
  ];

  function runsHtml(runs) {
    return runs.map(function (x) {
      var t = esc(x.t);
      if (x.i) t = "<i>" + t + "</i>"; if (x.b) t = "<b>" + t + "</b>"; if (x.sup) t = "<sup>" + t + "</sup>";
      return t;
    }).join("");
  }

  function renderPreview(style, extra) {
    var items = (extra || []).concat(TEST_ITEMS);
    var label = style.options.label || "";
    return items.map(function (it, i) {
      var runs;
      try { runs = B.renderItem(it, style, {}); } catch (e) { return "<p class='error'>" + esc(e.message) + "</p>"; }
      return "<p class='pv " + (label ? "label" : style.options.hanging ? "hanging" : "") + "'>" +
        (label ? "<span class='n'>" + esc(label.replace("{n}", i + 1)) + "</span>" : "") + "<span>" + runsHtml(runs) + "</span></p>";
    }).join("");
  }

  // ---------------------------------------------------------------------------
  // Pegado con formato -> líneas con cursiva/negrita
  // ---------------------------------------------------------------------------
  var BLOCK = /^(P|DIV|LI|TR|H[1-6]|BLOCKQUOTE|UL|OL|TABLE|TBODY|SECTION|ARTICLE)$/;

  function htmlToLines(html) {
    var d = new DOMParser().parseFromString(html, "text/html");
    var lines = [[]];
    function newLine() { if (lines[lines.length - 1].length) lines.push([]); }
    function walk(node, fmt) {
      if (node.nodeType === 3) {
        var t = node.nodeValue.replace(/[\s ]+/g, " ");
        if (t) lines[lines.length - 1].push({ t: t, i: fmt.i, b: fmt.b });
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === "STYLE" || tag === "SCRIPT" || tag === "HEAD" || tag === "META" || tag === "TITLE") return;
      if (tag === "BR") { newLine(); return; }
      var st = (node.getAttribute("style") || "").toLowerCase();
      var f = { i: fmt.i, b: fmt.b };
      if (tag === "I" || tag === "EM" || /font-style:\s*italic/.test(st)) f.i = true;
      if (/font-style:\s*normal/.test(st)) f.i = false;
      if (tag === "B" || tag === "STRONG" || /font-weight:\s*(bold|[6-9]00)/.test(st)) f.b = true;
      if (/font-weight:\s*(normal|400)/.test(st)) f.b = false;
      var block = BLOCK.test(tag);
      if (block) newLine();
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c, f);
      if (block) newLine();
    }
    walk(d.body, { i: false, b: false });
    return lines.map(cleanRuns).filter(function (r) { return r.length; });
  }

  function cleanRuns(runs) {
    var out = [];
    runs.forEach(function (r) {
      var last = out[out.length - 1];
      if (last && !!last.i === !!r.i && !!last.b === !!r.b) last.t += r.t; else out.push({ t: r.t, i: !!r.i, b: !!r.b });
    });
    if (out.length) { out[0].t = out[0].t.replace(/^\s+/, ""); out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, ""); }
    out = out.filter(function (r) { return r.t; });
    return out;
  }

  function textLines(text) {
    return D.splitExamples(text).map(function (l) { return [{ t: l, i: false, b: false }]; });
  }

  function linesToHtml(lines) {
    return lines.map(function (runs) { return "<div>" + runsHtml(runs) + "</div>"; }).join("");
  }

  function readBox(box) {
    // la caja solo contiene <div> por línea con <i>/<b>, tras limpiar el pegado
    return htmlToLines(box.innerHTML);
  }

  // ---------------------------------------------------------------------------
  // Asistente
  // ---------------------------------------------------------------------------
  var wiz = null;

  function openWizard(opts) {
    wiz = { opts: opts, lines: [], results: null, style: null, report: null };
    showStep1();
    $("styleModal").hidden = false;
  }

  function close() { $("styleModal").hidden = true; }

  function sheet(html) { $("styleSheet").innerHTML = html; }

  function showStep1() {
    sheet(
      "<h2>Crear un estilo a partir de ejemplos</h2>" +
      "<label class='stack'>Nombre del estilo<input id='wName' class='field' placeholder='p. ej. Emergencias' value='" + esc(wiz.name || "") + "'></label>" +
      "<div class='stack'><span>Referencias de ejemplo</span>" +
      "<div id='wBox' class='pastebox' contenteditable='true' data-ph='Pega aquí 3 o más referencias tal como aparecen en un artículo de la revista, una por línea.'></div>" +
      "<span class='hint'>Cuantas más, mejor; procura que alguna tenga muchos autores. Si las copias desde la web de la revista o desde Word se conservan cursivas y negritas.</span></div>" +
      "<label class='stack'>Cómo aparecen las citas en el texto<input id='wCite' class='field' placeholder='¹,³⁻⁵   o   [1,3-5]   o   (Smith et al., 2020)' value='" + esc(wiz.cite || "") + "'></label>" +
      "<label class='check'><input type='checkbox' id='wSup'" + (wiz.sup ? " checked" : "") + "> Los números van en superíndice</label>" +
      "<div class='row end'><button class='secondary' id='wCancel'>Cancelar</button><button class='primary' id='wGo'>Analizar ejemplos</button></div>"
    );
    var box = $("wBox");
    if (wiz.lines.length) box.innerHTML = linesToHtml(wiz.lines);
    box.addEventListener("paste", function (ev) {
      ev.preventDefault();
      var cd = ev.clipboardData || window.clipboardData;
      var html = cd.getData("text/html"), text = cd.getData("text/plain");
      var lines = html ? htmlToLines(html) : textLines(text);
      var existing = box.innerText.trim() ? readBox(box) : [];
      box.innerHTML = linesToHtml(existing.concat(lines));
    });
    $("wCancel").onclick = close;
    $("wGo").onclick = function () {
      wiz.name = $("wName").value.trim();
      wiz.cite = $("wCite").value.trim();
      wiz.sup = $("wSup").checked;
      wiz.lines = readBox(box);
      if (wiz.lines.length < 2) { dlg().status("Pega al menos dos referencias, una por línea.", "error"); return; }
      showStep2();
    };
    setTimeout(function () { box.focus(); }, 30);
  }

  function showStep2() {
    var lines = wiz.lines.slice(0, 25);
    sheet(
      "<h2>Identificando los ejemplos</h2>" +
      "<p class='hint'>Busco cada referencia en tu biblioteca y, si no está, en Crossref, para saber qué dato es cada parte.</p>" +
      "<ul class='idlist' id='wIds'>" + lines.map(function (runs, i) {
        var t = B.textOf(runs);
        return "<li id='wId" + i + "'><span class='st'>…</span><span class='tx'>" + esc(t.length > 110 ? t.slice(0, 108) + "…" : t) + "</span></li>";
      }).join("") + "</ul>" +
      "<div class='row end'><button class='secondary' id='wBack'>Volver</button></div>"
    );
    $("wBack").onclick = showStep1;
    var texts = lines.map(function (r) { return B.textOf(r); });
    D.identify(texts, wiz.opts.library || {}, function (i, r) {
      var li = $("wId" + i); if (!li) return;
      li.className = r.item ? "ok" : "ko";
      li.querySelector(".st").textContent = r.item ? "✓" : "✗";
      if (r.item) li.title = "Encontrada en " + r.source;
      else li.title = r.error ? "Sin conexión" : "No encontrada";
    }).then(function (results) {
      wiz.results = results;
      var found = results.filter(function (r) { return r.item; }).length;
      if (!found) {
        var offline = results.some(function (r) { return r.error; });
        $("wIds").insertAdjacentHTML("afterend", "<p class='warn'>" + (offline
          ? "No hay conexión con Crossref. Conéctate a Internet o importa antes esas referencias en tu biblioteca (por PMID o DOI) y vuelve a intentarlo."
          : "No he podido identificar ninguna referencia. Prueba con otras de artículos que tengan DOI.") + "</p>");
        return;
      }
      analyze();
    });
  }

  function analyze() {
    var lines = wiz.lines.slice(0, 25);
    var citation = D.parseIntext(wiz.cite, wiz.sup) || { mode: "number", enclose: "brackets", sup: wiz.sup };
    citation = E.normalizeIntext(citation);
    var pairs = lines.map(function (runs, i) { return { text: B.textOf(runs), runs: runs, item: wiz.results[i] && wiz.results[i].item }; });
    var r = D.inferStyle(pairs, citation, wiz.name || "Mi estilo");
    if (!r.style) { dlg().status(r.report.error, "error"); return; }
    wiz.style = r.style;
    wiz.report = r.report;
    showResult();
  }

  function showResult() {
    var s = wiz.style, rep = wiz.report;
    var bad = rep.checks.filter(function (c) { return !c.ok; });
    var ci = E.computeCitations([{ cid: "a", ids: ["t1", "t2", "t3"] }], { t1: TEST_ITEMS[0], t2: TEST_ITEMS[1], t3: TEST_ITEMS[2] }, s.citation, ["t1", "t2", "t3"], {}).citations[0];
    sheet(
      "<h2>Estilo detectado</h2>" +
      "<label class='stack'>Nombre<input id='wName2' class='field' value='" + esc(s.name) + "'></label>" +
      "<div class='verdict " + (bad.length ? "partial" : "full") + "'><strong>" + rep.exact + " de " + rep.analyzed + "</strong> ejemplos reproducidos exactamente" +
      (rep.skipped.length ? "<span class='muted'> · " + rep.skipped.length + " sin identificar</span>" : "") + "</div>" +
      "<ul class='rules'>" + D.describe(s).map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") +
      "<li>Citas en el texto como «" + runsHtml(ci.runs) + "»</li></ul>" +
      (rep.notes.length ? rep.notes.map(function (n) { return "<p class='warn'>" + esc(n) + "</p>"; }).join("") : "") +
      (bad.length ? "<details class='diffs'><summary>Ver los que no coinciden (" + bad.length + ")</summary>" + bad.map(function (c) {
        return "<div class='diff'><div><span class='muted'>Ejemplo " + (c.index + 1) + "</span> " + esc(c.original) + "</div><div><span class='muted'>Citador</span> " + diffHtml(c.original, c.rendered) + "</div></div>";
      }).join("") + "<p class='hint'>Suele deberse a diferencias en los datos (por ejemplo, la revista escrita completa en un ejemplo y abreviada en otro), no al estilo.</p></details>" : "") +
      "<div class='stack'><span>Así quedarían otras referencias</span><div class='bibpreview'>" + renderPreview(s) + "</div></div>" +
      "<div class='row end'><button class='secondary' id='wBack2'>Volver</button><button class='secondary' id='wEdit'>Ajustar en el editor</button><button class='primary' id='wSave'>Guardar y aplicar</button></div>"
    );
    $("wBack2").onclick = showStep1;
    $("wEdit").onclick = function () { s.name = $("wName2").value.trim() || s.name; close(); wiz.opts.onEdit(s); };
    $("wSave").onclick = function () { s.name = $("wName2").value.trim() || s.name; close(); wiz.opts.onSave(s); };
  }

  /** Resalta en `b` lo que difiere de `a` (por palabras). */
  function diffHtml(a, b) {
    var A = a.split(/(\s+)/), Bw = b.split(/(\s+)/);
    var setA = {};
    A.forEach(function (w) { setA[w] = (setA[w] || 0) + 1; });
    return Bw.map(function (w) {
      if (/^\s+$/.test(w)) return w;
      if (setA[w]) { setA[w]--; return esc(w); }
      return "<mark>" + esc(w) + "</mark>";
    }).join("");
  }

  // ---------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------
  var ed = null;

  var NAME_FORMS = [
    { v: "family-initials", l: "Apellido + iniciales" },
    { v: "family-given", l: "Apellido + nombre" },
    { v: "initials-family", l: "Iniciales + apellido" },
    { v: "given-family", l: "Nombre + apellido" }
  ];
  var INITIALS = [
    { v: "11", l: "A. M." }, { v: "10", l: "A.M." }, { v: "00", l: "AM" }, { v: "01", l: "A M" }
  ];

  function openEditor(style, opts) {
    ed = { style: B.completeStyle(style), opts: opts || {}, type: "article-journal" };
    if (!ed.style.name) ed.style.name = "Mi estilo";
    drawEditor();
    $("styleModal").hidden = false;
  }

  function sel(id, list, value) {
    return "<select id='" + id + "'>" + list.map(function (o) { return "<option value='" + esc(o.v) + "'" + (String(o.v) === String(value) ? " selected" : "") + ">" + esc(o.l) + "</option>"; }).join("") + "</select>";
  }

  function drawEditor() {
    var s = ed.style, n = s.names, o = s.options;
    var types = B.TYPES.map(function (t) { return { v: t.id, l: t.label + (s.templates[t.id] ? "" : " (automática)") }; });
    sheet(
      "<h2>" + (ed.opts.isNew ? "Nuevo estilo" : "Editar estilo") + "</h2>" +
      "<label class='stack'>Nombre<input id='eName' class='field' value='" + esc(s.name) + "'></label>" +
      "<div class='bibpreview edprev' id='ePrev'></div>" +
      "<details open class='edsec'><summary>Autores</summary><div class='grid2'>" +
      "<label>Formato" + sel("eForm", NAME_FORMS, n.form) + "</label>" +
      "<label>Iniciales" + sel("eInit", INITIALS, (n.initPeriod ? "1" : "0") + (n.initSpace ? "1" : "0")) + "</label>" +
      "<label>Entre apellido e iniciales" + sel("eSortSep", [{ v: ", ", l: "García, A." }, { v: " ", l: "García A." }], n.sortSep) + "</label>" +
      "<label>Entre autores<input id='eDelim' class='mono' value='" + esc(n.delim) + "'></label>" +
      "<label>Antes del último<input id='eLast' class='mono' value='" + esc(n.last) + "'></label>" +
      "<label>Texto «et al.»<input id='eEtAl' class='mono' value='" + esc(n.etAl) + "'></label>" +
      "<label>Todos los autores hasta<input id='eMax' type='number' min='1' max='100' value='" + n.max + "'></label>" +
      "<label>Si hay más, mostrar<input id='eFirst' type='number' min='1' max='100' value='" + n.first + "'></label>" +
      "</div><label class='check'><input type='checkbox' id='eUpper'" + (n.upper ? " checked" : "") + "> Apellidos en mayúsculas</label></details>" +
      "<details class='edsec'><summary>Lista y detalles</summary><div class='grid2'>" +
      "<label>Numeración<input id='eLabel' class='mono' value='" + esc(o.label || "") + "' placeholder='{n}.'></label>" +
      "<label>Orden" + sel("eOrder", [{ v: "appearance", l: "Orden de aparición" }, { v: "alphabetical", l: "Alfabético" }], o.order) + "</label>" +
      "<label>Revista" + sel("eJournal", [{ v: "short", l: "Abreviada" }, { v: "full", l: "Nombre completo" }, { v: "as-is", l: "Como esté en los datos" }], o.journalForm) + "</label>" +
      "<label>Título" + sel("eCase", [{ v: "as-is", l: "Como esté en los datos" }, { v: "sentence", l: "Tipo oración" }, { v: "title", l: "Tipo Título" }], o.titleCase) + "</label>" +
      "<label>Páginas" + sel("ePages", [{ v: "full", l: "1995-2008" }, { v: "minimal", l: "1995-8" }, { v: "first", l: "Solo la primera" }], o.pageFormat) + "</label>" +
      "<label>Guion de páginas" + sel("eDash", [{ v: "-", l: "- guion" }, { v: "–", l: "– semirraya" }], o.pageDash) + "</label>" +
      "<label>DOI<input id='eDoi' class='mono' value='" + esc(o.doiForm) + "'></label>" +
      "<label>Final de cada referencia<input id='eEnd' class='mono' value='" + esc(o.end) + "'></label>" +
      "</div><label class='check'><input type='checkbox' id='eHanging'" + (o.hanging ? " checked" : "") + "> Sangría francesa (sin números)</label>" +
      "<p class='hint'>{n} es el número de la referencia y {doi} el DOI. Los espacios cuentan.</p></details>" +
      "<details open class='edsec'><summary>Orden de los datos</summary>" +
      "<label class='stack'>Tipo de referencia" + sel("eType", types, ed.type) + "</label>" +
      "<div class='tplhead'><span>Antes</span><span>Dato</span><span>Después</span><span>Formato</span></div>" +
      "<ul class='tpl' id='eTpl'></ul>" +
      "<button class='linkbtn' id='eAdd'>Añadir un dato</button></details>" +
      "<div class='row end'><button class='secondary' id='eCancel'>Cancelar</button><button class='primary' id='eSave'>Guardar estilo</button></div>"
    );
    drawTemplate();
    bindEditor();
    updatePreview();
  }

  function fieldOptions(value, withNone) {
    var list = (withNone ? [{ id: "", label: "Si falta: nada" }] : []).concat(B.FIELDS);
    return list.map(function (f) {
      var lbl = withNone && f.id ? "Si falta: " + f.label.toLowerCase() : f.label;
      return "<option value='" + f.id + "'" + (f.id === value ? " selected" : "") + ">" + esc(lbl) + "</option>";
    }).join("");
  }

  function currentTpl() {
    var s = ed.style;
    if (!s.templates[ed.type]) s.templates[ed.type] = B.clone(B.templateFor(B.completeStyle(s), ed.type) || []);
    return s.templates[ed.type];
  }

  function drawTemplate() {
    var tpl = currentTpl();
    $("eTpl").innerHTML = tpl.map(function (e, i) {
      return "<li data-i='" + i + "'>" +
        "<input class='mono pre' value='" + esc(e.pre || "") + "' aria-label='Texto antes'>" +
        "<span class='fld'><select class='f'>" + fieldOptions(e.f) + "</select>" +
        "<select class='alt' title='Si falta, usar…'>" + fieldOptions(e.alt || "", true) + "</select></span>" +
        "<input class='mono suf' value='" + esc(e.suf || "") + "' aria-label='Texto después'>" +
        "<span class='fmt'><label title='Cursiva'><input type='checkbox' class='it'" + (e.i ? " checked" : "") + "><i>K</i></label>" +
        "<label title='Negrita'><input type='checkbox' class='bo'" + (e.b ? " checked" : "") + "><b>N</b></label>" +
        "<button class='mv' data-d='-1' title='Subir'>↑</button><button class='mv' data-d='1' title='Bajar'>↓</button><button class='rm' title='Quitar'>×</button></span></li>";
    }).join("");
  }

  function readEditor() {
    var s = ed.style, n = s.names, o = s.options;
    s.name = $("eName").value.trim() || s.name;
    n.form = $("eForm").value;
    var ini = $("eInit").value; n.initPeriod = ini.charAt(0) === "1"; n.initSpace = ini.charAt(1) === "1";
    n.sortSep = $("eSortSep").value; n.delim = $("eDelim").value; n.last = $("eLast").value; n.etAl = $("eEtAl").value;
    n.max = Math.max(1, parseInt($("eMax").value, 10) || 6); n.first = Math.max(1, Math.min(n.max, parseInt($("eFirst").value, 10) || 3));
    n.upper = $("eUpper").checked;
    o.label = $("eLabel").value; o.order = $("eOrder").value; o.journalForm = $("eJournal").value; o.titleCase = $("eCase").value;
    o.pageFormat = $("ePages").value; o.pageDash = $("eDash").value; o.doiForm = $("eDoi").value || "doi:{doi}"; o.end = $("eEnd").value;
    o.hanging = $("eHanging").checked;
    var tpl = currentTpl();
    Array.prototype.forEach.call($("eTpl").children, function (li) {
      var e = tpl[parseInt(li.getAttribute("data-i"), 10)];
      e.pre = li.querySelector(".pre").value; e.suf = li.querySelector(".suf").value;
      e.f = li.querySelector(".f").value; var alt = li.querySelector(".alt").value; if (alt) e.alt = alt; else delete e.alt;
      e.i = li.querySelector(".it").checked; e.b = li.querySelector(".bo").checked;
    });
  }

  function updatePreview() {
    try { readEditor(); } catch (e) { /* formulario a medias */ }
    $("ePrev").innerHTML = renderPreview(ed.style, ed.opts.sampleItems);
  }

  function bindEditor() {
    var sheetEl = $("styleSheet");
    sheetEl.oninput = function () { updatePreview(); };
    sheetEl.onchange = function (ev) {
      if (ev.target.id === "eType") { readEditor(); ed.type = ev.target.value; drawTemplate(); }
      updatePreview();
    };
    $("eTpl").onclick = function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      readEditor();
      var tpl = currentTpl(), i = parseInt(b.closest("li").getAttribute("data-i"), 10);
      if (b.classList.contains("rm")) tpl.splice(i, 1);
      if (b.classList.contains("mv")) {
        var j = i + parseInt(b.getAttribute("data-d"), 10);
        if (j >= 0 && j < tpl.length) { var t = tpl[i]; tpl[i] = tpl[j]; tpl[j] = t; }
      }
      drawTemplate(); updatePreview();
    };
    $("eAdd").onclick = function () { readEditor(); currentTpl().push({ f: "doi", pre: ". ", suf: "" }); drawTemplate(); updatePreview(); };
    $("eCancel").onclick = close;
    $("eSave").onclick = function () {
      readEditor();
      sheetEl.oninput = null; sheetEl.onchange = null;
      close();
      ed.opts.onSave(ed.style);
    };
  }

  root.CitadorStyleUI = { openWizard: openWizard, openEditor: openEditor, htmlToLines: htmlToLines, TEST_ITEMS: TEST_ITEMS };
})(window);
