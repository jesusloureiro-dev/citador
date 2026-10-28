/*
 * Citador — conexión con Word (Office.js).
 * Cada cita es un control de contenido con etiqueta "CITADOR:C:<id>[:claves]".
 * La bibliografía es un control de contenido con etiqueta "CITADOR:BIB".
 */
(function (root) {
  "use strict";

  var TAG_C = "CITADOR:C:";
  var TAG_BIB = "CITADOR:BIB";
  var MAX_TAG = 64;

  function citationTag(cid, ids) {
    var t = TAG_C + cid;
    var withKeys = t + ":" + (ids || []).join(",");
    return withKeys.length <= MAX_TAG ? withKeys : t;
  }

  function parseTag(tag) {
    if (!tag || tag.indexOf(TAG_C) !== 0) return null;
    var rest = tag.slice(TAG_C.length).split(":");
    return { cid: rest[0], ids: rest[1] ? rest[1].split(",").filter(Boolean) : [] };
  }

  function writeRuns(cc, runs) {
    var first = true;
    runs.forEach(function (r) {
      var range = cc.insertText(r.t, first ? "Replace" : "End");
      range.font.superscript = !!r.sup;
      first = false;
    });
    if (!runs.length) cc.insertText("?", "Replace");
  }

  var adapter = {
    name: "word",

    /** Recorre el documento, calcula y escribe todas las citas y la bibliografía. */
    refresh: function (compute) {
      return Word.run(function (ctx) {
        var all = ctx.document.contentControls;
        all.load("items/tag,items/text");
        return ctx.sync().then(function () {
          var cits = [], bibs = [];
          all.items.forEach(function (cc) {
            var p = parseTag(cc.tag);
            if (p) cits.push({ cc: cc, cid: p.cid, tagIds: p.ids, text: cc.text });
            else if (cc.tag === TAG_BIB) bibs.push(cc);
          });
          return Promise.resolve(compute(cits.map(function (c) {
            return { cid: c.cid, tagIds: c.tagIds, text: c.text };
          }), bibs.length > 0)).then(function (out) {
            var byCid = {};
            out.citations.forEach(function (c) { byCid[c.cid] = c; });
            var seen = {};
            cits.forEach(function (c) {
              var r = byCid[c.cid];
              if (!r) return;
              // una cita copiada y pegada dentro del mismo documento comparte id: se separa
              if (seen[c.cid] && out.duplicate) {
                var nc = out.duplicate(c.cid);
                c.cc.tag = citationTag(nc, r.ids);
              }
              seen[c.cid] = true;
              var tag = citationTag(c.cid, r.ids);
              if (c.cc.tag !== tag && !out.keepTags) c.cc.tag = tag;
              if (r.text !== c.text || r.force) writeRuns(c.cc, r.runs);
            });
            bibs.forEach(function (b) {
              b.cannotEdit = false;
              b.insertOoxml(out.bibOoxml, "Replace");
            });
            return ctx.sync().then(function () {
              return null;
            }).then(function () {
              return { citations: cits.length, bibliographies: bibs.length };
            });
          });
        });
      });
    },

    /** Inserta una cita nueva donde está el cursor. Si el cursor está dentro de una cita, devuelve su id. */
    insertCitation: function (cid, ids, placeholder) {
      return Word.run(function (ctx) {
        var sel = ctx.document.getSelection();
        var parent = sel.parentContentControlOrNullObject;
        parent.load("tag");
        var inner = sel.contentControls;
        inner.load("items/tag");
        return ctx.sync().then(function () {
          if (!parent.isNullObject) {
            var p = parseTag(parent.tag);
            if (p) return { mergeInto: p.cid };
            if (parent.tag === TAG_BIB) throw new Error("El cursor está dentro de la bibliografía. Colócalo en el texto.");
          }
          for (var i = 0; i < inner.items.length; i++) {
            var q = parseTag(inner.items[i].tag);
            if (q) return { mergeInto: q.cid };
          }
          var range = sel.insertText(placeholder || "[…]", "End");
          var cc = range.insertContentControl();
          cc.tag = citationTag(cid, ids);
          cc.title = "Cita";
          cc.appearance = "BoundingBox";
          cc.font.superscript = false;
          return ctx.sync().then(function () {
            // dejar el cursor detrás de la cita para seguir escribiendo
            cc.getRange("After").select("Start");
            return ctx.sync().catch(function () { /* no crítico */ });
          }).then(function () { return { inserted: true }; });
        });
      });
    },

    /** Inserta la bibliografía en el cursor (con título opcional). */
    insertBibliography: function (heading) {
      return Word.run(function (ctx) {
        var existing = ctx.document.contentControls.getByTag(TAG_BIB);
        existing.load("items");
        return ctx.sync().then(function () {
          if (existing.items.length) {
            existing.items[0].select("Start");
            return ctx.sync().then(function () { return "exists"; });
          }
          var sel = ctx.document.getSelection();
          var para = sel.paragraphs.getLast();
          para.load("text");
          return ctx.sync().then(function () {
            var target = para.text.trim() === "" ? para : para.insertParagraph("", "After");
            if (heading) {
              target.insertText(heading, "Start");
              target.styleBuiltIn = "Heading1";
              target = target.insertParagraph("", "After");
              target.styleBuiltIn = "Normal";
            }
            var cc = target.getRange("Whole").insertContentControl();
            cc.tag = TAG_BIB;
            cc.title = "Bibliografía";
            cc.appearance = "BoundingBox";
            return ctx.sync().then(function () { return "inserted"; });
          });
        });
      });
    },

    /** Id de la cita en la que está el cursor (o null). */
    getSelectedCitation: function () {
      return Word.run(function (ctx) {
        var sel = ctx.document.getSelection();
        var parent = sel.parentContentControlOrNullObject;
        parent.load("tag");
        var inner = sel.contentControls;
        inner.load("items/tag");
        return ctx.sync().then(function () {
          if (!parent.isNullObject) { var p = parseTag(parent.tag); if (p) return p.cid; }
          for (var i = 0; i < inner.items.length; i++) { var q = parseTag(inner.items[i].tag); if (q) return q.cid; }
          return null;
        });
      });
    },

    deleteCitation: function (cid) {
      return Word.run(function (ctx) {
        var all = ctx.document.contentControls;
        all.load("items/tag");
        return ctx.sync().then(function () {
          all.items.forEach(function (cc) { var p = parseTag(cc.tag); if (p && p.cid === cid) cc.delete(false); });
          return ctx.sync();
        });
      });
    },

    selectCitation: function (cid) {
      return Word.run(function (ctx) {
        var all = ctx.document.contentControls;
        all.load("items/tag");
        return ctx.sync().then(function () {
          for (var i = 0; i < all.items.length; i++) {
            var p = parseTag(all.items[i].tag);
            if (p && p.cid === cid) { all.items[i].select("Select"); break; }
          }
          return ctx.sync();
        });
      });
    },

    /** Convierte citas y bibliografía en texto normal (versión final para la revista). */
    removeCodes: function () {
      return Word.run(function (ctx) {
        var all = ctx.document.contentControls;
        all.load("items/tag");
        return ctx.sync().then(function () {
          var n = 0;
          all.items.forEach(function (cc) {
            if (parseTag(cc.tag) || cc.tag === TAG_BIB) { cc.cannotDelete = false; cc.cannotEdit = false; cc.delete(true); n++; }
          });
          return ctx.sync().then(function () { return n; });
        });
      });
    },

    onSelectionChange: function (cb) {
      try {
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, function () { cb(); });
      } catch (e) { /* sin aviso de selección */ }
    }
  };

  root.CitadorWord = { adapter: adapter, parseTag: parseTag, citationTag: citationTag, TAG_C: TAG_C, TAG_BIB: TAG_BIB };
})(window);
