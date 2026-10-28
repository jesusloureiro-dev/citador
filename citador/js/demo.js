/*
 * Citador — modo de prueba en el navegador (taskpane.html?demo=1).
 * Simula un documento de Word para probar el panel sin instalar nada.
 */
(function (root) {
  "use strict";
  var W = root.CitadorWord;
  var docEl, lastRange = null;

  function setup() {
    document.body.classList.add("demo");
    docEl = document.createElement("article");
    docEl.className = "demo-doc";
    docEl.contentEditable = "true";
    docEl.spellcheck = false;
    docEl.innerHTML =
      "<p class='demo-hint'>Documento de prueba: haz clic donde quieras citar y usa el panel.</p>" +
      "<h1>Introducción</h1>" +
      "<p>La hipertensión arterial sigue siendo el principal factor de riesgo cardiovascular modificable. " +
      "Las combinaciones a dosis bajas de cuatro fármacos han mostrado reducciones de la presión arterial mayores que la monoterapia.</p>" +
      "<p>En pacientes con insuficiencia cardiaca, los inhibidores del SGLT2 reducen las hospitalizaciones.</p><p><br></p>";
    document.body.appendChild(docEl);
    document.addEventListener("selectionchange", function () {
      var s = window.getSelection();
      if (s.rangeCount && docEl.contains(s.anchorNode)) {
        lastRange = s.getRangeAt(0).cloneRange();
        if (selCb) selCb();
      }
    });
  }

  var selCb = null;

  function ccs() { return Array.prototype.slice.call(docEl.querySelectorAll("[data-tag]")); }

  function currentCc() {
    if (!lastRange) return null;
    var n = lastRange.startContainer;
    while (n && n !== docEl) {
      if (n.nodeType === 1 && n.dataset && n.dataset.tag) return n;
      n = n.parentNode;
    }
    return null;
  }

  function runsHtml(runs) {
    return runs.map(function (r) {
      var t = String(r.t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      if (r.i) t = "<i>" + t + "</i>";
      if (r.b) t = "<b>" + t + "</b>";
      if (r.sc) t = "<span style='font-variant:small-caps'>" + t + "</span>";
      if (r.sup) t = "<sup>" + t + "</sup>";
      return t;
    }).join("");
  }

  var adapter = {
    name: "demo",
    refresh: function (compute) {
      var list = ccs();
      var cits = [], bibs = [];
      list.forEach(function (el) {
        var p = W.parseTag(el.dataset.tag);
        if (p) cits.push({ el: el, cid: p.cid, tagIds: p.ids, text: el.textContent });
        else if (el.dataset.tag === W.TAG_BIB) bibs.push(el);
      });
      return Promise.resolve(compute(cits.map(function (c) { return { cid: c.cid, tagIds: c.tagIds, text: c.text }; }), bibs.length > 0))
        .then(function (out) {
          var by = {};
          out.citations.forEach(function (c) { by[c.cid] = c; });
          cits.forEach(function (c) {
            var r = by[c.cid]; if (!r) return;
            c.el.dataset.tag = W.citationTag(c.cid, r.ids);
            c.el.innerHTML = runsHtml(r.runs);
          });
          bibs.forEach(function (b) {
            var L = out.bibLayout;
            if (!L || !L.paragraphs.length) { b.innerHTML = "<p><i>La bibliografía aparecerá aquí cuando insertes citas.</i></p>"; return; }
            b.innerHTML = L.paragraphs.map(function (p) {
              var cls = L.layout === "label" ? "lbl" : L.layout === "hanging" ? "hang" : "";
              return "<p class='" + cls + "'>" + (L.layout === "label" ? "<span class='n'>" + p.label + "</span>" : "") + "<span>" + runsHtml(p.body) + "</span></p>";
            }).join("");
          });
          return { citations: cits.length, bibliographies: bibs.length };
        });
    },
    insertCitation: function (cid, ids, placeholder) {
      var cur = currentCc();
      if (cur) {
        var p = W.parseTag(cur.dataset.tag);
        if (p) return Promise.resolve({ mergeInto: p.cid });
        return Promise.reject(new Error("El cursor está dentro de la bibliografía. Colócalo en el texto."));
      }
      var span = document.createElement("span");
      span.className = "cc";
      span.contentEditable = "false";
      span.dataset.tag = W.citationTag(cid, ids);
      span.textContent = placeholder || "[…]";
      if (lastRange && docEl.contains(lastRange.startContainer)) {
        var r = lastRange.cloneRange();
        r.collapse(false);
        r.insertNode(span);
      } else {
        docEl.querySelector("p:last-of-type").appendChild(span);
      }
      var after = document.createRange();
      after.setStartAfter(span); after.collapse(true);
      lastRange = after;
      return Promise.resolve({ inserted: true });
    },
    insertBibliography: function (heading) {
      if (docEl.querySelector("[data-tag='" + W.TAG_BIB + "']")) return Promise.resolve("exists");
      if (heading) { var h = document.createElement("h1"); h.textContent = heading; docEl.appendChild(h); }
      var d = document.createElement("div");
      d.className = "cc cc-bib";
      d.contentEditable = "false";
      d.dataset.tag = W.TAG_BIB;
      docEl.appendChild(d);
      return Promise.resolve("inserted");
    },
    getSelectedCitation: function () {
      var cur = currentCc();
      var p = cur ? W.parseTag(cur.dataset.tag) : null;
      return Promise.resolve(p ? p.cid : null);
    },
    deleteCitation: function (cid) {
      ccs().forEach(function (el) { var p = W.parseTag(el.dataset.tag); if (p && p.cid === cid) el.remove(); });
      lastRange = null;
      return Promise.resolve();
    },
    selectCitation: function () { return Promise.resolve(); },
    removeCodes: function () {
      var n = 0;
      ccs().forEach(function (el) {
        var frag = document.createDocumentFragment();
        while (el.firstChild) frag.appendChild(el.firstChild);
        el.parentNode.replaceChild(frag, el); n++;
      });
      return Promise.resolve(n);
    },
    onSelectionChange: function (cb) { selCb = cb; },
    // para las pruebas automáticas
    _select: function (el) {
      var r = document.createRange();
      r.selectNodeContents(el); r.collapse(false);
      lastRange = r;
      if (selCb) selCb();
    },
    _docEl: function () { return docEl; }
  };

  root.CitadorDemo = { setup: setup, adapter: adapter };
})(window);
