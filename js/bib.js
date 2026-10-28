/*
 * Citador — motor propio de bibliografía.
 * Un estilo es un objeto JSON pequeño: formato de nombres, plantilla por tipo
 * de referencia y unas pocas opciones. Sin dependencias externas.
 * Funciona en el navegador (window.CitadorBib) y en Node (module.exports).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } return t; }

  var FIELDS = [
    { id: "authors", label: "Autores" },
    { id: "title", label: "Título" },
    { id: "journal", label: "Revista" },
    { id: "container", label: "Libro / sitio web / congreso" },
    { id: "editors", label: "Editores" },
    { id: "edition", label: "Edición" },
    { id: "place", label: "Ciudad" },
    { id: "publisher", label: "Editorial / institución" },
    { id: "year", label: "Año" },
    { id: "volume", label: "Volumen" },
    { id: "issue", label: "Número" },
    { id: "pages", label: "Páginas" },
    { id: "doi", label: "DOI" },
    { id: "pmid", label: "PMID" },
    { id: "url", label: "URL" },
    { id: "accessed", label: "Fecha de consulta" },
    { id: "genre", label: "Tipo de documento" }
  ];

  var TYPES = [
    { id: "article-journal", label: "Artículo de revista" },
    { id: "book", label: "Libro" },
    { id: "chapter", label: "Capítulo de libro" },
    { id: "webpage", label: "Página web" },
    { id: "report", label: "Informe / guía" },
    { id: "paper-conference", label: "Comunicación a congreso" },
    { id: "thesis", label: "Tesis" }
  ];

  var MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------------------------------------------------------------------------
  // Nombres
  // ---------------------------------------------------------------------------
  var DEFAULT_NAMES = {
    form: "family-initials",  // family-initials | family-given | initials-family | given-family
    sortSep: ", ",            // entre apellido e iniciales cuando va primero el apellido
    initPeriod: true,         // J. vs J
    initSpace: true,          // J. A. vs J.A.
    upper: false,             // apellidos en mayúsculas
    delim: ", ",              // entre autores
    last: ", ",               // antes del último autor
    max: 6,                   // si hay más de max autores se usa «et al.»
    first: 6,                 // autores que se muestran antes de «et al.»
    etAl: ", et al."          // texto tras los autores mostrados
  };

  function initialsOf(given, cfg) {
    if (!given) return "";
    var g = String(given).trim();
    var parts;
    // iniciales ya escritas: "J. A.", "JA", "J A", "J.-P."
    if (/^([A-ZÀ-Ý]\.?[\s-]*)+$/.test(g) && !/[a-zà-ÿ]/.test(g)) {
      parts = [];
      g.replace(/\./g, " ").replace(/-/g, " - ").split(/\s+/).forEach(function (x) {
        if (!x) return;
        if (x === "-") { parts.push("-"); return; }
        if (x.length > 1 && /^[A-ZÀ-Ý]+$/.test(x)) x.split("").forEach(function (c) { parts.push(c); });
        else parts.push(x.charAt(0));
      });
    } else {
      parts = [];
      g.split(/\s+/).forEach(function (w) {
        if (!w) return;
        var hy = w.split("-");
        hy.forEach(function (h, i) {
          if (i > 0) parts.push("-");
          if (h) parts.push(h.charAt(0).toUpperCase());
        });
      });
    }
    var out = "";
    parts.forEach(function (p, i) {
      if (p === "-") { out = out.replace(/\s+$/, ""); out += "-"; return; }
      var prev = parts[i - 1];
      if (out && prev !== "-" && cfg.initSpace) out += " ";
      out += p + (cfg.initPeriod ? "." : "");
    });
    return out;
  }

  function familyOf(n, cfg) {
    var f = n.family || "";
    if (n["non-dropping-particle"]) f = n["non-dropping-particle"] + " " + f;
    return cfg.upper ? f.toUpperCase() : f;
  }

  function formatName(n, cfg) {
    if (!n) return "";
    if (n.literal) return n.literal;
    var fam = familyOf(n, cfg);
    if (!n.given) return fam;
    var given = cfg.form === "family-given" || cfg.form === "given-family" ? n.given : initialsOf(n.given, cfg);
    var suffix = n.suffix ? " " + n.suffix : "";
    if (cfg.form === "family-initials" || cfg.form === "family-given") return fam + cfg.sortSep + given + suffix;
    return given + " " + fam + suffix;
  }

  function formatNames(list, cfgIn) {
    var cfg = assign({}, DEFAULT_NAMES, cfgIn || {});
    if (!list || !list.length) return "";
    var shown = list, etal = false;
    if (list.length > cfg.max) { shown = list.slice(0, Math.max(1, cfg.first)); etal = true; }
    var names = shown.map(function (n) { return formatName(n, cfg); });
    var s;
    if (etal || names.length === 1) s = names.join(cfg.delim);
    else s = names.slice(0, -1).join(cfg.delim) + cfg.last + names[names.length - 1];
    if (etal) s += cfg.etAl;
    return s;
  }

  // ---------------------------------------------------------------------------
  // Mayúsculas del título
  // ---------------------------------------------------------------------------
  var SMALL = /^(a|an|and|as|at|but|by|for|from|in|into|nor|of|on|or|over|the|to|up|via|vs|with|de|del|la|las|los|el|en|y|e|o|u|un|una|con|por|para|sin|sobre|entre)$/i;

  function isAcronym(w) { return /[A-Z].*[A-Z]/.test(w) || /\d/.test(w) || /[a-z][A-Z]/.test(w); }

  function sentenceCase(t) {
    var after = true;
    return String(t).split(/(\s+)/).map(function (w) {
      if (/^\s+$/.test(w)) return w;
      var out;
      if (isAcronym(w)) out = w;
      else if (after) out = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      else out = w.toLowerCase();
      after = /[:?!.]$/.test(w);
      return out;
    }).join("");
  }

  function titleCase(t) {
    var i = 0, after = true;
    return String(t).split(/(\s+)/).map(function (w) {
      if (/^\s+$/.test(w)) return w;
      var out;
      if (isAcronym(w)) out = w;
      else if (!after && SMALL.test(w.replace(/[^\wÀ-ÿ]/g, ""))) out = w.toLowerCase();
      else out = w.replace(/^([("'\[¿¡]?)(\S)/, function (m, a, b) { return a + b.toUpperCase(); });
      after = /[:?!.]$/.test(w);
      i++;
      return out;
    }).join("");
  }

  function applyCase(t, mode) {
    if (!t) return t;
    if (mode === "sentence") return sentenceCase(t);
    if (mode === "title") return titleCase(t);
    return t;
  }

  // ---------------------------------------------------------------------------
  // Valores de cada campo
  // ---------------------------------------------------------------------------
  function yearValue(item) {
    var d = item.issued;
    if (d && d["date-parts"] && d["date-parts"][0] && d["date-parts"][0][0]) return String(d["date-parts"][0][0]);
    if (d && d.literal) return d.literal;
    return "";
  }

  function dateValue(item, fmt) {
    var d = item.issued;
    if (!d || !d["date-parts"] || !d["date-parts"][0]) return yearValue(item);
    var p = d["date-parts"][0];
    var s = String(p[0]);
    if ((fmt === "year-month" || fmt === "year-month-day") && p[1]) s += " " + MONTHS_EN[p[1] - 1];
    if (fmt === "year-month-day" && p[1] && p[2]) s += " " + p[2];
    return s;
  }

  function minimalRange(a, b) {
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || a.length !== b.length) return b;
    var i = 0;
    while (i < a.length - 1 && a.charAt(i) === b.charAt(i)) i++;
    return b.slice(i);
  }

  function pagesValue(page, opts) {
    if (!page) return "";
    var m = /^\s*([A-Za-z]?\d+[A-Za-z]?)\s*[-–—]+\s*([A-Za-z]?\d+[A-Za-z]?)\s*$/.exec(String(page));
    if (!m) return String(page);
    var a = m[1], b = m[2];
    if (opts.pageFormat === "first") return a;
    // expandir rangos abreviados de origen (1995-8 -> 1995-2008)
    if (/^\d+$/.test(a) && /^\d+$/.test(b) && b.length < a.length) b = a.slice(0, a.length - b.length) + b;
    if (opts.pageFormat === "minimal") b = minimalRange(a, b);
    return a + (opts.pageDash || "-") + b;
  }

  function journalValue(item, opts) {
    var full = item["container-title"], short = item["container-title-short"] || item.journalAbbreviation;
    if (opts.journalForm === "short") return short || full || "";
    if (opts.journalForm === "full") return full || short || "";
    return full || short || "";
  }

  function ordinal(n) {
    var v = n % 100;
    if (v >= 11 && v <= 13) return n + "th";
    return n + (["th", "st", "nd", "rd"][n % 10] || "th");
  }

  function fieldValue(item, f, style, ctx, el) {
    var o = style.options || {};
    var names = el && el.names ? assign({}, style.names, el.names) : style.names;
    switch (f) {
      case "authors": {
        var list = item.author && item.author.length ? item.author : null;
        if (!list) return "";
        return formatNames(list, names);
      }
      case "editors": return item.editor && item.editor.length ? formatNames(item.editor, names) : "";
      case "title": return applyCase(item.title || "", o.titleCase);
      case "journal": return item.type === "article-journal" || item.type === "article" || item.type === "review" ? journalValue(item, o) : (item["container-title"] || "");
      case "container": return item["container-title"] || "";
      case "edition": {
        var e = item.edition;
        if (!e || /^1(st)?$/.test(String(e))) return "";
        if (/^\d+$/.test(String(e)) && o.editionOrdinal !== false) return ordinal(parseInt(e, 10));
        return String(e);
      }
      case "place": return item["publisher-place"] || "";
      case "publisher": return item.publisher || "";
      case "year": {
        var y = o.dateFormat && o.dateFormat !== "year" ? dateValue(item, o.dateFormat) : yearValue(item);
        if (!y) y = o.noDate || "";
        return y + ((ctx && ctx.suffix && ctx.suffix[item.id]) || "");
      }
      case "volume": return item.volume ? String(item.volume) : "";
      case "issue": return item.issue ? String(item.issue) : "";
      case "pages": return pagesValue(item.page, o);
      case "doi": return item.DOI ? (o.doiForm || "doi:{doi}").replace("{doi}", item.DOI) : "";
      case "pmid": return item.PMID ? (o.pmidForm || "PMID: {pmid}").replace("{pmid}", item.PMID) : "";
      case "url": return item.URL || "";
      case "accessed": {
        var a = item.accessed && item.accessed["date-parts"] && item.accessed["date-parts"][0];
        if (!a) return "";
        return a[0] + (a[1] ? " " + MONTHS_EN[a[1] - 1] : "") + (a[2] ? " " + a[2] : "");
      }
      case "genre": return item.genre || "";
      default: return item[f] ? String(item[f]) : "";
    }
  }

  // ---------------------------------------------------------------------------
  // Renderizado de una referencia
  // ---------------------------------------------------------------------------
  function templateFor(style, type) {
    var t = style.templates || {};
    if (t[type]) return t[type];
    var map = { "article": "article-journal", "review": "article-journal", "paper-conference": "article-journal",
      "post-weblog": "webpage", "manuscript": "report", "dataset": "webpage", "standard": "report", "entry-encyclopedia": "chapter", "thesis": "report" };
    if (map[type] && t[map[type]]) return t[map[type]];
    return t["default"] || t["article-journal"];
  }

  function textOf(runs) { return runs.map(function (r) { return r.t; }).join(""); }

  function pushText(runs, t, fmt) {
    if (!t) return;
    var last = runs[runs.length - 1];
    var r = { t: t, i: !!(fmt && fmt.i), b: !!(fmt && fmt.b) };
    if (last && last.i === r.i && last.b === r.b && !last.sup) last.t += t; else runs.push(r);
  }

  /** Devuelve las piezas con formato de una referencia. */
  function renderItem(item, style, ctx) {
    var tpl = templateFor(style, item.type) || [];
    var runs = [];
    var o = style.options || {};
    tpl.forEach(function (el) {
      var v = fieldValue(item, el.f, style, ctx, el);
      if (!v && el.alt) v = fieldValue(item, el.alt, style, ctx, el);
      if (!v) return;
      var pre = el.pre || "", suf = el.suf || "";
      var plural = (el.f === "editors" && item.editor && item.editor.length > 1) || (el.f === "authors" && item.author && item.author.length > 1);
      pre = pre.replace(/\{s\}/g, plural ? "s" : ""); suf = suf.replace(/\{s\}/g, plural ? "s" : "");
      var cur = textOf(runs);
      if (!cur) pre = pre.replace(/^[\s.,;:]+/, "");
      else if (/[.?!]$/.test(cur) && /^\./.test(pre)) pre = pre.slice(1);
      if (/[.?!]$/.test(v) && /^\./.test(suf)) suf = suf.slice(1);
      if (/[.?!]$/.test(v) && !suf) {
        // la siguiente pieza decide; nada que hacer aquí
      }
      pushText(runs, pre);
      pushText(runs, v, { i: el.i, b: el.b });
      pushText(runs, suf);
    });
    var end = o.end == null ? "." : o.end;
    var text = textOf(runs);
    var endsWithLink = /(https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+)$/i.test(text);
    if (end && text && !(endsWithLink && o.endAfterLink === false)) {
      if (!(end === "." && /[.?!]$/.test(text))) pushText(runs, end);
    }
    // limpiar dobles espacios
    runs.forEach(function (r) { r.t = r.t.replace(/ {2,}/g, " "); });
    return runs;
  }

  // ---------------------------------------------------------------------------
  // Bibliografía completa
  // ---------------------------------------------------------------------------
  function sortKey(item, style) {
    var a = item.author && item.author[0];
    var name = a ? (a.literal || ((a.family || "") + " " + (a.given || ""))) : (item.title || "");
    return (name + " " + yearValue(item) + " " + (item.title || "")).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  /**
   * ids: orden de primera aparición. opts.yearSuffix: añadir a/b a los años repetidos (autor-año).
   * Devuelve {order, entries:[{id,label:[runs],body:[runs]}], params, suffix}
   */
  function makeBibliography(style, items, ids, opts) {
    opts = opts || {};
    var o = style.options || {};
    var list = ids.filter(function (id) { return items[id]; });
    var order = list.slice();
    if (o.order === "alphabetical") {
      order.sort(function (a, b) { var ka = sortKey(items[a], style), kb = sortKey(items[b], style); return ka < kb ? -1 : ka > kb ? 1 : 0; });
    }
    // sufijos 2020a / 2020b
    var suffix = {};
    if (opts.yearSuffix) {
      var groups = {};
      order.forEach(function (id) {
        var it = items[id];
        var a = it.author && it.author[0];
        var key = (a ? (a.literal || a.family || "") : it.title || "") + "|" + (it.author ? it.author.length > 2 ? "etal" : it.author.map(function (x) { return x.family || x.literal; }).join("&") : "") + "|" + yearValue(it);
        (groups[key] = groups[key] || []).push(id);
      });
      Object.keys(groups).forEach(function (k) {
        if (groups[k].length > 1) groups[k].forEach(function (id, i) { suffix[id] = String.fromCharCode(97 + i); });
      });
    }
    var labelFmt = o.label == null ? "" : o.label;
    var entries = order.map(function (id, i) {
      var item = assign({}, items[id]);
      if (opts.includeDOI === false) delete item.DOI;
      if (opts.includePMID === false) delete item.PMID;
      if (opts.includeURL === false && item.type !== "webpage" && item.type !== "post-weblog") delete item.URL;
      var body = renderItem(item, style, { suffix: suffix });
      var label = labelFmt ? [{ t: labelFmt.replace("{n}", String(i + 1)) }] : [];
      return { id: id, label: label, body: body };
    });
    var params = {};
    if (labelFmt) params["second-field-align"] = "flush";
    else if (o.hanging) params.hangingindent = true;
    return { order: order, entries: entries, params: params, suffix: suffix, hasBib: true };
  }

  // ---------------------------------------------------------------------------
  // Estilos incluidos (escritos desde cero para Citador)
  // ---------------------------------------------------------------------------
  function el(f, pre, suf, extra) { return assign({ f: f, pre: pre || "", suf: suf || "" }, extra || {}); }

  var VANCOUVER_NAMES = { form: "family-initials", sortSep: " ", initPeriod: false, initSpace: false, delim: ", ", last: ", ", max: 6, first: 6, etAl: ", et al." };

  var BUILTIN = [
    {
      id: "vancouver", name: "Vancouver (ICMJE)", builtin: true,
      citation: { mode: "number", enclose: "brackets", sup: false, compress: true, dash: "-", numSep: "," },
      names: VANCOUVER_NAMES,
      options: { label: "{n}.", order: "appearance", journalForm: "short", titleCase: "as-is", pageFormat: "minimal", pageDash: "-", doiForm: "doi:{doi}", end: ".", endAfterLink: false },
      templates: {
        "article-journal": [el("authors"), el("title", ". "), el("journal", ". "), el("year", ". "), el("volume", ";"), el("issue", "(", ")"), el("pages", ":"), el("doi", ". ")],
        "book": [el("authors"), el("title", ". "), el("edition", ". ", " ed"), el("place", ". "), el("publisher", ": "), el("year", "; ")],
        "chapter": [el("authors"), el("title", ". "), el("editors", ". In: ", ", editor{s}"), el("container", ". "), el("edition", ". ", " ed"), el("place", ". "), el("publisher", ": "), el("year", "; "), el("pages", ". p. ")],
        "webpage": [el("authors"), el("title", ". ", " [Internet]"), el("container", ". "), el("year", "; "), el("accessed", " [cited ", "]"), el("url", ". Available from: ")],
        "report": [el("authors"), el("title", ". "), el("place", ". "), el("publisher", ": "), el("year", "; ")]
      }
    },
    {
      id: "ama", name: "AMA 11.ª edición", builtin: true,
      citation: { mode: "number", enclose: "none", sup: true, compress: true, dash: "-", numSep: "," },
      names: { form: "family-initials", sortSep: " ", initPeriod: false, initSpace: false, delim: ", ", last: ", ", max: 6, first: 3, etAl: ", et al" },
      options: { label: "{n}.", order: "appearance", journalForm: "short", titleCase: "as-is", pageFormat: "full", pageDash: "-", doiForm: "doi:{doi}", end: ".", endAfterLink: false },
      templates: {
        "article-journal": [el("authors"), el("title", ". "), el("journal", ". ", "", { i: true }), el("year", ". "), el("volume", ";"), el("issue", "(", ")"), el("pages", ":"), el("doi", ". ")],
        "book": [el("authors"), el("title", ". ", "", { i: true }), el("edition", ". ", " ed"), el("publisher", ". "), el("year", "; ")],
        "chapter": [el("authors"), el("title", ". "), el("editors", ". In: ", ", ed{s}"), el("container", ". ", "", { i: true }), el("edition", ". ", " ed"), el("publisher", ". "), el("year", "; "), el("pages", ":")],
        "webpage": [el("authors"), el("title", ". "), el("container", ". "), el("year", ". "), el("accessed", ". Accessed "), el("url", ". ")],
        "report": [el("authors"), el("title", ". ", "", { i: true }), el("publisher", ". "), el("year", "; ")]
      }
    },
    {
      id: "apa", name: "APA 7.ª edición", builtin: true,
      citation: { mode: "author-year", enclose: "parens", sup: false, ayInner: ", ", multiSep: "; ", etAlMin: 3, etAl: "et al.", and: "&" },
      names: { form: "family-initials", sortSep: ", ", initPeriod: true, initSpace: true, delim: ", ", last: ", & ", max: 20, first: 19, etAl: ", et al." },
      options: { label: "", hanging: true, order: "alphabetical", journalForm: "full", titleCase: "as-is", pageFormat: "full", pageDash: "–", doiForm: "https://doi.org/{doi}", end: ".", endAfterLink: false, noDate: "n.d." },
      templates: {
        "article-journal": [el("authors", "", "."), el("year", " (", ")"), el("title", ". "), el("journal", ". ", "", { i: true }), el("volume", ", ", "", { i: true }), el("issue", "(", ")"), el("pages", ", "), el("doi", ". ")],
        "book": [el("authors", "", "."), el("year", " (", ")"), el("title", ". ", "", { i: true }), el("edition", " (", " ed.)"), el("publisher", ". "), el("doi", ". ")],
        "chapter": [el("authors", "", "."), el("year", " (", ")"), el("title", ". "), el("editors", ". In ", " (Ed{s}.)", { names: { form: "initials-family", last: ", & " } }), el("container", ", ", "", { i: true }), el("pages", " (pp. ", ")"), el("publisher", ". "), el("doi", ". ")],
        "webpage": [el("authors", "", "."), el("year", " (", ")"), el("title", ". ", "", { i: true }), el("container", ". "), el("url", ". ")],
        "report": [el("authors", "", "."), el("year", " (", ")"), el("title", ". ", "", { i: true }), el("publisher", ". "), el("url", ". ")]
      }
    },
    {
      id: "harvard", name: "Harvard", builtin: true,
      citation: { mode: "author-year", enclose: "parens", sup: false, ayInner: ", ", multiSep: "; ", etAlMin: 4, etAl: "et al.", and: "and" },
      names: { form: "family-initials", sortSep: ", ", initPeriod: true, initSpace: false, delim: ", ", last: " and ", max: 20, first: 20, etAl: " et al." },
      options: { label: "", hanging: true, order: "alphabetical", journalForm: "full", titleCase: "as-is", pageFormat: "full", pageDash: "–", doiForm: "doi:{doi}", end: ".", endAfterLink: false, noDate: "no date" },
      templates: {
        "article-journal": [el("authors"), el("year", " (", ")"), el("title", " '", "'"), el("journal", ", ", "", { i: true }), el("volume", ", "), el("issue", "(", ")"), el("pages", ", pp. "), el("doi", ". ")],
        "book": [el("authors"), el("year", " (", ")"), el("title", " ", "", { i: true }), el("edition", ". ", " edn"), el("place", ". "), el("publisher", ": ")],
        "chapter": [el("authors"), el("year", " (", ")"), el("title", " '", "'"), el("editors", ", in ", " (ed{s}.)", { names: { form: "initials-family" } }), el("container", " ", "", { i: true }), el("place", ". "), el("publisher", ": "), el("pages", ", pp. ")],
        "webpage": [el("authors"), el("year", " (", ")"), el("title", " ", "", { i: true }), el("url", ". Available at: "), el("accessed", " (Accessed: ", ")")],
        "report": [el("authors"), el("year", " (", ")"), el("title", " ", "", { i: true }), el("place", ". "), el("publisher", ": ")]
      }
    }
  ];

  function builtinStyles() { return clone(BUILTIN); }

  /** Rellena los huecos de un estilo (tipos sin plantilla) a partir de su plantilla de artículo. */
  function completeStyle(style) {
    var s = clone(style);
    s.names = assign({}, DEFAULT_NAMES, s.names || {});
    s.options = assign({ label: "{n}.", order: "appearance", journalForm: "as-is", titleCase: "as-is", pageFormat: "full", pageDash: "-", doiForm: "doi:{doi}", end: "." }, s.options || {});
    s.templates = s.templates || {};
    var art = s.templates["article-journal"];
    if (art) {
      var sepAfterAuthors = (art[1] && art[1].pre) || ". ";
      var sepAfterTitle = (art[2] && art[2].pre) || ". ";
      var yearEl = art.filter(function (e) { return e.f === "year"; })[0] || { pre: ". " };
      var titleEl = art.filter(function (e) { return e.f === "title"; })[0] || {};
      var mk = function (rest) {
        return [el("authors"), el("title", sepAfterAuthors, titleEl.suf || "", { i: titleEl.i })].concat(rest);
      };
      if (!s.templates.book) s.templates.book = mk([el("edition", sepAfterTitle, " ed."), el("place", sepAfterTitle), el("publisher", ": "), el("year", yearEl.pre === ". " ? ", " : yearEl.pre)]);
      if (!s.templates.report) s.templates.report = mk([el("publisher", sepAfterTitle), el("place", ", "), el("year", ", ")]);
      if (!s.templates.chapter) s.templates.chapter = mk([el("editors", sepAfterTitle + "In: ", " (eds.)"), el("container", sepAfterTitle), el("place", sepAfterTitle), el("publisher", ": "), el("year", ", "), el("pages", ", pp. ")]);
      if (!s.templates.webpage) s.templates.webpage = mk([el("container", sepAfterTitle), el("year", yearEl.pre), el("url", ". Available from: "), el("accessed", " (accessed ", ")")]);
    }
    return s;
  }

  var api = {
    FIELDS: FIELDS, TYPES: TYPES, DEFAULT_NAMES: DEFAULT_NAMES,
    initialsOf: initialsOf, formatName: formatName, formatNames: formatNames,
    sentenceCase: sentenceCase, titleCase: titleCase, applyCase: applyCase,
    pagesValue: pagesValue, fieldValue: fieldValue, yearValue: yearValue,
    renderItem: renderItem, textOf: textOf, makeBibliography: makeBibliography,
    builtinStyles: builtinStyles, completeStyle: completeStyle, templateFor: templateFor, clone: clone
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CitadorBib = api;
})(typeof window !== "undefined" ? window : this);
