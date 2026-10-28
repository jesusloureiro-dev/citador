/*
 * Citador — importación de referencias.
 * PubMed (PMID y búsqueda), DOI (Crossref / DataCite), RIS, MEDLINE/.nbib,
 * BibTeX, CSL-JSON, y exportación a RIS / CSL-JSON.
 * Todas las referencias se guardan en formato CSL-JSON.
 */
(function (root) {
  "use strict";

  var EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  function clean(s) {
    if (s == null) return "";
    return String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  function stripFinalPeriod(s) {
    s = clean(s);
    return /[^.]\.$/.test(s) && !/\b[A-Z]\.$/.test(s) ? s.slice(0, -1) : s;
  }

  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e.charAt(0) === "#") {
        var c = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(c) ? m : String.fromCodePoint(c);
      }
      return ENT[e.toLowerCase()] || m;
    });
  }

  var MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    ene: 1, abr: 4, ago: 8, dic: 12, spring: 13, summer: 14, fall: 15, autumn: 15, winter: 16
  };

  /** "2019 Nov 7", "2019/11/07", "2019-11", "2019 Nov-Dec", "2019" -> {date-parts} */
  function parseDate(s) {
    s = clean(s);
    if (!s) return null;
    var m = /^(\d{4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?/.exec(s);
    if (m) {
      var parts = [parseInt(m[1], 10)];
      if (m[2] && parseInt(m[2], 10)) parts.push(parseInt(m[2], 10));
      if (m[3] && parseInt(m[3], 10)) parts.push(parseInt(m[3], 10));
      return { "date-parts": [parts] };
    }
    m = /(\d{4})(?:\s+([A-Za-z]{3,}))?(?:\s+(\d{1,2}))?/.exec(s);
    if (m) {
      var p = [parseInt(m[1], 10)];
      if (m[2]) {
        var mo = MONTHS[m[2].slice(0, 3).toLowerCase()] || MONTHS[m[2].toLowerCase()];
        if (mo && mo <= 12) { p.push(mo); if (m[3]) p.push(parseInt(m[3], 10)); }
        else if (mo) { return { "date-parts": [p], season: mo - 12 }; }
      }
      return { "date-parts": [p] };
    }
    return { literal: s };
  }

  var SMALL = /^(a|an|and|as|at|but|by|for|in|of|on|or|the|to|vs?|via|de|del|la|las|los|el|en|y|e|da|do|di|der|und|für|et|du|des|le|les)$/i;
  /** "The New England journal of medicine" -> "The New England Journal of Medicine" */
  function journalTitleCase(s) {
    s = clean(s);
    if (!s) return s;
    var words = s.split(" ");
    return words.map(function (w, i) {
      if (/[A-Z]/.test(w.slice(1)) || /\d/.test(w)) return w;      // siglas, mayúsculas internas
      if (i > 0 && SMALL.test(w.replace(/[^\wÀ-ÿ]/g, ""))) return w.toLowerCase();
      return w.replace(/^([("'\[]?)(\S)/, function (m, a, b) { return a + b.toUpperCase(); });
    }).join(" ");
  }

  /** Iniciales NLM "JJV" -> "J. J. V." */
  function expandInitials(s) {
    return s.split("").map(function (c) { return c + "."; }).join(" ");
  }

  /** Nombre de autor en cualquiera de los formatos habituales -> CSL */
  function parseName(raw) {
    var s = clean(raw).replace(/\s+,/g, ",");
    if (!s) return null;
    if (/^\{.*\}$/.test(s)) return { literal: s.slice(1, -1) };
    var comma = s.indexOf(",");
    if (comma > 0) {
      var fam = s.slice(0, comma).trim(), giv = s.slice(comma + 1).trim();
      if (/^(jr|sr|ii|iii|iv)\.?$/i.test(giv)) return { family: fam, suffix: giv };
      if (/^[A-Z]{1,4}$/.test(giv)) giv = expandInitials(giv);
      else if (/^([A-Z]\s+)+[A-Z]$/.test(giv)) giv = giv.split(/\s+/).map(function (c) { return c + "."; }).join(" ");
      return giv ? { family: fam, given: giv } : { family: fam };
    }
    var toks = s.split(/\s+/);
    if (toks.length === 1) return { family: s };
    var last = toks[toks.length - 1];
    if (/^[A-Z]{1,4}$/.test(last)) {                       // estilo PubMed: "Smith JA"
      return { family: toks.slice(0, -1).join(" "), given: expandInitials(last) };
    }
    // "John A. Smith" (incluye partículas: "Ludwig van Beethoven")
    var i = toks.length - 1;
    while (i > 1 && /^(van|von|de|del|der|da|di|la|le|du|dos|das)$/i.test(toks[i - 1])) i--;
    return { given: toks.slice(0, i).join(" "), family: toks.slice(i).join(" ") };
  }

  function looksCorporate(s) {
    return /\b(group|consortium|committee|collaborat|society|association|organization|organisation|investigators|working|council|network|study|trial|grupo|sociedad|comité|ministerio|who|cdc)\b/i.test(s);
  }

  function normalizeTitleKey(s) {
    return clean(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
  }

  function normalizeDOI(s) {
    if (!s) return "";
    var m = /10\.\d{4,9}\/[^\s"<>]+/i.exec(decodeURIComponent(String(s)));
    return m ? m[0].replace(/[.,;:)\]]+$/, "") : "";
  }

  // ---------------------------------------------------------------------------
  // Detección de identificadores pegados
  // ---------------------------------------------------------------------------
  function parseIdentifiers(text) {
    var res = { pmids: [], dois: [], other: [] };
    var seen = {};
    String(text || "").split(/[\s,;]+/).forEach(function (tok) {
      tok = tok.trim();
      if (!tok || /^(pmid|doi|pmcid|https?):?$/i.test(tok)) return;
      var doi = normalizeDOI(tok);
      if (doi) { if (!seen["d" + doi.toLowerCase()]) { seen["d" + doi.toLowerCase()] = 1; res.dois.push(doi); } return; }
      var pm = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/.exec(tok) || /^(?:PMID:?)?(\d{1,9})\.?$/i.exec(tok);
      if (pm) { if (!seen["p" + pm[1]]) { seen["p" + pm[1]] = 1; res.pmids.push(pm[1]); } return; }
      res.other.push(tok);
    });
    return res;
  }

  function looksLikeIdentifiers(text) {
    var r = parseIdentifiers(text);
    return (r.pmids.length + r.dois.length) > 0 && r.other.length === 0;
  }

  // ---------------------------------------------------------------------------
  // PubMed
  // ---------------------------------------------------------------------------
  function pubmedSummaryToCSL(s) {
    var item = { type: "article-journal" };
    var authors = [];
    (s.authors || []).forEach(function (a) {
      if (!a.name) return;
      if (a.authtype && a.authtype !== "Author" && a.authtype !== "CollectiveName") return;
      if (a.authtype === "CollectiveName" || looksCorporate(a.name) && !/\s[A-Z]{1,4}$/.test(a.name)) authors.push({ literal: a.name });
      else authors.push(parseName(a.name));
    });
    if (authors.length) item.author = authors;
    item.title = stripFinalPeriod(decodeEntities(s.title || s.booktitle || ""));
    if (s.fulljournalname) item["container-title"] = journalTitleCase(decodeEntities(s.fulljournalname));
    if (s.source) item["container-title-short"] = s.source;
    var d = parseDate(s.pubdate) || parseDate(s.epubdate);
    if (d) item.issued = d;
    if (s.volume) item.volume = s.volume;
    if (s.issue) item.issue = s.issue;
    if (s.pages) item.page = s.pages;
    if (s.issn || s.essn) item.ISSN = s.issn || s.essn;
    (s.articleids || []).forEach(function (a) {
      if (a.idtype === "doi") item.DOI = a.value;
      if (a.idtype === "pmc") item.PMCID = a.value;
    });
    if (!item.DOI && s.elocationid) { var dd = normalizeDOI(s.elocationid); if (dd) item.DOI = dd; }
    item.PMID = String(s.uid);
    if (s.doctype === "book" || s.doctype === "chapter") {
      item.type = s.doctype === "book" ? "book" : "chapter";
      if (s.booktitle && s.doctype === "chapter") item["container-title"] = s.booktitle;
      if (s.publishername) item.publisher = s.publishername;
      if (s.publisherlocation) item["publisher-place"] = s.publisherlocation;
    }
    if (s.lang && s.lang[0] && s.lang[0] !== "eng") item.language = s.lang[0];
    return item;
  }

  function fetchJSON(url, headers) {
    return fetch(url, { headers: headers || {} }).then(function (r) {
      if (!r.ok) {
        var e = new Error("HTTP " + r.status);
        e.status = r.status;
        throw e;
      }
      return r.json();
    });
  }

  function chunk(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  function fetchPubmed(pmids) {
    if (!pmids.length) return Promise.resolve({ items: [], missing: [] });
    var batches = chunk(pmids, 150), all = [], missing = [];
    return batches.reduce(function (p, b) {
      return p.then(function () {
        return fetchJSON(EUTILS + "esummary.fcgi?db=pubmed&retmode=json&tool=citador&id=" + b.join(","))
          .then(function (j) {
            var r = j.result || {};
            b.forEach(function (id) {
              var s = r[id];
              if (!s || s.error) missing.push(id); else all.push(pubmedSummaryToCSL(s));
            });
          });
      });
    }, Promise.resolve()).then(function () { return { items: all, missing: missing }; });
  }

  /** Búsqueda en PubMed: devuelve {count, items} */
  function searchPubmed(term, max) {
    var url = EUTILS + "esearch.fcgi?db=pubmed&retmode=json&tool=citador&sort=relevance&retmax=" + (max || 20) +
      "&term=" + encodeURIComponent(term);
    return fetchJSON(url).then(function (j) {
      var ids = (j.esearchresult && j.esearchresult.idlist) || [];
      var count = parseInt((j.esearchresult && j.esearchresult.count) || "0", 10);
      return fetchPubmed(ids).then(function (r) {
        // conservar el orden de relevancia
        var byId = {};
        r.items.forEach(function (it) { byId[it.PMID] = it; });
        return { count: count, items: ids.map(function (id) { return byId[id]; }).filter(Boolean) };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // DOI
  // ---------------------------------------------------------------------------
  var CROSSREF_TYPES = {
    "journal-article": "article-journal", "book-chapter": "chapter", "book-section": "chapter", "book-part": "chapter",
    "book": "book", "monograph": "book", "edited-book": "book", "reference-book": "book",
    "proceedings-article": "paper-conference", "posted-content": "article", "report": "report",
    "dissertation": "thesis", "dataset": "dataset", "standard": "standard", "reference-entry": "entry-encyclopedia"
  };

  function crossrefDate(m) {
    var d = m["published-print"] || m["journal-issue"] && m["journal-issue"]["published-print"] || m.issued || m["published-online"] || m.created;
    if (d && d["date-parts"] && d["date-parts"][0] && d["date-parts"][0][0]) return { "date-parts": [d["date-parts"][0].filter(function (x) { return x != null; })] };
    return null;
  }

  function crossrefToCSL(m) {
    var item = { type: CROSSREF_TYPES[m.type] || "article-journal" };
    function names(list) {
      return (list || []).map(function (a) {
        if (a.family) { var n = { family: a.family }; if (a.given) n.given = a.given; if (a.suffix) n.suffix = a.suffix; return n; }
        if (a.name) return { literal: a.name };
        return null;
      }).filter(Boolean);
    }
    var au = names(m.author); if (au.length) item.author = au;
    var ed = names(m.editor); if (ed.length) item.editor = ed;
    item.title = stripFinalPeriod(decodeEntities((m.title || [])[0] || ""));
    if (m.subtitle && m.subtitle[0] && item.type !== "article-journal") item.title += ": " + clean(m.subtitle[0]);
    var ct = (m["container-title"] || [])[0];
    if (ct) item["container-title"] = decodeEntities(clean(ct));
    var sct = (m["short-container-title"] || [])[0];
    if (sct) item["container-title-short"] = decodeEntities(clean(sct));
    var d = crossrefDate(m); if (d) item.issued = d;
    if (m.volume) item.volume = String(m.volume);
    if (m.issue) item.issue = String(m.issue);
    if (m.page) item.page = String(m.page);
    else if (m["article-number"]) item.page = String(m["article-number"]);
    if (m.publisher && item.type !== "article-journal") item.publisher = m.publisher;
    if (m["publisher-location"]) item["publisher-place"] = m["publisher-location"];
    if (m.ISBN && m.ISBN[0]) item.ISBN = m.ISBN[0];
    if (m.ISSN && m.ISSN[0]) item.ISSN = m.ISSN[0];
    if (m.edition) item.edition = String(m.edition);
    item.DOI = m.DOI;
    if (m.type === "posted-content") item.genre = "Preprint";
    return item;
  }

  function fetchDOI(doi) {
    var enc = encodeURIComponent(doi).replace(/%2F/g, "/");
    return fetchJSON("https://api.crossref.org/works/" + enc)
      .then(function (j) { return crossrefToCSL(j.message); })
      .catch(function (e) {
        // DOIs que no son de Crossref (DataCite: Zenodo, figshare, etc.)
        return fetchJSON("https://api.datacite.org/dois/" + enc, { Accept: "application/vnd.citationstyles.csl+json" })
          .then(function (j) {
            var it = j && j.type ? j : null;
            if (!it) throw e;
            delete it.id;
            it.DOI = doi;
            return it;
          });
      });
  }

  function fetchDOIs(dois) {
    var items = [], missing = [];
    return dois.reduce(function (p, d) {
      return p.then(function () {
        return fetchDOI(d).then(function (it) { items.push(it); }, function () { missing.push(d); });
      });
    }, Promise.resolve()).then(function () { return { items: items, missing: missing }; });
  }

  /** Importa todo lo que se haya pegado (PMID y DOI mezclados). */
  function fetchIdentifiers(text) {
    var ids = parseIdentifiers(text);
    return fetchPubmed(ids.pmids).then(function (pm) {
      return fetchDOIs(ids.dois).then(function (dr) {
        return { items: pm.items.concat(dr.items), missing: pm.missing.concat(dr.missing), other: ids.other };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // RIS
  // ---------------------------------------------------------------------------
  var RIS_TYPES = {
    JOUR: "article-journal", JFULL: "article-journal", ABST: "article-journal", EJOUR: "article-journal", INPR: "article-journal",
    BOOK: "book", EBOOK: "book", EDBOOK: "book", CHAP: "chapter", ECHAP: "chapter",
    CONF: "paper-conference", CPAPER: "paper-conference", RPRT: "report", GOVDOC: "report",
    THES: "thesis", ELEC: "webpage", WEB: "webpage", BLOG: "post-weblog", NEWS: "article-newspaper",
    MGZN: "article-magazine", DATA: "dataset", GEN: "article", STAND: "standard", PAT: "patent", LEGAL: "legislation", STAT: "legislation"
  };

  function parseRIS(text) {
    var items = [], rec = null, lastTag = null;
    String(text).replace(/\r/g, "").split("\n").forEach(function (line) {
      var m = /^([A-Z][A-Z0-9])  -(?: (.*))?$/.exec(line);
      if (!m) {
        if (rec && lastTag && line.trim()) rec[lastTag][rec[lastTag].length - 1] += " " + line.trim();
        return;
      }
      var tag = m[1], val = (m[2] || "").trim();
      if (tag === "TY") { rec = { TY: [val] }; lastTag = "TY"; return; }
      if (!rec) return;
      if (tag === "ER") { items.push(risRecordToCSL(rec)); rec = null; lastTag = null; return; }
      (rec[tag] = rec[tag] || []).push(val);
      lastTag = tag;
    });
    if (rec) items.push(risRecordToCSL(rec));
    return items;
  }

  function first(rec) {
    for (var i = 1; i < arguments.length; i++) if (rec[arguments[i]] && rec[arguments[i]][0]) return rec[arguments[i]][0];
    return "";
  }

  function risRecordToCSL(r) {
    var ty = (r.TY[0] || "JOUR").toUpperCase();
    var item = { type: RIS_TYPES[ty] || "article-journal" };
    var au = (r.AU || []).concat(r.A1 || []);
    if (au.length) item.author = au.map(function (a) { return looksCorporate(a) && a.indexOf(",") < 0 ? { literal: a } : parseName(a); }).filter(Boolean);
    var ed = (r.ED || []).concat(item.type === "chapter" ? (r.A2 || []) : []).concat(r.A3 && item.type === "book" ? [] : []);
    if (ed.length) item.editor = ed.map(parseName).filter(Boolean);
    item.title = stripFinalPeriod(first(r, "TI", "T1", "CT", "BT"));
    var cont = first(r, "T2", "JF", "JO", "BT");
    if (item.type === "book") cont = first(r, "T3");
    if (cont) item["container-title"] = cont;
    var abbr = first(r, "J2", "JA", "JO");
    if (abbr && abbr !== cont) item["container-title-short"] = abbr;
    var date = parseDate(first(r, "PY", "Y1", "DA"));
    if (date) item.issued = date;
    var v = first(r, "VL"); if (v) item.volume = v;
    var is = first(r, "IS", "CP"); if (is) item.issue = is;
    var sp = first(r, "SP"), ep = first(r, "EP");
    if (sp) item.page = ep && sp.indexOf("-") < 0 ? sp + "-" + ep : sp;
    var doi = normalizeDOI(first(r, "DO")) || normalizeDOI((r.UR || []).join(" ")) || normalizeDOI(first(r, "M3"));
    if (doi) item.DOI = doi;
    var url = (r.UR || []).filter(function (u) { return !/doi\.org|ncbi\.nlm\.nih\.gov\/pubmed|pubmed\.ncbi/.test(u); })[0];
    if (url) item.URL = url;
    var pub = first(r, "PB"); if (pub) item.publisher = pub;
    var cy = first(r, "CY"); if (cy) item["publisher-place"] = cy;
    var et = first(r, "ET"); if (et) item.edition = et;
    var sn = first(r, "SN");
    if (sn) { if (/^(97[89])?\d{9}[\dX]$/.test(sn.replace(/-/g, ""))) item.ISBN = sn; else item.ISSN = sn; }
    var ab = first(r, "AB", "N2"); if (ab) item.abstract = ab;
    var la = first(r, "LA"); if (la) item.language = la;
    // PMID en exportaciones de PubMed/EndNote
    var allText = (r.AN || []).concat(r.M1 || [], r.C1 || [], r.UR || []).join(" ");
    var pm = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)|PMID:?\s*(\d+)/i.exec(allText);
    if (pm) item.PMID = pm[1] || pm[2];
    else if (r.AN && /^\d{5,9}$/.test(r.AN[0]) && /pubmed|medline/i.exec(first(r, "DP", "DB"))) item.PMID = r.AN[0];
    var y2 = first(r, "Y2"); if (y2 && item.type === "webpage") item.accessed = parseDate(y2);
    return item;
  }

  // ---------------------------------------------------------------------------
  // MEDLINE / .nbib (exportación de PubMed)
  // ---------------------------------------------------------------------------
  function parseMedline(text) {
    var recs = [], rec = null, last = null;
    String(text).replace(/\r/g, "").split("\n").forEach(function (line) {
      var m = /^([A-Z0-9]{2,4})\s*- (.*)$/.exec(line);
      if (m) {
        var tag = m[1].trim();
        if (tag === "PMID") { rec = {}; recs.push(rec); }
        if (!rec) { rec = {}; recs.push(rec); }
        (rec[tag] = rec[tag] || []).push(m[2].trim());
        last = tag;
      } else if (/^\s{4,}\S/.test(line) && rec && last) {
        rec[last][rec[last].length - 1] += " " + line.trim();
      }
    });
    return recs.filter(function (r) { return r.TI || r.PMID; }).map(medlineToCSL);
  }

  function medlineToCSL(r) {
    var pt = (r.PT || []).join(" ").toLowerCase();
    var item = { type: /book/.test(pt) && !r.TA ? "book" : "article-journal" };
    var names = [];
    if (r.FAU) names = r.FAU.map(parseName);
    else if (r.AU) names = r.AU.map(parseName);
    (r.CN || []).forEach(function (c) { names.push({ literal: c }); });
    if (names.length) item.author = names.filter(Boolean);
    item.title = stripFinalPeriod(first(r, "TI", "BTI"));
    if (r.JT) item["container-title"] = journalTitleCase(r.JT[0]);
    if (r.TA) item["container-title-short"] = r.TA[0];
    var d = parseDate(first(r, "DP")); if (d) item.issued = d;
    if (r.VI) item.volume = r.VI[0];
    if (r.IP) item.issue = r.IP[0];
    if (r.PG) item.page = r.PG[0];
    var ids = (r.LID || []).concat(r.AID || []);
    ids.forEach(function (x) { if (/\[doi\]/.test(x) && !item.DOI) item.DOI = x.replace(/\s*\[doi\]/, "").trim(); });
    if (r.PMID) item.PMID = r.PMID[0];
    if (r.PMC) item.PMCID = r.PMC[0];
    if (r.IS) item.ISSN = r.IS[0].replace(/\s*\(.*\)/, "");
    if (r.AB) item.abstract = r.AB[0];
    if (r.PB) item.publisher = r.PB[0];
    return item;
  }

  // ---------------------------------------------------------------------------
  // BibTeX
  // ---------------------------------------------------------------------------
  var ACCENTS = { "'": "́", "`": "̀", "^": "̂", "\"": "̈", "~": "̃", "=": "̄", ".": "̇",
    "c": "̧", "u": "̆", "v": "̌", "H": "̋", "k": "̨", "r": "̊" };
  var SPECIAL = { ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "ı", j: "ȷ" };

  function latexToUnicode(s) {
    if (!s) return "";
    s = s.replace(/\\([`'^"~=.])\s*\{?\\?([A-Za-z])\}?/g, function (m, a, c) { return (c === "i" ? "i" : c) + ACCENTS[a]; });
    s = s.replace(/\\([cuvHkr])\s*\{\\?([A-Za-z])\}/g, function (m, a, c) { return c + ACCENTS[a]; });
    s = s.replace(/\\([cuvHkr])\s+([A-Za-z])/g, function (m, a, c) { return c + ACCENTS[a]; });
    s = s.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)\b\s*/g, function (m, a) { return SPECIAL[a]; });
    s = s.replace(/\\textit\{([^{}]*)\}|\\emph\{([^{}]*)\}|\\textbf\{([^{}]*)\}|\\textsc\{([^{}]*)\}/g, function (m, a, b, c, d) { return a || b || c || d || ""; });
    s = s.replace(/\\&/g, "&").replace(/\\%/g, "%").replace(/\\\$/g, "$").replace(/\\_/g, "_").replace(/\\#/g, "#");
    s = s.replace(/---/g, "—").replace(/--/g, "–").replace(/~/g, " ").replace(/\\,/g, " ");
    s = s.replace(/[{}]/g, "");
    return s.normalize("NFC").replace(/\s+/g, " ").trim();
  }

  var BIB_TYPES = {
    article: "article-journal", book: "book", booklet: "book", inbook: "chapter", incollection: "chapter",
    inproceedings: "paper-conference", conference: "paper-conference", proceedings: "book",
    phdthesis: "thesis", mastersthesis: "thesis", thesis: "thesis", techreport: "report", report: "report",
    manual: "report", unpublished: "manuscript", online: "webpage", electronic: "webpage", www: "webpage", misc: "article", dataset: "dataset"
  };

  function parseBibTeX(text) {
    var s = String(text), i = 0, out = [], strings = {};
    while (true) {
      var at = s.indexOf("@", i);
      if (at < 0) break;
      var m = /^@\s*([a-zA-Z]+)\s*([{(])/.exec(s.slice(at));
      if (!m) { i = at + 1; continue; }
      var type = m[1].toLowerCase(), open = m[2], close = open === "{" ? "}" : ")";
      var start = at + m[0].length, depth = 1, j = start;
      while (j < s.length && depth > 0) {
        var ch = s.charAt(j);
        if (ch === "{" || (open === "(" && ch === "(")) depth++;
        else if (ch === "}" || (open === "(" && ch === ")")) depth--;
        j++;
      }
      var content = s.slice(start, j - 1);
      i = j;
      if (type === "comment" || type === "preamble") continue;
      if (type === "string") {
        var sm = /^\s*([\w-]+)\s*=\s*([\s\S]*)$/.exec(content);
        if (sm) strings[sm[1].toLowerCase()] = bibValue(sm[2].trim(), strings);
        continue;
      }
      var comma = content.indexOf(",");
      var fieldsTxt = comma >= 0 ? content.slice(comma + 1) : "";
      var fields = bibFields(fieldsTxt, strings);
      out.push(bibToCSL(type, fields));
      void close;
    }
    return out;
  }

  function bibValue(v, strings) {
    // concatenaciones con #
    var parts = [], k = 0;
    while (k < v.length) {
      var c = v.charAt(k);
      if (c === "{") {
        var d = 1, st = k + 1; k++;
        while (k < v.length && d > 0) { if (v.charAt(k) === "{") d++; else if (v.charAt(k) === "}") d--; k++; }
        parts.push(v.slice(st, k - 1));
      } else if (c === "\"") {
        var st2 = k + 1, d2 = 0; k++;
        while (k < v.length && !(v.charAt(k) === "\"" && d2 === 0)) { if (v.charAt(k) === "{") d2++; else if (v.charAt(k) === "}") d2--; k++; }
        parts.push(v.slice(st2, k)); k++;
      } else if (/[\w-]/.test(c)) {
        var mm = /^[\w-]+/.exec(v.slice(k));
        var w = mm[0]; k += w.length;
        parts.push(strings[w.toLowerCase()] != null ? strings[w.toLowerCase()] : w);
      } else k++;
    }
    return parts.join("");
  }

  function bibFields(txt, strings) {
    var fields = {}, k = 0;
    while (k < txt.length) {
      var m = /^\s*,?\s*([\w:.-]+)\s*=\s*/.exec(txt.slice(k));
      if (!m) break;
      k += m[0].length;
      var name = m[1].toLowerCase(), st = k, depth = 0, inq = false;
      while (k < txt.length) {
        var ch = txt.charAt(k);
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === "\"" && depth === 0) inq = !inq;
        else if (ch === "," && depth === 0 && !inq) break;
        k++;
      }
      fields[name] = bibValue(txt.slice(st, k).trim(), strings);
    }
    return fields;
  }

  function bibNames(s) {
    return s.split(/\s+and\s+/i).map(function (n) {
      n = n.trim();
      if (/^\{.*\}$/.test(n)) return { literal: latexToUnicode(n) };
      if (n.toLowerCase() === "others") return null;
      return parseName(latexToUnicode(n));
    }).filter(Boolean);
  }

  function bibToCSL(type, f) {
    var item = { type: BIB_TYPES[type] || "article" };
    if (item.type === "article" && f.url && !f.journal) item.type = "webpage";
    if (f.author) item.author = bibNames(f.author);
    if (f.editor) item.editor = bibNames(f.editor);
    item.title = stripFinalPeriod(latexToUnicode(f.title || ""));
    var cont = f.journal || f.journaltitle || f.booktitle || f.series;
    if (cont) item["container-title"] = latexToUnicode(cont);
    if (f.shortjournal) item["container-title-short"] = latexToUnicode(f.shortjournal);
    var y = f.year || (f.date ? f.date.slice(0, 4) : "");
    if (y) {
      var parts = [parseInt(y, 10)];
      if (f.month) {
        var mo = parseInt(f.month, 10) || MONTHS[f.month.slice(0, 3).toLowerCase()];
        if (mo && mo <= 12) parts.push(mo);
      }
      item.issued = isNaN(parts[0]) ? { literal: y } : { "date-parts": [parts] };
      if (f.date && /^\d{4}-\d{2}/.test(f.date)) item.issued = parseDate(f.date);
    }
    if (f.volume) item.volume = latexToUnicode(f.volume);
    if (f.number || f.issue) item.issue = latexToUnicode(f.number || f.issue);
    if (f.pages) item.page = latexToUnicode(f.pages).replace(/–/g, "-");
    if (f.publisher) item.publisher = latexToUnicode(f.publisher);
    if (f.address || f.location) item["publisher-place"] = latexToUnicode(f.address || f.location);
    if (f.school || f.institution) item.publisher = latexToUnicode(f.school || f.institution);
    if (f.edition) item.edition = latexToUnicode(f.edition);
    if (f.doi) item.DOI = normalizeDOI(f.doi) || f.doi;
    if (f.url) item.URL = f.url;
    if (f.pmid) item.PMID = f.pmid;
    if (f.isbn) item.ISBN = f.isbn;
    if (f.issn) item.ISSN = f.issn;
    if (f.abstract) item.abstract = latexToUnicode(f.abstract);
    if (type === "phdthesis") item.genre = "PhD thesis";
    if (type === "mastersthesis") item.genre = "Master's thesis";
    if (f.urldate) item.accessed = parseDate(f.urldate);
    return item;
  }

  // ---------------------------------------------------------------------------
  // CSL-JSON
  // ---------------------------------------------------------------------------
  function parseCSLJSON(text) {
    var j = JSON.parse(text);
    if (!Array.isArray(j)) j = j.items || [j];
    return j.filter(function (x) { return x && typeof x === "object" && (x.title || x.author); }).map(function (x) {
      var it = JSON.parse(JSON.stringify(x));
      delete it.id;
      if (!it.type) it.type = "article-journal";
      return it;
    });
  }

  // ---------------------------------------------------------------------------
  // Detección del formato de un archivo
  // ---------------------------------------------------------------------------
  function detectFormat(text, filename) {
    var name = (filename || "").toLowerCase();
    var t = String(text).replace(/^﻿/, "").trim();
    if (/\.(json)$/.test(name) || /^[\[{]/.test(t)) return "csl-json";
    if (/\.(bib|bibtex)$/.test(name) || /^\s*@\w+\s*[{(]/m.test(t) && !/^TY  -/m.test(t)) return "bibtex";
    if (/^TY  -/m.test(t)) return "ris";
    if (/\.(nbib|medline|txt)$/.test(name) && /^PMID-/m.test(t) || /^PMID- /m.test(t)) return "medline";
    if (looksLikeIdentifiers(t)) return "ids";
    return null;
  }

  function parseFile(text, filename) {
    var fmt = detectFormat(text, filename);
    text = String(text).replace(/^﻿/, "");
    if (fmt === "csl-json") return { format: "CSL-JSON", items: parseCSLJSON(text) };
    if (fmt === "bibtex") return { format: "BibTeX", items: parseBibTeX(text) };
    if (fmt === "ris") return { format: "RIS", items: parseRIS(text) };
    if (fmt === "medline") return { format: "PubMed (MEDLINE)", items: parseMedline(text) };
    if (fmt === "ids") return { format: "ids", items: [], ids: text };
    throw new Error("No reconozco el formato del archivo. Usa RIS, BibTeX, PubMed (.nbib) o CSL-JSON.");
  }

  // ---------------------------------------------------------------------------
  // Exportación
  // ---------------------------------------------------------------------------
  var CSL_TO_RIS = {};
  Object.keys(RIS_TYPES).forEach(function (k) { if (!CSL_TO_RIS[RIS_TYPES[k]]) CSL_TO_RIS[RIS_TYPES[k]] = k; });

  function nameToString(n) {
    if (n.literal) return n.literal;
    return (n.family || "") + (n.given ? ", " + n.given : "");
  }

  function toRIS(items) {
    return items.map(function (it) {
      var L = [];
      function add(t, v) { if (v != null && v !== "") L.push(t + "  - " + v); }
      add("TY", CSL_TO_RIS[it.type] || "JOUR");
      (it.author || []).forEach(function (a) { add("AU", nameToString(a)); });
      (it.editor || []).forEach(function (a) { add("ED", nameToString(a)); });
      add("TI", it.title);
      add(it.type === "chapter" ? "BT" : "T2", it["container-title"]);
      add("J2", it["container-title-short"]);
      var y = it.issued && it.issued["date-parts"] && it.issued["date-parts"][0];
      if (y) add("PY", y[0]);
      if (y) add("DA", y.map(function (x, i) { return i ? ("0" + x).slice(-2) : x; }).join("/"));
      add("VL", it.volume); add("IS", it.issue);
      if (it.page) { var pp = String(it.page).split(/[-–]/); add("SP", pp[0]); add("EP", pp[1]); }
      add("PB", it.publisher); add("CY", it["publisher-place"]); add("ET", it.edition);
      add("SN", it.ISBN || it.ISSN); add("DO", it.DOI); add("UR", it.URL);
      if (it.PMID) add("AN", it.PMID);
      if (it.PMID) add("UR", "https://pubmed.ncbi.nlm.nih.gov/" + it.PMID + "/");
      add("AB", it.abstract); add("LA", it.language);
      L.push("ER  - ");
      return L.join("\r\n");
    }).join("\r\n\r\n") + "\r\n";
  }

  function toCSLJSON(items) {
    return JSON.stringify(items.map(function (it) {
      var c = {};
      Object.keys(it).forEach(function (k) { if (k.charAt(0) !== "_") c[k] = it[k]; });
      return c;
    }), null, 2);
  }

  // ---------------------------------------------------------------------------
  // Duplicados
  // ---------------------------------------------------------------------------
  function identityKeys(item) {
    var keys = [];
    if (item.DOI) keys.push("doi:" + String(item.DOI).toLowerCase());
    if (item.PMID) keys.push("pmid:" + item.PMID);
    var y = item.issued && item.issued["date-parts"] && item.issued["date-parts"][0] ? item.issued["date-parts"][0][0] : "";
    var tk = normalizeTitleKey(item.title);
    if (tk.length > 12) keys.push("t:" + tk + ":" + y);
    return keys;
  }

  var api = {
    parseIdentifiers: parseIdentifiers,
    looksLikeIdentifiers: looksLikeIdentifiers,
    parseName: parseName,
    parseDate: parseDate,
    journalTitleCase: journalTitleCase,
    pubmedSummaryToCSL: pubmedSummaryToCSL,
    crossrefToCSL: crossrefToCSL,
    fetchPubmed: fetchPubmed,
    searchPubmed: searchPubmed,
    fetchDOI: fetchDOI,
    fetchIdentifiers: fetchIdentifiers,
    parseRIS: parseRIS,
    parseMedline: parseMedline,
    parseBibTeX: parseBibTeX,
    latexToUnicode: latexToUnicode,
    parseCSLJSON: parseCSLJSON,
    detectFormat: detectFormat,
    parseFile: parseFile,
    toRIS: toRIS,
    toCSLJSON: toCSLJSON,
    identityKeys: identityKeys,
    normalizeDOI: normalizeDOI
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CitadorImport = api;
})(typeof window !== "undefined" ? window : this);
