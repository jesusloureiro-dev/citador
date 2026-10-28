/*
 * Citador — motor de citas.
 * Independiente de Word: calcula numeración, texto de las citas en el cuerpo
 * y convierte la bibliografía a OOXML.
 * Funciona en el navegador (window.CitadorEngine) y en Node (module.exports).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuración de las citas en el texto
  // ---------------------------------------------------------------------------
  var DEFAULT_INTEXT = {
    mode: "number",        // "number" | "author-year" | "author-number"
    enclose: "brackets",   // "brackets" | "parens" | "none"
    sup: false,            // número en superíndice
    compress: true,        // 1,2,3 -> 1–3
    dash: "–",        // guion de rango
    numSep: ",",           // separador entre números
    ayInner: ", ",         // entre autor y año: (Smith, 2020) / (Smith 2020)
    multiSep: "; ",        // entre referencias autor-año
    etAlMin: 3,            // a partir de cuántos autores se usa "et al."
    etAl: "et al.",
    and: "&",              // conector de dos autores
    autoFromStyle: true    // ajustar al elegir estilo de bibliografía
  };

  var PRESETS = [
    { id: "brackets", label: "Corchetes", cfg: { mode: "number", enclose: "brackets", sup: false } },
    { id: "parens", label: "Paréntesis", cfg: { mode: "number", enclose: "parens", sup: false } },
    { id: "sup", label: "Superíndice", cfg: { mode: "number", enclose: "none", sup: true } },
    { id: "author-year", label: "Autor, año", cfg: { mode: "author-year", enclose: "parens", sup: false, ayInner: ", " } },
    { id: "author-year-nc", label: "Autor año", cfg: { mode: "author-year", enclose: "parens", sup: false, ayInner: " " } },
    { id: "author-number", label: "Autor + número", cfg: { mode: "author-number", enclose: "brackets", sup: false } },
    { id: "author-sup", label: "Autor + superíndice", cfg: { mode: "author-number", enclose: "none", sup: true } }
  ];

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  function normalizeIntext(cfg) {
    return assign({}, DEFAULT_INTEXT, cfg || {});
  }

  function presetMatches(preset, cfg) {
    for (var k in preset.cfg) if (preset.cfg[k] !== cfg[k]) return false;
    return true;
  }

  function matchPreset(cfg) {
    cfg = normalizeIntext(cfg);
    for (var i = 0; i < PRESETS.length; i++) if (presetMatches(PRESETS[i], cfg)) return PRESETS[i].id;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Nombres y años para las citas autor-año
  // ---------------------------------------------------------------------------
  function nameOf(n) {
    if (!n) return "";
    if (n.literal) return n.literal;
    var fam = n.family || n.given || "";
    if (n["non-dropping-particle"]) fam = n["non-dropping-particle"] + " " + fam;
    return fam;
  }

  function authorLabel(item, cfg) {
    var names = (item.author && item.author.length ? item.author : (item.editor || [])) || [];
    if (!names.length) {
      var t = item["title-short"] || item.title || "Sin autor";
      var words = String(t).split(/\s+/);
      return words.length > 4 ? words.slice(0, 4).join(" ") + "…" : t;
    }
    var and = cfg.and === "&" ? " & " : " " + cfg.and + " ";
    if (names.length === 1) return nameOf(names[0]);
    if (names.length >= cfg.etAlMin) return nameOf(names[0]) + " " + cfg.etAl;
    if (names.length === 2) return nameOf(names[0]) + and + nameOf(names[1]);
    var list = names.map(nameOf);
    return list.slice(0, -1).join(", ") + and + list[list.length - 1];
  }

  function yearOf(item, noDate) {
    var d = item.issued;
    if (d && d["date-parts"] && d["date-parts"][0] && d["date-parts"][0][0]) return String(d["date-parts"][0][0]);
    if (d && d.literal) return d.literal;
    if (d && d.raw) { var m = /\d{4}/.exec(d.raw); if (m) return m[0]; }
    return noDate || "s.f.";
  }

  // ---------------------------------------------------------------------------
  // Numeración por orden de aparición y texto de cada cita
  // ---------------------------------------------------------------------------
  /**
   * citations: [{cid, ids:[key...], loc:{key:"p. 3"}, narrative:bool}] en orden del documento
   * Devuelve el orden de primera aparición.
   */
  function firstAppearanceOrder(citations, items) {
    var seen = {}, order = [];
    citations.forEach(function (c) {
      (c.ids || []).forEach(function (id) {
        if (!seen[id] && items[id]) { seen[id] = true; order.push(id); }
      });
    });
    return order;
  }

  function compressNumbers(nums, cfg) {
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    var uniq = sorted.filter(function (n, i) { return i === 0 || n !== sorted[i - 1]; });
    if (!cfg.compress) return uniq.map(String);
    var out = [], i = 0;
    while (i < uniq.length) {
      var j = i;
      while (j + 1 < uniq.length && uniq[j + 1] === uniq[j] + 1) j++;
      if (j - i >= 2) { out.push(uniq[i] + cfg.dash + uniq[j]); }
      else { for (var k = i; k <= j; k++) out.push(String(uniq[k])); }
      i = j + 1;
    }
    return out;
  }

  function enclose(text, cfg) {
    if (cfg.enclose === "brackets") return "[" + text + "]";
    if (cfg.enclose === "parens") return "(" + text + ")";
    return text;
  }

  /** Texto numérico de una lista de números con localizadores opcionales. */
  function numberRuns(entries, cfg) {
    // entries: [{n, loc}]
    var hasLoc = entries.some(function (e) { return e.loc; });
    var body;
    if (!hasLoc) {
      body = compressNumbers(entries.map(function (e) { return e.n; }), cfg).join(cfg.numSep);
    } else {
      var sorted = entries.slice().sort(function (a, b) { return a.n - b.n; });
      body = sorted.map(function (e) {
        if (!e.loc) return String(e.n);
        return cfg.sup ? e.n + "(" + e.loc + ")" : e.n + ", " + e.loc;
      }).join(cfg.sup ? cfg.numSep : "; ");
    }
    return [{ t: enclose(body, cfg), sup: !!cfg.sup }];
  }

  function renderCitation(cite, ctx) {
    var cfg = ctx.cfg, items = ctx.items;
    var ids = (cite.ids || []).filter(function (id) { return items[id]; });
    if (!ids.length) return [{ t: cfg.mode === "author-year" ? "(?)" : enclose("?", cfg), sup: !!cfg.sup && cfg.mode !== "author-year" }];
    var loc = cite.loc || {};
    var mode = cfg.mode;
    var narrative = !!cite.narrative;

    function ay(id) {
      return yearOf(items[id], ctx.noDate) + (ctx.suffix[id] || "");
    }

    if (mode === "number" && !narrative) {
      return numberRuns(ids.map(function (id) { return { n: ctx.numbers[id], loc: loc[id] }; }), cfg);
    }

    if (mode === "author-year") {
      if (narrative) {
        var parts = [];
        ids.forEach(function (id, i) {
          if (i > 0) parts.push({ t: cfg.multiSep, sup: false });
          var inner = ay(id) + (loc[id] ? ", " + loc[id] : "");
          parts.push({ t: authorLabel(items[id], cfg) + " " + enclose(inner, assign({}, cfg, { enclose: cfg.enclose === "none" ? "parens" : cfg.enclose })), sup: false });
        });
        return parts;
      }
      if (ids.length > 1 && cfg.sortMulti !== false) {
        ids = ids.slice().sort(function (a, b) {
          var la = authorLabel(items[a], cfg).toLowerCase(), lb = authorLabel(items[b], cfg).toLowerCase();
          return la < lb ? -1 : la > lb ? 1 : (ay(a) < ay(b) ? -1 : ay(a) > ay(b) ? 1 : 0);
        });
      }
      var body = ids.map(function (id) {
        return authorLabel(items[id], cfg) + cfg.ayInner + ay(id) + (loc[id] ? ", " + loc[id] : "");
      }).join(cfg.multiSep);
      return [{ t: enclose(body, cfg), sup: false }];
    }

    // "author-number" o cita narrativa en modo número: Autor [n]
    var runs = [];
    ids.forEach(function (id, i) {
      if (i > 0) runs.push({ t: cfg.multiSep, sup: false });
      var num = numberRuns([{ n: ctx.numbers[id], loc: loc[id] }], cfg)[0];
      runs.push({ t: authorLabel(items[id], cfg) + (cfg.sup ? "" : " "), sup: false });
      runs.push(num);
    });
    return mergeRuns(runs);
  }

  function mergeRuns(runs) {
    var out = [];
    runs.forEach(function (r) {
      if (!r.t) return;
      var last = out[out.length - 1];
      if (last && !!last.sup === !!r.sup) last.t += r.t;
      else out.push({ t: r.t, sup: !!r.sup });
    });
    return out;
  }

  function runsToText(runs) {
    return runs.map(function (r) { return r.t; }).join("");
  }

  /**
   * Calcula todo: numeración, sufijos de año y texto de cada cita.
   * bibOrder: orden de las entradas en la bibliografía (de citeproc); si falta, aparición.
   */
  function computeCitations(citations, items, cfg, bibOrder, suffix, noDate) {
    cfg = normalizeIntext(cfg);
    var order = bibOrder && bibOrder.length ? bibOrder : firstAppearanceOrder(citations, items);
    var numbers = {};
    order.forEach(function (id, i) { numbers[id] = i + 1; });
    var ctx = { cfg: cfg, items: items, numbers: numbers, suffix: suffix || {}, noDate: noDate };
    var rendered = citations.map(function (c) {
      var runs = renderCitation(c, ctx);
      return { cid: c.cid, runs: runs, text: runsToText(runs) };
    });
    return { order: order, numbers: numbers, citations: rendered };
  }

  function sameFmt(a, b) {
    return !!a.i === !!b.i && !!a.b === !!b.b && !!a.sup === !!b.sup && !!a.sub === !!b.sub && !!a.sc === !!b.sc;
  }

  function compactRuns(runs) {
    var out = [];
    runs.forEach(function (r) {
      if (!r.t) return;
      var last = out[out.length - 1];
      if (last && sameFmt(last, r)) last.t += r.t; else out.push(assign({}, r));
    });
    if (out.length) {
      out[0].t = out[0].t.replace(/^\s+/, "");
      out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, "");
    }
    return out.filter(function (r) { return r.t; });
  }

  /**
   * Prepara los párrafos finales de la bibliografía.
   * forceNumbers: añadir "n." delante si el estilo no numera pero las citas son numéricas.
   */
  function bibliographyParagraphs(bib, forceNumbers) {
    var p = bib.params || {};
    var numbered = !!p["second-field-align"];
    var paras = bib.entries.map(function (e, i) {
      var label = e.label && e.label.length ? e.label.map(function (r) { return r.t; }).join("").trim() : "";
      if (!numbered && forceNumbers) label = (i + 1) + ".";
      return { id: e.id, label: label, body: e.body };
    });
    var layout = (numbered || forceNumbers) ? "label" : (p.hangingindent ? "hanging" : "plain");
    var maxLabel = paras.reduce(function (m, x) { return Math.max(m, x.label.length); }, 0);
    return { layout: layout, paragraphs: paras, labelWidth: maxLabel };
  }

  // ---------------------------------------------------------------------------
  // OOXML
  // ---------------------------------------------------------------------------
  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function runXml(r) {
    var rpr = "";
    if (r.b) rpr += "<w:b/>";
    if (r.i) rpr += "<w:i/>";
    if (r.sc) rpr += "<w:smallCaps/>";
    if (r.sup) rpr += "<w:vertAlign w:val=\"superscript\"/>";
    else if (r.sub) rpr += "<w:vertAlign w:val=\"subscript\"/>";
    if (!rpr && r.plain) rpr = "<w:i w:val=\"0\"/><w:b w:val=\"0\"/>";
    return "<w:r>" + (rpr ? "<w:rPr>" + rpr + "</w:rPr>" : "") +
      "<w:t xml:space=\"preserve\">" + xmlEsc(r.t) + "</w:t></w:r>";
  }

  function bibliographyBodyXml(layoutInfo, emptyText) {
    var paras = layoutInfo.paragraphs;
    if (!paras.length) {
      return "<w:p>" + runXml({ t: emptyText || "La bibliografía aparecerá aquí cuando insertes citas.", i: true }) + "</w:p>";
    }
    var ind = "";
    if (layoutInfo.layout === "label") {
      var w = layoutInfo.labelWidth >= 4 ? 680 : layoutInfo.labelWidth >= 3 ? 567 : 454;
      ind = "<w:tabs><w:tab w:val=\"left\" w:pos=\"" + w + "\"/></w:tabs><w:ind w:left=\"" + w + "\" w:hanging=\"" + w + "\"/>";
    } else if (layoutInfo.layout === "hanging") {
      ind = "<w:ind w:left=\"720\" w:hanging=\"720\"/>";
    }
    return paras.map(function (p) {
      var x = "<w:p>" + (ind ? "<w:pPr>" + ind + "</w:pPr>" : "");
      if (layoutInfo.layout === "label") {
        x += runXml({ t: p.label }) + "<w:r><w:tab/></w:r>";
      }
      p.body.forEach(function (r) { x += runXml(r); });
      return x + "</w:p>";
    }).join("");
  }

  function wrapOoxml(bodyXml) {
    return "<pkg:package xmlns:pkg=\"http://schemas.microsoft.com/office/2006/xmlPackage\">" +
      "<pkg:part pkg:name=\"/_rels/.rels\" pkg:contentType=\"application/vnd.openxmlformats-package.relationships+xml\"><pkg:xmlData>" +
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
      "</Relationships></pkg:xmlData></pkg:part>" +
      "<pkg:part pkg:name=\"/word/document.xml\" pkg:contentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"><pkg:xmlData>" +
      "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" + bodyXml +
      "</w:body></w:document></pkg:xmlData></pkg:part></pkg:package>";
  }

  /** Texto plano de la bibliografía (para previsualizar en el panel). */
  function bibliographyPlain(layoutInfo) {
    return layoutInfo.paragraphs.map(function (p) {
      return (p.label ? p.label + " " : "") + p.body.map(function (r) { return r.t; }).join("");
    });
  }

  var api = {
    DEFAULT_INTEXT: DEFAULT_INTEXT,
    PRESETS: PRESETS,
    normalizeIntext: normalizeIntext,
    matchPreset: matchPreset,
    authorLabel: authorLabel,
    yearOf: yearOf,
    firstAppearanceOrder: firstAppearanceOrder,
    compressNumbers: compressNumbers,
    renderCitation: renderCitation,
    runsToText: runsToText,
    computeCitations: computeCitations,
    bibliographyParagraphs: bibliographyParagraphs,
    bibliographyBodyXml: bibliographyBodyXml,
    bibliographyPlain: bibliographyPlain,
    wrapOoxml: wrapOoxml,
    xmlEsc: xmlEsc
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CitadorEngine = api;
})(typeof window !== "undefined" ? window : this);
