/*
 * Citador — detector de estilos.
 * A partir de unas referencias de ejemplo (y de sus datos reales, obtenidos de la
 * biblioteca o de Crossref) deduce el formato de la bibliografía. También deduce
 * el formato de las citas en el texto a partir de un ejemplo escrito.
 */
(function (root) {
  "use strict";

  var B = root.CitadorBib || (typeof require !== "undefined" ? require("./bib.js") : null);

  // ---------------------------------------------------------------------------
  // Normalización con mapa de posiciones
  // ---------------------------------------------------------------------------
  function normMap(s) {
    var out = "", map = [], lastSpace = true;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      if (/^[a-z0-9]+$/.test(base)) {
        for (var k = 0; k < base.length; k++) { out += base.charAt(k); map.push(i); }
        lastSpace = false;
      } else if (/[ßæøœł]/.test(ch)) {
        out += ch; map.push(i); lastSpace = false;
      } else if (!lastSpace) {
        out += " "; map.push(i); lastSpace = true;
      }
    }
    return { n: out, map: map };
  }

  function norm(s) { return normMap(String(s || "")).n.trim(); }

  /** Busca `needle` (texto libre) dentro de `text` ignorando mayúsculas, acentos y puntuación. */
  function findLoose(text, needle, from) {
    var nm = normMap(text), nn = norm(needle);
    if (!nn) return null;
    var startN = 0;
    if (from) { while (startN < nm.map.length && nm.map[startN] < from) startN++; }
    var idx = nm.n.indexOf(nn, startN);
    while (idx >= 0) {
      var before = idx === 0 || nm.n.charAt(idx - 1) === " ";
      var afterI = idx + nn.length;
      var after = afterI >= nm.n.length || nm.n.charAt(afterI) === " ";
      if (before && after) {
        var start = nm.map[idx], end = nm.map[afterI - 1] + 1;
        // incluir el punto final de abreviaturas (p. ej. "Med.")
        return { start: start, end: end };
      }
      idx = nm.n.indexOf(nn, idx + 1);
    }
    return null;
  }

  /** Localiza el título aunque esté algo recortado o con distinta puntuación. */
  function findTitle(text, title) {
    var toks = norm(title).split(" ").filter(Boolean);
    if (!toks.length) return null;
    var minK = Math.max(3, Math.ceil(toks.length * 0.6));
    for (var k = toks.length; k >= Math.min(minK, toks.length); k--) {
      var r = findLoose(text, toks.slice(0, k).join(" "));
      if (r) return r;
    }
    return null;
  }

  function tokenRegexFind(text, value, from, claimed) {
    if (!value) return null;
    var esc = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("(^|[^A-Za-z0-9])(" + esc + ")(?![A-Za-z0-9])", "g");
    re.lastIndex = from || 0;
    var m;
    while ((m = re.exec(text))) {
      var s = m.index + m[1].length, e = s + m[2].length;
      if (!overlaps(s, e, claimed)) return { start: s, end: e };
      re.lastIndex = m.index + 1;
    }
    return null;
  }

  function overlaps(s, e, claimed) {
    return (claimed || []).some(function (c) { return s < c.end && e > c.start; });
  }

  function vote(map, key) { if (key == null) return; map[key] = (map[key] || 0) + 1; }
  function winner(map, dflt) {
    var best = dflt, n = -1;
    Object.keys(map).forEach(function (k) { if (map[k] > n) { n = map[k]; best = k; } });
    return best;
  }

  // ---------------------------------------------------------------------------
  // Ejemplos: separar, quitar numeración
  // ---------------------------------------------------------------------------
  function stripLabel(text) {
    var m = /^\s*(\[(\d{1,3})\]|\((\d{1,3})\)|(\d{1,3})(\.|\))?)[\s \t]+(?=\S)/.exec(text);
    if (!m) return { text: text.trim(), label: null, offset: 0 };
    var raw = m[1], label;
    if (m[2]) label = "[{n}]"; else if (m[3]) label = "({n})"; else label = "{n}" + (m[5] || "");
    // evitar confundir un año al principio con un número
    if (m[4] && m[4].length > 3) return { text: text.trim(), label: null, offset: 0 };
    void raw;
    return { text: text.slice(m[0].length).trim(), label: label, offset: m[0].length };
  }

  /** Divide un texto pegado en referencias (una por línea; une líneas partidas). */
  function splitExamples(text) {
    var lines = String(text || "").replace(/\r/g, "").split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    var out = [];
    lines.forEach(function (l) {
      if (out.length && !/^(\[?\(?\d{1,3}[\].)]?\s)/.test(l) && /^[a-z]/.test(l)) out[out.length - 1] += " " + l;
      else out.push(l);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Autores
  // ---------------------------------------------------------------------------
  var NAME_FORMATS = (function () {
    var list = [];
    ["family-initials", "family-given", "initials-family", "given-family"].forEach(function (form) {
      [", ", " "].forEach(function (sortSep) {
        if (form.indexOf("family-") !== 0 && sortSep !== ", ") return;
        [true, false].forEach(function (initPeriod) {
          [true, false].forEach(function (initSpace) {
            if (/given/.test(form) && (!initPeriod || !initSpace)) return;
            [false, true].forEach(function (upper) {
              list.push({ form: form, sortSep: sortSep, initPeriod: initPeriod, initSpace: initSpace, upper: upper });
            });
          });
        });
      });
    });
    return list;
  })();

  function eqLoose(a, b) { return a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase(); }

  function startsLoose(text, pos, s) { return eqLoose(text.substr(pos, s.length), s); }

  function findNameNear(block, pos, s, maxGap) {
    for (var g = 0; g <= maxGap && pos + g <= block.length; g++) {
      if (startsLoose(block, pos + g, s)) return pos + g;
    }
    return -1;
  }

  function parseAuthors(block, authors) {
    var best = null;
    NAME_FORMATS.forEach(function (fmt) {
      if (!authors || !authors.length) return;
      var pos = 0, delims = [], count = 0, lastName = "";
      for (var i = 0; i < authors.length; i++) {
        var r = B.formatName(authors[i], fmt);
        if (!r) break;
        var at = i === 0 ? (startsLoose(block, 0, r) ? 0 : -1) : findNameNear(block, pos, r, 8);
        if (at < 0) break;
        if (i > 0) delims.push(block.slice(pos, at));
        pos = at + r.length; count++; lastName = r;
      }
      var score = count * 100 + (fmt.upper ? 0 : 1);
      if (count && (!best || score > best.score)) best = { score: score, fmt: fmt, count: count, delims: delims, pos: pos, lastName: lastName };
    });
    if (!best) return null;
    var rest = block.slice(best.pos);
    var etal = /^(\s*[,;]?\s*(?:et\.?\s*al\.?|y\s+cols?\.?|y\s+otros|and\s+others|\.\.\.|…))/i.exec(rest);
    var etAlText = null, sep;
    if (etal) { etAlText = etal[1]; sep = rest.slice(etal[1].length); }
    else sep = rest;
    var tail = etAlText != null ? etAlText : best.lastName;
    if (/\.$/.test(tail) && !/^\./.test(sep)) sep = "." + sep;
    return {
      fmt: best.fmt, shown: best.count, total: authors.length, delims: best.delims,
      etAl: etAlText, sepToTitle: sep, end: best.pos + (etAlText ? etAlText.length : 0),
      endsWithPeriod: /\.$/.test(tail)
    };
  }

  // ---------------------------------------------------------------------------
  // Resto de campos tras el título
  // ---------------------------------------------------------------------------
  function pageVariants(page) {
    var m = /^\s*([A-Za-z]?\d+[A-Za-z]?)\s*[-–—]+\s*([A-Za-z]?\d+[A-Za-z]?)\s*$/.exec(String(page || ""));
    if (!m) return page ? [{ v: String(page), fmt: "full", dash: "-" }] : [];
    var a = m[1], b = m[2];
    if (/^\d+$/.test(a) && /^\d+$/.test(b) && b.length < a.length) b = a.slice(0, a.length - b.length) + b;
    var out = [];
    ["-", "–", "—"].forEach(function (d) {
      out.push({ v: a + d + b, fmt: "full", dash: d });
      var mn = B.pagesValue(a + "-" + b, { pageFormat: "minimal", pageDash: d });
      if (mn !== a + d + b) out.push({ v: mn, fmt: "minimal", dash: d });
    });
    out.push({ v: a, fmt: "first", dash: "-" });
    return out;
  }

  var MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  function locateFields(text, from, item, claimedInit) {
    var claimed = (claimedInit || []).slice(), found = [], info = {};
    function looseFree(needle) {
      var pos = from;
      while (true) {
        var r = findLoose(text, needle, pos);
        if (!r) return null;
        if (!overlaps(r.start, r.end, claimed)) return r;
        pos = r.start + 1;
      }
    }
    function claim(f, r, extra) { if (!r) return false; claimed.push(r); found.push({ f: f, start: r.start, end: r.end }); if (extra) info[f] = extra; return true; }

    // revista o libro contenedor
    var isArticle = /article/.test(item.type || "article-journal");
    var full = item["container-title"], short = item["container-title-short"];
    var jr = null, jform = null;
    if (short) { jr = looseFree(short); if (jr) jform = full && norm(full) !== norm(short) ? "short" : null; }
    if (!jr && full) { jr = looseFree(full); if (jr) jform = short && norm(full) !== norm(short) ? "full" : null; }
    if (jr) {
      claim(isArticle ? "journal" : "container", jr, { form: jform });
    }

    // DOI con su prefijo
    if (item.DOI) {
      var di = text.toLowerCase().indexOf(String(item.DOI).toLowerCase(), from);
      if (di >= 0 && overlaps(di, di + item.DOI.length, claimed)) di = -1;
      if (di >= 0) {
        var pm = /(https?:\/\/(?:dx\.)?doi\.org\/|doi:\s?|doi\s|DOI:\s?|DOI\s)$/i.exec(text.slice(Math.max(from, di - 20), di));
        var ps = pm ? di - pm[1].length : di;
        claim("doi", { start: ps, end: di + item.DOI.length }, { form: (pm ? pm[1] : "") + "{doi}" });
      }
    }
    if (item.URL) {
      var ui = text.indexOf(item.URL, from);
      if (ui >= 0 && !overlaps(ui, ui + item.URL.length, claimed)) claim("url", { start: ui, end: ui + item.URL.length });
    }
    if (item.PMID) {
      var pr = tokenRegexFind(text, item.PMID, from, claimed);
      if (pr) {
        var pp = /(PMID:?\s?)$/i.exec(text.slice(Math.max(from, pr.start - 8), pr.start));
        claim("pmid", { start: pp ? pr.start - pp[1].length : pr.start, end: pr.end }, { form: (pp ? pp[1] : "") + "{pmid}" });
      }
    }
    // páginas
    var pv = pageVariants(item.page);
    for (var i = 0; i < pv.length; i++) {
      var r = tokenRegexFind(text, pv[i].v, from, claimed);
      if (r) { claim("pages", r, { fmt: pv[i].fmt, dash: pv[i].dash }); break; }
    }
    // año (con mes y día si aparecen)
    var y = B.yearValue(item);
    if (y) {
      var yr = tokenRegexFind(text, y, from, claimed);
      if (!yr) {
        // año distinto en la edición impresa / en línea: aceptar ±1
        var alt = [String(+y + 1), String(+y - 1)];
        for (var a = 0; a < alt.length && !yr; a++) yr = tokenRegexFind(text, alt[a], from, claimed);
      }
      if (yr) {
        var dfmt = "year";
        var after = /^(\s([A-Z][a-z]{2})[a-z]*\.?)(\s(\d{1,2}))?/.exec(text.slice(yr.end));
        if (after && MON.indexOf(after[2].toLowerCase()) >= 0) {
          dfmt = after[4] ? "year-month-day" : "year-month";
          yr.end += after[1].length + (after[3] ? after[3].length : 0);
        }
        claim("year", yr, { dateFormat: dfmt });
      }
    }
    ["publisher", "place"].forEach(function (f) {
      var v = f === "publisher" ? item.publisher : item["publisher-place"];
      if (!v) return;
      var r = looseFree(v);
      if (r) claim(f, r);
    });
    if (item.edition) {
      var er = tokenRegexFind(text, String(item.edition), from, claimed);
      if (er) claim("edition", er);
    }
    var vr = tokenRegexFind(text, item.volume, from, claimed);
    if (vr) claim("volume", vr);
    var ir = tokenRegexFind(text, item.issue, vr ? vr.end : from, claimed) || tokenRegexFind(text, item.issue, from, claimed);
    if (ir) claim("issue", ir);

    found.sort(function (a, b) { return a.start - b.start; });
    return { found: found, info: info };
  }

  // ---------------------------------------------------------------------------
  // Análisis de un ejemplo
  // ---------------------------------------------------------------------------
  function italicShare(runs, start, end) {
    if (!runs || !runs.length) return { i: 0, b: 0 };
    var pos = 0, it = 0, bo = 0, tot = 0;
    runs.forEach(function (r) {
      var s = pos, e = pos + r.t.length;
      var a = Math.max(s, start), b = Math.min(e, end);
      if (b > a) { var n = text_nonspace(r.t.slice(a - s, b - s)); tot += n; if (r.i) it += n; if (r.b) bo += n; }
      pos = e;
    });
    return tot ? { i: it / tot, b: bo / tot } : { i: 0, b: 0 };
  }
  function text_nonspace(s) { return s.replace(/\s/g, "").length; }

  function analyzeExample(ex, item) {
    var lab = stripLabel(ex.text);
    var text = lab.text;
    var runs = ex.runs ? shiftRuns(ex.runs, lab.offset + (ex.text.length - ex.text.replace(/^\s+/, "").length) * 0) : null;
    var res = { text: text, label: lab.label, item: item, ok: false, notes: [] };
    var tr = findTitle(text, item.title || "");
    if (!tr) { res.notes.push("no encuentro el título"); return res; }
    // título exacto en el texto (hasta el final de la palabra)
    var tEnd = tr.end;
    var titleText = text.slice(tr.start, tEnd);
    res.titleText = titleText;
    var authorsBlock = text.slice(0, tr.start);
    var au = item.author && item.author.length ? parseAuthors(authorsBlock, item.author) : null;
    res.authors = au;
    var claimed = [{ start: tr.start, end: tEnd }];
    var spans = [];
    if (au && au.shown) { claimed.push({ start: 0, end: au.end }); spans.push({ f: "authors", start: 0, end: au.end }); }
    spans.push({ f: "title", start: tr.start, end: tEnd });
    var tail = locateFields(text, 0, item, claimed);
    spans = spans.concat(tail.found).sort(function (a, b) { return a.start - b.start; });
    var els = [], prevEnd = 0;
    spans.forEach(function (sp) {
      var pre = text.slice(prevEnd, sp.start);
      if (els.length && els[els.length - 1].f === "authors" && au && au.endsWithPeriod && !/^\./.test(pre)) pre = "." + pre;
      els.push({ f: sp.f, pre: pre, suf: "", start: sp.start, end: sp.end });
      prevEnd = sp.end;
    });
    var endStr = text.slice(prevEnd).replace(/\s+$/, "");
    // cierres de paréntesis, corchetes y comillas: pertenecen al campo que abren
    var PAIRS = { "(": ")", "[": "]", "'": "'", "\u2018": "\u2019", "\u201c": "\u201d", "\"": "\"", "\u00ab": "\u00bb" };
    els.forEach(function (e, i) {
      var op = e.pre.slice(-1);
      if (!PAIRS[op]) return;
      var cl = PAIRS[op];
      if (i + 1 < els.length) {
        if (els[i + 1].pre.charAt(0) === cl) { e.suf = cl; els[i + 1].pre = els[i + 1].pre.slice(1); }
      } else if (endStr.charAt(0) === cl) { e.suf = cl; endStr = endStr.slice(1); }
    });
    res.end = endStr;
    res.elements = els;
    res.info = tail.info;
    // cursiva / negrita
    if (runs) els.forEach(function (e) { var sh = italicShare(runs, e.start, e.end); e.i = sh.i > 0.6; e.b = sh.b > 0.6; });
    // mayúsculas del título
    var t = item.title || "";
    if (titleText === t) res.titleCase = "as-is";
    else if (titleText === B.sentenceCase(t)) res.titleCase = "sentence";
    else if (titleText === B.titleCase(t)) res.titleCase = "title";
    else res.titleCase = null;
    res.ok = true;
    return res;
  }

  function shiftRuns(runs, offset) {
    // quita los primeros `offset` caracteres (la numeración) y espacios iniciales
    var out = [], skip = offset, started = false;
    runs.forEach(function (r) {
      var t = r.t;
      if (skip > 0) { var cut = Math.min(skip, t.length); t = t.slice(cut); skip -= cut; }
      if (!started) { t = t.replace(/^\s+/, ""); if (t) started = true; }
      if (t) out.push({ t: t, i: r.i, b: r.b });
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Deducción del estilo completo
  // ---------------------------------------------------------------------------
  function mode(list) {
    var m = {};
    list.forEach(function (x) { vote(m, x); });
    return winner(m, list[0]);
  }

  function buildTemplate(analyses) {
    if (!analyses.length) return null;
    var base = analyses.slice().sort(function (a, b) { return b.elements.length - a.elements.length; })[0];
    var tpl = base.elements.map(function (e) { return { f: e.f, pre: e.pre, suf: e.suf || "", i: !!e.i, b: !!e.b }; });
    // completar con campos que solo aparecen en otros ejemplos
    analyses.forEach(function (an) {
      if (an === base) return;
      var fs = an.elements.map(function (e) { return e.f; });
      an.elements.forEach(function (e, idx) {
        if (tpl.some(function (t) { return t.f === e.f || t.alt === e.f; })) return;
        var prevF = idx > 0 ? fs[idx - 1] : null;
        var nextF = idx < fs.length - 1 ? fs[idx + 1] : null;
        var pi = -1;
        for (var k = 0; k < tpl.length; k++) if (tpl[k].f === prevF) pi = k;
        var slot = tpl[pi + 1];
        // ¿ocupa el hueco de un campo que este ejemplo no tiene? → alternativa
        if (slot && !hasValue(an.item, slot.f) && (nextF === (tpl[pi + 2] && tpl[pi + 2].f) || (!nextF && !tpl[pi + 2])) && !shownElsewhere(analyses, e.f)) {
          slot.alt = e.f;
          return;
        }
        tpl.splice(pi + 1, 0, { f: e.f, pre: e.pre, suf: e.suf || "", i: !!e.i, b: !!e.b });
      });
    });
    // separadores: el más frecuente para cada campo
    tpl.forEach(function (t) {
      var pres = [];
      analyses.forEach(function (an) {
        var es = an.elements;
        for (var i = 0; i < es.length; i++) {
          if (es[i].f !== t.f) continue;
          var prev = i > 0 ? es[i - 1].f : null;
          var tprev = null;
          for (var k = 0; k < tpl.length; k++) if (tpl[k] === t) { tprev = k > 0 ? tpl[k - 1].f : null; }
          if (prev === tprev) pres.push(es[i].pre);
        }
      });
      if (pres.length) t.pre = mode(pres);
    });
    return tpl;
  }

  function hasValue(item, f) {
    var map = { journal: "container-title", container: "container-title", year: "issued", volume: "volume", issue: "issue", pages: "page", doi: "DOI", pmid: "PMID", url: "URL", publisher: "publisher", place: "publisher-place", edition: "edition", authors: "author", title: "title" };
    var k = map[f] || f;
    var v = item[k];
    return !!(v && (!Array.isArray(v) || v.length));
  }

  function shownElsewhere(analyses, f) {
    // aparece en algún ejemplo en el que no sustituye a otro campo ausente
    var count = 0;
    analyses.forEach(function (an) { if (an.elements.some(function (e) { return e.f === f; })) count++; });
    return count > 1;
  }

  /**
   * pairs: [{text, runs?, item}] (item = datos CSL de la referencia, o null)
   * citation: configuración de citas en el texto (para decidir orden y numeración)
   * Devuelve {style, report}
   */
  function inferStyle(pairs, citation, name) {
    var analyses = [], labels = [], skipped = [];
    pairs.forEach(function (p, i) {
      if (!p.item) { skipped.push(i); var l0 = stripLabel(p.text).label; if (l0) labels.push(l0); return; }
      var an = analyzeExample(p, p.item);
      an.index = i;
      if (an.label) labels.push(an.label);
      if (an.ok) analyses.push(an); else skipped.push(i);
    });
    if (!analyses.length) return { style: null, report: { error: "No he podido analizar ninguno de los ejemplos.", skipped: skipped } };

    // nombres
    var nv = { fmt: {} }, delims = [], lasts = [], etals = [], seps = [];
    var maxNo = 0, firstEt = [], minTotalEt = Infinity;
    analyses.forEach(function (an) {
      var a = an.authors;
      if (!a) return;
      vote(nv.fmt, JSON.stringify(a.fmt));
      if (a.etAl != null) {
        etals.push(a.etAl); firstEt.push(a.shown); minTotalEt = Math.min(minTotalEt, a.total);
        a.delims.forEach(function (d) { delims.push(d); });
      } else if (a.shown === a.total) {
        maxNo = Math.max(maxNo, a.shown);
        a.delims.forEach(function (d, i) { if (i < a.delims.length - 1) delims.push(d); else if (a.delims.length) lasts.push(d); });
      }
      seps.push(a.sepToTitle);
    });
    var fmt = JSON.parse(winner(nv.fmt, JSON.stringify(B.DEFAULT_NAMES)));
    var delim = delims.length ? mode(delims) : (lasts.length ? mode(lasts) : ", ");
    var last = lasts.length ? mode(lasts) : delim;
    var names = {
      form: fmt.form, sortSep: fmt.sortSep, initPeriod: fmt.initPeriod, initSpace: fmt.initSpace, upper: fmt.upper,
      delim: delim, last: last, etAl: etals.length ? mode(etals) : ", et al.",
      first: firstEt.length ? parseInt(mode(firstEt), 10) : 0, max: 0
    };
    var notes = [];
    if (firstEt.length) {
      names.max = Math.max(maxNo, names.first);
      if (minTotalEt - 1 < names.max && maxNo < minTotalEt) names.max = minTotalEt - 1;
      if (maxNo >= minTotalEt) notes.push("Hay ejemplos con " + minTotalEt + " autores abreviados con «et al.» y otros con " + maxNo + " autores completos. He elegido mostrar todos hasta " + maxNo + "; revísalo si la revista dice otra cosa.");
      if (maxNo === 0) notes.push("Ningún ejemplo muestra todos los autores, así que he supuesto que se usa «et al.» a partir de " + (names.max + 1) + " autores.");
      else if (minTotalEt - 1 > maxNo) notes.push("Con " + maxNo + " autores se ponen todos y con " + minTotalEt + " ya se usa «et al.». He elegido el límite en " + maxNo + "; revísalo si la revista dice otra cosa.");
    } else {
      names.max = Math.max(20, maxNo); names.first = names.max;
      notes.push("Ningún ejemplo usa «et al.»: de momento se mostrarán todos los autores (hasta " + names.max + "). Si la revista lo limita, añade un ejemplo con muchos autores o ajústalo en el editor.");
    }

    // plantillas por tipo
    var byType = {};
    analyses.forEach(function (an) {
      var t = an.item.type === "article" || an.item.type === "review" ? "article-journal" : (an.item.type || "article-journal");
      (byType[t] = byType[t] || []).push(an);
    });
    var templates = {};
    Object.keys(byType).forEach(function (t) { templates[t] = buildTemplate(byType[t]); });

    // opciones
    var ov = { jf: {}, tc: {}, pf: {}, pd: {}, doi: {}, df: {}, end: {}, pmid: {} };
    analyses.forEach(function (an) {
      if (an.info.journal) vote(ov.jf, an.info.journal.form);
      vote(ov.tc, an.titleCase);
      if (an.info.pages && an.info.pages.fmt !== "first") { vote(ov.pf, an.info.pages.fmt); vote(ov.pd, an.info.pages.dash); }
      else if (an.info.pages) vote(ov.pf, "first");
      if (an.info.doi) vote(ov.doi, an.info.doi.form);
      if (an.info.pmid) vote(ov.pmid, an.info.pmid.form);
      if (an.info.year) vote(ov.df, an.info.year.dateFormat);
      vote(ov.end, an.end);
    });
    delete ov.jf["null"]; delete ov.tc["null"];
    var numeric = !citation || citation.mode !== "author-year";
    var label = labels.length ? mode(labels) : (numeric ? "{n}." : "");
    var options = {
      label: numeric ? label : "",
      hanging: !numeric,
      order: numeric ? "appearance" : "alphabetical",
      journalForm: winner(ov.jf, "as-is"),
      titleCase: winner(ov.tc, "as-is"),
      pageFormat: winner(ov.pf, "full"),
      pageDash: winner(ov.pd, "-"),
      doiForm: winner(ov.doi, "doi:{doi}"),
      pmidForm: winner(ov.pmid, "PMID: {pmid}"),
      dateFormat: winner(ov.df, "year"),
      end: winner(ov.end, "."),
      endAfterLink: true
    };
    if (Object.keys(ov.jf).length > 1) notes.push("Los ejemplos mezclan nombres de revista abreviados y completos; he elegido " + (options.journalForm === "short" ? "abreviados" : "completos") + ", con el completo cuando no hay abreviatura.");

    var style = B.completeStyle({
      id: "user-" + Date.now().toString(36),
      name: name || "Mi estilo",
      citation: citation || { mode: "number", enclose: "brackets", sup: false, compress: true, dash: "-", numSep: "," },
      names: names,
      options: options,
      templates: templates,
      createdFrom: "examples"
    });

    // comprobación: ¿reproduce los ejemplos?
    var checks = analyses.map(function (an) {
      var rendered = B.textOf(B.renderItem(an.item, style, {}));
      var a = rendered.replace(/\s+/g, " ").trim(), b = an.text.replace(/\s+/g, " ").trim();
      return { index: an.index, ok: a === b, rendered: rendered, original: an.text, type: an.item.type };
    });
    return {
      style: style,
      report: {
        analyzed: analyses.length, skipped: skipped, checks: checks,
        exact: checks.filter(function (c) { return c.ok; }).length,
        types: Object.keys(templates), notes: notes
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Descripción legible de un estilo
  // ---------------------------------------------------------------------------
  function describe(style) {
    var n = style.names, o = style.options, out = [];
    var sample = B.formatNames([{ family: "García", given: "Ana María" }, { family: "Smith", given: "John" }], assign({}, n, { max: 99 }));
    out.push("Autores como «" + sample + "»");
    if (n.max < 20) out.push("con más de " + n.max + " autores se muestran " + n.first + " y «" + n.etAl.trim() + "»");
    out.push(o.journalForm === "short" ? "revista abreviada" : o.journalForm === "full" ? "revista con el nombre completo" : "revista tal como está en tus datos");
    out.push(o.pageFormat === "minimal" ? "páginas abreviadas (1995-8)" : o.pageFormat === "first" ? "solo la primera página" : "páginas completas (" + "1995" + o.pageDash + "2008)");
    var art = (style.templates || {})["article-journal"] || [];
    var hasDoi = art.some(function (e) { return e.f === "doi" || e.alt === "doi"; });
    var altDoi = art.some(function (e) { return e.alt === "doi"; });
    out.push(altDoi ? "DOI solo cuando falta el volumen" : hasDoi ? "con DOI" : "sin DOI");
    out.push(o.order === "alphabetical" ? "orden alfabético" : "orden de aparición, numerada «" + (o.label || "").replace("{n}", "1") + "»");
    return out;
  }

  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) t[k] = s[k]; } return t; }

  // ---------------------------------------------------------------------------
  // Citas en el texto a partir de un ejemplo
  // ---------------------------------------------------------------------------
  var SUP = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁽": "(", "⁾": ")", "˒": ",", "‒": "-" };

  function parseIntext(sample, supFlag) {
    var s = String(sample || "").trim();
    if (!s) return null;
    var hasSup = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(s);
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁽⁾˒]/g, function (c) { return SUP[c]; });
    var cfg = {};
    var sup = hasSup || !!supFlag;
    if (/\d{4}/.test(s) && /[A-Za-zÀ-ÿ]{2,}/.test(s)) {
      cfg.mode = "author-year";
      cfg.enclose = /^\[/.test(s) ? "brackets" : /^\(/.test(s) ? "parens" : "none";
      var inner = s.replace(/^[\[(]|[\])]$/g, "");
      var m = /([A-Za-zÀ-ÿ.'’-]+)(,?\s)(\d{4}[a-z]?)/.exec(inner);
      cfg.ayInner = m ? m[2] : ", ";
      if (/;\s/.test(inner)) cfg.multiSep = "; ";
      else if (/\d{4}[a-z]?,\s[A-ZÀ-Ý]/.test(inner)) cfg.multiSep = ", ";
      var ea = /\b(et al\.?|y cols?\.?|y otros)/i.exec(inner);
      if (ea) cfg.etAl = ea[1];
      var andm = /[a-zà-ÿ]\s(&|y|and|e)\s[A-ZÀ-Ý]/.exec(inner);
      if (andm) cfg.and = andm[1] === "e" ? "y" : andm[1];
      cfg.sup = false;
      return cfg;
    }
    cfg.mode = /[A-Za-zÀ-ÿ]{2,}/.test(s.replace(/et al\.?/g, "")) ? "author-number" : "number";
    var num = s.replace(/^[^\[(\d]*/, "");
    cfg.enclose = /^\[/.test(num) ? "brackets" : /^\(/.test(num) ? "parens" : "none";
    cfg.sup = sup;
    var body = num.replace(/^[\[(]|[\])]$/g, "");
    if (/\d\s*[-–]\s*\d/.test(body)) {
      cfg.compress = true;
      cfg.dash = /–/.test(body) ? "–" : "-";
    } else if (/\d,\s?\d,\s?\d/.test(body)) cfg.compress = false;
    var sepm = /\d(,\s?)\d/.exec(body);
    if (sepm) cfg.numSep = sepm[1];
    return cfg;
  }

  // ---------------------------------------------------------------------------
  // Identificar ejemplos (biblioteca, DOI escrito, Crossref)
  // ---------------------------------------------------------------------------
  function matchLibrary(text, items) {
    var nt = " " + norm(text) + " ";
    var best = null;
    Object.keys(items || {}).forEach(function (k) {
      var t = norm(items[k].title);
      if (t.length < 12) return;
      if (nt.indexOf(" " + t + " ") >= 0 && (!best || t.length > best.len)) best = { key: k, len: t.length };
    });
    return best ? items[best.key] : null;
  }

  function titleCovered(text, title) {
    var nt = " " + norm(text) + " ";
    var toks = norm(title).split(" ").filter(function (w) { return w.length > 2; });
    if (!toks.length) return false;
    var hit = toks.filter(function (w) { return nt.indexOf(" " + w + " ") >= 0; }).length;
    return hit / toks.length >= 0.8;
  }

  function crossrefSearch(text) {
    var url = "https://api.crossref.org/works?rows=3&query.bibliographic=" + encodeURIComponent(text.slice(0, 600));
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        var list = (j.message && j.message.items) || [];
        for (var i = 0; i < list.length; i++) {
          var it = root.CitadorImport.crossrefToCSL(list[i]);
          if (it.title && titleCovered(text, it.title)) return it;
        }
        return null;
      });
  }

  /** Busca los datos de cada ejemplo. onProgress(i, estado). */
  function identify(texts, libraryItems, onProgress) {
    var results = [];
    return texts.reduce(function (p, raw, i) {
      return p.then(function () {
        var text = stripLabel(raw).text;
        var lib = matchLibrary(text, libraryItems);
        if (lib) { results[i] = { item: lib, source: "biblioteca" }; if (onProgress) onProgress(i, results[i]); return; }
        var doi = root.CitadorImport.normalizeDOI(text);
        var p2 = doi ? root.CitadorImport.fetchDOI(doi).then(function (it) { return it && titleCovered(text, it.title) ? it : null; }).catch(function () { return null; }) : Promise.resolve(null);
        return p2.then(function (it) {
          if (it) return { item: it, source: "DOI" };
          return crossrefSearch(text).then(function (c) { return c ? { item: c, source: "Crossref" } : { item: null, source: null }; })
            .catch(function (e) { return { item: null, source: null, error: e }; });
        }).then(function (r) { results[i] = r; if (onProgress) onProgress(i, r); });
      });
    }, Promise.resolve()).then(function () { return results; });
  }

  var api = {
    normMap: normMap, norm: norm, findLoose: findLoose, findTitle: findTitle,
    stripLabel: stripLabel, splitExamples: splitExamples, parseAuthors: parseAuthors,
    analyzeExample: analyzeExample, inferStyle: inferStyle, describe: describe,
    parseIntext: parseIntext, matchLibrary: matchLibrary, identify: identify, titleCovered: titleCovered
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CitadorDetect = api;
})(typeof window !== "undefined" ? window : this);
