var qi = Object.defineProperty;
var Ii = (t, e, n) => e in t ? qi(t, e, { enumerable: !0, configurable: !0, writable: !0, value: n }) : t[e] = n;
var Ge = (t, e, n) => Ii(t, typeof e != "symbol" ? e + "" : e, n);
import { jsx as Is } from "react/jsx-runtime";
import St, { createContext as pr, useContext as X, useMemo as vt, useRef as qe, useEffect as ft, useLayoutEffect as ji, createElement as Mi, useCallback as I, useDebugValue as Vi, useState as M } from "react";
var $i = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {}, rt = {}, gt = {}, Ae = {}, js;
function mr() {
  if (js) return Ae;
  js = 1;
  var t = Ae && Ae.__assign || function() {
    return t = Object.assign || function(a) {
      for (var c, o = 1, h = arguments.length; o < h; o++) {
        c = arguments[o];
        for (var f in c) Object.prototype.hasOwnProperty.call(c, f) && (a[f] = c[f]);
      }
      return a;
    }, t.apply(this, arguments);
  }, e = Ae && Ae.__awaiter || function(a, c, o, h) {
    function f(l) {
      return l instanceof o ? l : new o(function(m) {
        m(l);
      });
    }
    return new (o || (o = Promise))(function(l, m) {
      function b(v) {
        try {
          y(h.next(v));
        } catch (R) {
          m(R);
        }
      }
      function E(v) {
        try {
          y(h.throw(v));
        } catch (R) {
          m(R);
        }
      }
      function y(v) {
        v.done ? l(v.value) : f(v.value).then(b, E);
      }
      y((h = h.apply(a, c || [])).next());
    });
  }, n = Ae && Ae.__generator || function(a, c) {
    var o = { label: 0, sent: function() {
      if (l[0] & 1) throw l[1];
      return l[1];
    }, trys: [], ops: [] }, h, f, l, m;
    return m = { next: b(0), throw: b(1), return: b(2) }, typeof Symbol == "function" && (m[Symbol.iterator] = function() {
      return this;
    }), m;
    function b(y) {
      return function(v) {
        return E([y, v]);
      };
    }
    function E(y) {
      if (h) throw new TypeError("Generator is already executing.");
      for (; m && (m = 0, y[0] && (o = 0)), o; ) try {
        if (h = 1, f && (l = y[0] & 2 ? f.return : y[0] ? f.throw || ((l = f.return) && l.call(f), 0) : f.next) && !(l = l.call(f, y[1])).done) return l;
        switch (f = 0, l && (y = [y[0] & 2, l.value]), y[0]) {
          case 0:
          case 1:
            l = y;
            break;
          case 4:
            return o.label++, { value: y[1], done: !1 };
          case 5:
            o.label++, f = y[1], y = [0];
            continue;
          case 7:
            y = o.ops.pop(), o.trys.pop();
            continue;
          default:
            if (l = o.trys, !(l = l.length > 0 && l[l.length - 1]) && (y[0] === 6 || y[0] === 2)) {
              o = 0;
              continue;
            }
            if (y[0] === 3 && (!l || y[1] > l[0] && y[1] < l[3])) {
              o.label = y[1];
              break;
            }
            if (y[0] === 6 && o.label < l[1]) {
              o.label = l[1], l = y;
              break;
            }
            if (l && o.label < l[2]) {
              o.label = l[2], o.ops.push(y);
              break;
            }
            l[2] && o.ops.pop(), o.trys.pop();
            continue;
        }
        y = c.call(a, o);
      } catch (v) {
        y = [6, v], f = 0;
      } finally {
        h = l = 0;
      }
      if (y[0] & 5) throw y[1];
      return { value: y[0] ? y[1] : void 0, done: !0 };
    }
  };
  Object.defineProperty(Ae, "__esModule", { value: !0 }), Ae.FrappeCall = void 0;
  var s = (
    /** @class */
    function() {
      function a(c, o, h, f, l) {
        this.appURL = c, this.axios = o, this.useToken = h ?? !1, this.token = f, this.tokenType = l;
      }
      return a.prototype.get = function(c, o) {
        return e(this, void 0, void 0, function() {
          var h;
          return n(this, function(f) {
            return h = new URLSearchParams(), o && Object.entries(o).forEach(function(l) {
              var m = l[0], b = l[1];
              if (b != null) {
                var E = typeof b == "object" ? JSON.stringify(b) : b;
                h.set(m, E);
              }
            }), [2, this.axios.get("/api/method/".concat(c), {
              params: h
            }).then(function(l) {
              return l.data;
            }).catch(function(l) {
              var m, b;
              throw t(t({}, l.response.data), { httpStatus: l.response.status, httpStatusText: l.response.statusText, message: (m = l.response.data.message) !== null && m !== void 0 ? m : "There was an error.", exception: (b = l.response.data.exception) !== null && b !== void 0 ? b : "" });
            })];
          });
        });
      }, a.prototype.post = function(c, o) {
        return e(this, void 0, void 0, function() {
          return n(this, function(h) {
            return [2, this.axios.post("/api/method/".concat(c), t({}, o)).then(function(f) {
              return f.data;
            }).catch(function(f) {
              var l, m;
              throw t(t({}, f.response.data), { httpStatus: f.response.status, httpStatusText: f.response.statusText, message: (l = f.response.data.message) !== null && l !== void 0 ? l : "There was an error.", exception: (m = f.response.data.exception) !== null && m !== void 0 ? m : "" });
            })];
          });
        });
      }, a.prototype.put = function(c, o) {
        return e(this, void 0, void 0, function() {
          return n(this, function(h) {
            return [2, this.axios.put("/api/method/".concat(c), t({}, o)).then(function(f) {
              return f.data;
            }).catch(function(f) {
              var l, m;
              throw t(t({}, f.response.data), { httpStatus: f.response.status, httpStatusText: f.response.statusText, message: (l = f.response.data.message) !== null && l !== void 0 ? l : "There was an error.", exception: (m = f.response.data.exception) !== null && m !== void 0 ? m : "" });
            })];
          });
        });
      }, a.prototype.delete = function(c, o) {
        return e(this, void 0, void 0, function() {
          return n(this, function(h) {
            return [2, this.axios.delete("/api/method/".concat(c), { params: o }).then(function(f) {
              return f.data;
            }).catch(function(f) {
              var l, m;
              throw t(t({}, f.response.data), { httpStatus: f.response.status, httpStatusText: f.response.statusText, message: (l = f.response.data.message) !== null && l !== void 0 ? l : "There was an error.", exception: (m = f.response.data.exception) !== null && m !== void 0 ? m : "" });
            })];
          });
        });
      }, a;
    }()
  );
  return Ae.FrappeCall = s, Ae;
}
var Ce = {}, Ms;
function yr() {
  if (Ms) return Ce;
  Ms = 1;
  var t = Ce && Ce.__assign || function() {
    return t = Object.assign || function(a) {
      for (var c, o = 1, h = arguments.length; o < h; o++) {
        c = arguments[o];
        for (var f in c) Object.prototype.hasOwnProperty.call(c, f) && (a[f] = c[f]);
      }
      return a;
    }, t.apply(this, arguments);
  }, e = Ce && Ce.__awaiter || function(a, c, o, h) {
    function f(l) {
      return l instanceof o ? l : new o(function(m) {
        m(l);
      });
    }
    return new (o || (o = Promise))(function(l, m) {
      function b(v) {
        try {
          y(h.next(v));
        } catch (R) {
          m(R);
        }
      }
      function E(v) {
        try {
          y(h.throw(v));
        } catch (R) {
          m(R);
        }
      }
      function y(v) {
        v.done ? l(v.value) : f(v.value).then(b, E);
      }
      y((h = h.apply(a, c || [])).next());
    });
  }, n = Ce && Ce.__generator || function(a, c) {
    var o = { label: 0, sent: function() {
      if (l[0] & 1) throw l[1];
      return l[1];
    }, trys: [], ops: [] }, h, f, l, m;
    return m = { next: b(0), throw: b(1), return: b(2) }, typeof Symbol == "function" && (m[Symbol.iterator] = function() {
      return this;
    }), m;
    function b(y) {
      return function(v) {
        return E([y, v]);
      };
    }
    function E(y) {
      if (h) throw new TypeError("Generator is already executing.");
      for (; m && (m = 0, y[0] && (o = 0)), o; ) try {
        if (h = 1, f && (l = y[0] & 2 ? f.return : y[0] ? f.throw || ((l = f.return) && l.call(f), 0) : f.next) && !(l = l.call(f, y[1])).done) return l;
        switch (f = 0, l && (y = [y[0] & 2, l.value]), y[0]) {
          case 0:
          case 1:
            l = y;
            break;
          case 4:
            return o.label++, { value: y[1], done: !1 };
          case 5:
            o.label++, f = y[1], y = [0];
            continue;
          case 7:
            y = o.ops.pop(), o.trys.pop();
            continue;
          default:
            if (l = o.trys, !(l = l.length > 0 && l[l.length - 1]) && (y[0] === 6 || y[0] === 2)) {
              o = 0;
              continue;
            }
            if (y[0] === 3 && (!l || y[1] > l[0] && y[1] < l[3])) {
              o.label = y[1];
              break;
            }
            if (y[0] === 6 && o.label < l[1]) {
              o.label = l[1], l = y;
              break;
            }
            if (l && o.label < l[2]) {
              o.label = l[2], o.ops.push(y);
              break;
            }
            l[2] && o.ops.pop(), o.trys.pop();
            continue;
        }
        y = c.call(a, o);
      } catch (v) {
        y = [6, v], f = 0;
      } finally {
        h = l = 0;
      }
      if (y[0] & 5) throw y[1];
      return { value: y[0] ? y[1] : void 0, done: !0 };
    }
  };
  Object.defineProperty(Ce, "__esModule", { value: !0 }), Ce.FrappeDB = void 0;
  var s = (
    /** @class */
    function() {
      function a(c, o, h, f, l) {
        this.appURL = c, this.axios = o, this.useToken = h ?? !1, this.token = f, this.tokenType = l;
      }
      return a.prototype.getDoc = function(c, o) {
        return o === void 0 && (o = ""), e(this, void 0, void 0, function() {
          return n(this, function(h) {
            return [2, this.axios.get("/api/resource/".concat(c, "/").concat(encodeURIComponent(o))).then(function(f) {
              return f.data.data;
            }).catch(function(f) {
              var l, m;
              throw t(t({}, f.response.data), { httpStatus: f.response.status, httpStatusText: f.response.statusText, message: "There was an error while fetching the document.", exception: (m = (l = f.response.data.exception) !== null && l !== void 0 ? l : f.response.data.exc_type) !== null && m !== void 0 ? m : "" });
            })];
          });
        });
      }, a.prototype.getDocList = function(c, o) {
        var h;
        return e(this, void 0, void 0, function() {
          var f, l, m, b, E, y, v, R, U, A, K;
          return n(this, function(G) {
            return f = {}, o && (l = o.fields, m = o.filters, b = o.orFilters, E = o.orderBy, y = o.limit, v = o.limit_start, R = o.groupBy, U = o.asDict, A = U === void 0 ? !0 : U, K = E ? "".concat(String(E == null ? void 0 : E.field), " ").concat((h = E == null ? void 0 : E.order) !== null && h !== void 0 ? h : "asc") : "", f = {
              fields: l ? JSON.stringify(l) : void 0,
              filters: m ? JSON.stringify(m) : void 0,
              or_filters: b ? JSON.stringify(b) : void 0,
              order_by: K,
              group_by: R,
              limit: y,
              limit_start: v,
              as_dict: A
            }), [2, this.axios.get("/api/resource/".concat(c), { params: f }).then(function(H) {
              return H.data.data;
            }).catch(function(H) {
              var q, Y;
              throw t(t({}, H.response.data), { httpStatus: H.response.status, httpStatusText: H.response.statusText, message: "There was an error while fetching the documents.", exception: (Y = (q = H.response.data.exception) !== null && q !== void 0 ? q : H.response.data.exc_type) !== null && Y !== void 0 ? Y : "" });
            })];
          });
        });
      }, a.prototype.createDoc = function(c, o) {
        return e(this, void 0, void 0, function() {
          return n(this, function(h) {
            return [2, this.axios.post("/api/resource/".concat(c), t({}, o)).then(function(f) {
              return f.data.data;
            }).catch(function(f) {
              var l, m, b;
              throw t(t({}, f.response.data), { httpStatus: f.response.status, httpStatusText: f.response.statusText, message: (l = f.response.data.message) !== null && l !== void 0 ? l : "There was an error while creating the document.", exception: (b = (m = f.response.data.exception) !== null && m !== void 0 ? m : f.response.data.exc_type) !== null && b !== void 0 ? b : "" });
            })];
          });
        });
      }, a.prototype.updateDoc = function(c, o, h) {
        return e(this, void 0, void 0, function() {
          return n(this, function(f) {
            return [2, this.axios.put("/api/resource/".concat(c, "/").concat(o && encodeURIComponent(o)), t({}, h)).then(function(l) {
              return l.data.data;
            }).catch(function(l) {
              var m, b, E;
              throw t(t({}, l.response.data), { httpStatus: l.response.status, httpStatusText: l.response.statusText, message: (m = l.response.data.message) !== null && m !== void 0 ? m : "There was an error while updating the document.", exception: (E = (b = l.response.data.exception) !== null && b !== void 0 ? b : l.response.data.exc_type) !== null && E !== void 0 ? E : "" });
            })];
          });
        });
      }, a.prototype.deleteDoc = function(c, o) {
        return e(this, void 0, void 0, function() {
          return n(this, function(h) {
            return [2, this.axios.delete("/api/resource/".concat(c, "/").concat(o && encodeURIComponent(o))).then(function(f) {
              return f.data;
            }).catch(function(f) {
              var l, m;
              throw t(t({}, f.response.data), { httpStatus: f.response.status, httpStatusText: f.response.statusText, message: "There was an error while deleting the document.", exception: (m = (l = f.response.data.exception) !== null && l !== void 0 ? l : f.response.data.exc_type) !== null && m !== void 0 ? m : "" });
            })];
          });
        });
      }, a.prototype.getCount = function(c, o, h) {
        return h === void 0 && (h = !1), e(this, void 0, void 0, function() {
          var f;
          return n(this, function(l) {
            return f = {
              doctype: c,
              filters: []
            }, h && (f.debug = h), o && (f.filters = o ? JSON.stringify(o) : void 0), [2, this.axios.get("/api/method/frappe.client.get_count", { params: f }).then(function(m) {
              return m.data.message;
            }).catch(function(m) {
              var b, E;
              throw t(t({}, m.response.data), { httpStatus: m.response.status, httpStatusText: m.response.statusText, message: "There was an error while getting the count.", exception: (E = (b = m.response.data.exception) !== null && b !== void 0 ? b : m.response.data.exc_type) !== null && E !== void 0 ? E : "" });
            })];
          });
        });
      }, a.prototype.getLastDoc = function(c, o) {
        return e(this, void 0, void 0, function() {
          var h, f;
          return n(this, function(l) {
            switch (l.label) {
              case 0:
                return h = {
                  orderBy: {
                    field: "creation",
                    order: "desc"
                  }
                }, o && (h = t(t({}, h), o)), [4, this.getDocList(c, t(t({}, h), { limit: 1, fields: ["name"] }))];
              case 1:
                return f = l.sent(), f.length > 0 ? [2, this.getDoc(c, f[0].name)] : [2, {}];
            }
          });
        });
      }, a.prototype.renameDoc = function(c, o, h, f) {
        return f === void 0 && (f = !1), e(this, void 0, void 0, function() {
          return n(this, function(l) {
            return [2, this.axios.post("/api/method/frappe.client.rename_doc", {
              doctype: c,
              old_name: o,
              new_name: h,
              merge: f
            }).then(function(m) {
              return m.data;
            }).catch(function(m) {
              var b, E, y;
              throw t(t({}, m.response.data), { httpStatus: m.response.status, httpStatusText: m.response.statusText, message: (b = m.response.data.message) !== null && b !== void 0 ? b : "There was an error while renaming the document.", exception: (y = (E = m.response.data.exception) !== null && E !== void 0 ? E : m.response.data.exc_type) !== null && y !== void 0 ? y : "" });
            })];
          });
        });
      }, a.prototype.getValue = function(c, o, h, f, l, m) {
        return f === void 0 && (f = !0), l === void 0 && (l = !1), m === void 0 && (m = null), e(this, void 0, void 0, function() {
          var b;
          return n(this, function(E) {
            return b = {
              doctype: c,
              fieldname: "[]",
              filters: [],
              as_dict: f,
              debug: l,
              parent: null
            }, o && (b.fieldname = typeof o == "object" ? JSON.stringify(o) : o), h && (b.filters = h ? JSON.stringify(h) : void 0), m && (b.parent = m), [2, this.axios.get("/api/method/frappe.client.get_value", { params: b }).then(function(y) {
              return y.data;
            }).catch(function(y) {
              var v, R;
              throw t(t({}, y.response.data), { httpStatus: y.response.status, httpStatusText: y.response.statusText, message: "There was an error while getting the value.", exception: (R = (v = y.response.data.exception) !== null && v !== void 0 ? v : y.response.data.exc_type) !== null && R !== void 0 ? R : "" });
            })];
          });
        });
      }, a.prototype.setValue = function(c, o, h, f) {
        return e(this, void 0, void 0, function() {
          return n(this, function(l) {
            return h !== null && typeof h == "object" && !Array.isArray(h) && (f = void 0), [2, this.axios.post("/api/method/frappe.client.set_value", {
              doctype: c,
              name: o,
              fieldname: h,
              value: f
            }).then(function(m) {
              return m.data;
            }).catch(function(m) {
              var b, E;
              throw t(t({}, m.response.data), { httpStatus: m.response.status, httpStatusText: m.response.statusText, message: "There was an error while setting the value.", exception: (E = (b = m.response.data.exception) !== null && b !== void 0 ? b : m.response.data.exc_type) !== null && E !== void 0 ? E : "" });
            })];
          });
        });
      }, a.prototype.getSingleValue = function(c, o) {
        return e(this, void 0, void 0, function() {
          var h;
          return n(this, function(f) {
            return h = {
              doctype: c,
              field: o
            }, [2, this.axios.get("/api/method/frappe.client.get_single_value", { params: h }).then(function(l) {
              return l.data;
            }).catch(function(l) {
              var m, b;
              throw t(t({}, l.response.data), { httpStatus: l.response.status, httpStatusText: l.response.statusText, message: "There was an error while getting the value of single doctype.", exception: (b = (m = l.response.data.exception) !== null && m !== void 0 ? m : l.response.data.exc_type) !== null && b !== void 0 ? b : "" });
            })];
          });
        });
      }, a.prototype.submit = function(c) {
        return e(this, void 0, void 0, function() {
          return n(this, function(o) {
            return [2, this.axios.post("/api/method/frappe.client.submit", { doc: c }).then(function(h) {
              return h.data.message;
            }).catch(function(h) {
              var f, l;
              throw t(t({}, h.response.data), { httpStatus: h.response.status, httpStatusText: h.response.statusText, message: "There was an error while submitting the document.", exception: (l = (f = h.response.data.exception) !== null && f !== void 0 ? f : h.response.data.exc_type) !== null && l !== void 0 ? l : "" });
            })];
          });
        });
      }, a.prototype.cancel = function(c, o) {
        return e(this, void 0, void 0, function() {
          return n(this, function(h) {
            return [2, this.axios.post("/api/method/frappe.client.cancel", { doctype: c, name: o }).then(function(f) {
              return f.data;
            }).catch(function(f) {
              var l, m;
              throw t(t({}, f.response.data), { httpStatus: f.response.status, httpStatusText: f.response.statusText, message: "There was an error while cancelling the document.", exception: (m = (l = f.response.data.exception) !== null && l !== void 0 ? l : f.response.data.exc_type) !== null && m !== void 0 ? m : "" });
            })];
          });
        });
      }, a;
    }()
  );
  return Ce.FrappeDB = s, Ce;
}
var Le = {}, Ve = {};
/*! Axios v1.12.2 Copyright (c) 2025 Matt Zabriskie and contributors */
var Sn, Vs;
function Hi() {
  if (Vs) return Sn;
  Vs = 1;
  function t(r, i) {
    return function() {
      return r.apply(i, arguments);
    };
  }
  const { toString: e } = Object.prototype, { getPrototypeOf: n } = Object, { iterator: s, toStringTag: a } = Symbol, c = /* @__PURE__ */ ((r) => (i) => {
    const u = e.call(i);
    return r[u] || (r[u] = u.slice(8, -1).toLowerCase());
  })(/* @__PURE__ */ Object.create(null)), o = (r) => (r = r.toLowerCase(), (i) => c(i) === r), h = (r) => (i) => typeof i === r, { isArray: f } = Array, l = h("undefined");
  function m(r) {
    return r !== null && !l(r) && r.constructor !== null && !l(r.constructor) && v(r.constructor.isBuffer) && r.constructor.isBuffer(r);
  }
  const b = o("ArrayBuffer");
  function E(r) {
    let i;
    return typeof ArrayBuffer < "u" && ArrayBuffer.isView ? i = ArrayBuffer.isView(r) : i = r && r.buffer && b(r.buffer), i;
  }
  const y = h("string"), v = h("function"), R = h("number"), U = (r) => r !== null && typeof r == "object", A = (r) => r === !0 || r === !1, K = (r) => {
    if (c(r) !== "object")
      return !1;
    const i = n(r);
    return (i === null || i === Object.prototype || Object.getPrototypeOf(i) === null) && !(a in r) && !(s in r);
  }, G = (r) => {
    if (!U(r) || m(r))
      return !1;
    try {
      return Object.keys(r).length === 0 && Object.getPrototypeOf(r) === Object.prototype;
    } catch {
      return !1;
    }
  }, H = o("Date"), q = o("File"), Y = o("Blob"), pe = o("FileList"), F = (r) => U(r) && v(r.pipe), fe = (r) => {
    let i;
    return r && (typeof FormData == "function" && r instanceof FormData || v(r.append) && ((i = c(r)) === "formdata" || // detect form-data instance
    i === "object" && v(r.toString) && r.toString() === "[object FormData]"));
  }, V = o("URLSearchParams"), [ce, Fe, me, W] = ["ReadableStream", "Request", "Response", "Headers"].map(o), ge = (r) => r.trim ? r.trim() : r.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
  function we(r, i, { allOwnKeys: u = !1 } = {}) {
    if (r === null || typeof r > "u")
      return;
    let d, p;
    if (typeof r != "object" && (r = [r]), f(r))
      for (d = 0, p = r.length; d < p; d++)
        i.call(null, r[d], d, r);
    else {
      if (m(r))
        return;
      const w = u ? Object.getOwnPropertyNames(r) : Object.keys(r), g = w.length;
      let S;
      for (d = 0; d < g; d++)
        S = w[d], i.call(null, r[S], S, r);
    }
  }
  function Q(r, i) {
    if (m(r))
      return null;
    i = i.toLowerCase();
    const u = Object.keys(r);
    let d = u.length, p;
    for (; d-- > 0; )
      if (p = u[d], i === p.toLowerCase())
        return p;
    return null;
  }
  const Z = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : $i, Me = (r) => !l(r) && r !== Z;
  function Qe() {
    const { caseless: r, skipUndefined: i } = Me(this) && this || {}, u = {}, d = (p, w) => {
      const g = r && Q(u, w) || w;
      K(u[g]) && K(p) ? u[g] = Qe(u[g], p) : K(p) ? u[g] = Qe({}, p) : f(p) ? u[g] = p.slice() : (!i || !l(p)) && (u[g] = p);
    };
    for (let p = 0, w = arguments.length; p < w; p++)
      arguments[p] && we(arguments[p], d);
    return u;
  }
  const Be = (r, i, u, { allOwnKeys: d } = {}) => (we(i, (p, w) => {
    u && v(p) ? r[w] = t(p, u) : r[w] = p;
  }, { allOwnKeys: d }), r), ie = (r) => (r.charCodeAt(0) === 65279 && (r = r.slice(1)), r), He = (r, i, u, d) => {
    r.prototype = Object.create(i.prototype, d), r.prototype.constructor = r, Object.defineProperty(r, "super", {
      value: i.prototype
    }), u && Object.assign(r.prototype, u);
  }, We = (r, i, u, d) => {
    let p, w, g;
    const S = {};
    if (i = i || {}, r == null) return i;
    do {
      for (p = Object.getOwnPropertyNames(r), w = p.length; w-- > 0; )
        g = p[w], (!d || d(g, r, i)) && !S[g] && (i[g] = r[g], S[g] = !0);
      r = u !== !1 && n(r);
    } while (r && (!u || u(r, i)) && r !== Object.prototype);
    return i;
  }, Ze = (r, i, u) => {
    r = String(r), (u === void 0 || u > r.length) && (u = r.length), u -= i.length;
    const d = r.indexOf(i, u);
    return d !== -1 && d === u;
  }, it = (r) => {
    if (!r) return null;
    if (f(r)) return r;
    let i = r.length;
    if (!R(i)) return null;
    const u = new Array(i);
    for (; i-- > 0; )
      u[i] = r[i];
    return u;
  }, Ot = /* @__PURE__ */ ((r) => (i) => r && i instanceof r)(typeof Uint8Array < "u" && n(Uint8Array)), on = (r, i) => {
    const d = (r && r[s]).call(r);
    let p;
    for (; (p = d.next()) && !p.done; ) {
      const w = p.value;
      i.call(r, w[0], w[1]);
    }
  }, an = (r, i) => {
    let u;
    const d = [];
    for (; (u = r.exec(i)) !== null; )
      d.push(u);
    return d;
  }, et = o("HTMLFormElement"), xt = (r) => r.toLowerCase().replace(
    /[-_\s]([a-z\d])(\w*)/g,
    function(u, d, p) {
      return d.toUpperCase() + p;
    }
  ), cn = (({ hasOwnProperty: r }) => (i, u) => r.call(i, u))(Object.prototype), j = o("RegExp"), z = (r, i) => {
    const u = Object.getOwnPropertyDescriptors(r), d = {};
    we(u, (p, w) => {
      let g;
      (g = i(p, w, r)) !== !1 && (d[w] = g || p);
    }), Object.defineProperties(r, d);
  }, ee = (r) => {
    z(r, (i, u) => {
      if (v(r) && ["arguments", "caller", "callee"].indexOf(u) !== -1)
        return !1;
      const d = r[u];
      if (v(d)) {
        if (i.enumerable = !1, "writable" in i) {
          i.writable = !1;
          return;
        }
        i.set || (i.set = () => {
          throw Error("Can not rewrite read-only method '" + u + "'");
        });
      }
    });
  }, $ = (r, i) => {
    const u = {}, d = (p) => {
      p.forEach((w) => {
        u[w] = !0;
      });
    };
    return f(r) ? d(r) : d(String(r).split(i)), u;
  }, be = () => {
  }, ze = (r, i) => r != null && Number.isFinite(r = +r) ? r : i;
  function oe(r) {
    return !!(r && v(r.append) && r[a] === "FormData" && r[s]);
  }
  const le = (r) => {
    const i = new Array(10), u = (d, p) => {
      if (U(d)) {
        if (i.indexOf(d) >= 0)
          return;
        if (m(d))
          return d;
        if (!("toJSON" in d)) {
          i[p] = d;
          const w = f(d) ? [] : {};
          return we(d, (g, S) => {
            const C = u(g, p + 1);
            !l(C) && (w[S] = C);
          }), i[p] = void 0, w;
        }
      }
      return d;
    };
    return u(r, 0);
  }, Te = o("AsyncFunction"), At = (r) => r && (U(r) || v(r)) && v(r.then) && v(r.catch), pt = ((r, i) => r ? setImmediate : i ? ((u, d) => (Z.addEventListener("message", ({ source: p, data: w }) => {
    p === Z && w === u && d.length && d.shift()();
  }, !1), (p) => {
    d.push(p), Z.postMessage(u, "*");
  }))(`axios@${Math.random()}`, []) : (u) => setTimeout(u))(
    typeof setImmediate == "function",
    v(Z.postMessage)
  ), Ct = typeof queueMicrotask < "u" ? queueMicrotask.bind(Z) : typeof process < "u" && process.nextTick || pt;
  var _ = {
    isArray: f,
    isArrayBuffer: b,
    isBuffer: m,
    isFormData: fe,
    isArrayBufferView: E,
    isString: y,
    isNumber: R,
    isBoolean: A,
    isObject: U,
    isPlainObject: K,
    isEmptyObject: G,
    isReadableStream: ce,
    isRequest: Fe,
    isResponse: me,
    isHeaders: W,
    isUndefined: l,
    isDate: H,
    isFile: q,
    isBlob: Y,
    isRegExp: j,
    isFunction: v,
    isStream: F,
    isURLSearchParams: V,
    isTypedArray: Ot,
    isFileList: pe,
    forEach: we,
    merge: Qe,
    extend: Be,
    trim: ge,
    stripBOM: ie,
    inherits: He,
    toFlatObject: We,
    kindOf: c,
    kindOfTest: o,
    endsWith: Ze,
    toArray: it,
    forEachEntry: on,
    matchAll: an,
    isHTMLForm: et,
    hasOwnProperty: cn,
    hasOwnProp: cn,
    // an alias to avoid ESLint no-prototype-builtins detection
    reduceDescriptors: z,
    freezeMethods: ee,
    toObjectSet: $,
    toCamelCase: xt,
    noop: be,
    toFiniteNumber: ze,
    findKey: Q,
    global: Z,
    isContextDefined: Me,
    isSpecCompliantForm: oe,
    toJSONObject: le,
    isAsyncFn: Te,
    isThenable: At,
    setImmediate: pt,
    asap: Ct,
    isIterable: (r) => r != null && v(r[s])
  };
  function k(r, i, u, d, p) {
    Error.call(this), Error.captureStackTrace ? Error.captureStackTrace(this, this.constructor) : this.stack = new Error().stack, this.message = r, this.name = "AxiosError", i && (this.code = i), u && (this.config = u), d && (this.request = d), p && (this.response = p, this.status = p.status ? p.status : null);
  }
  _.inherits(k, Error, {
    toJSON: function() {
      return {
        // Standard
        message: this.message,
        name: this.name,
        // Microsoft
        description: this.description,
        number: this.number,
        // Mozilla
        fileName: this.fileName,
        lineNumber: this.lineNumber,
        columnNumber: this.columnNumber,
        stack: this.stack,
        // Axios
        config: _.toJSONObject(this.config),
        code: this.code,
        status: this.status
      };
    }
  });
  const Lt = k.prototype, ot = {};
  [
    "ERR_BAD_OPTION_VALUE",
    "ERR_BAD_OPTION",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ERR_NETWORK",
    "ERR_FR_TOO_MANY_REDIRECTS",
    "ERR_DEPRECATED",
    "ERR_BAD_RESPONSE",
    "ERR_BAD_REQUEST",
    "ERR_CANCELED",
    "ERR_NOT_SUPPORT",
    "ERR_INVALID_URL"
    // eslint-disable-next-line func-names
  ].forEach((r) => {
    ot[r] = { value: r };
  }), Object.defineProperties(k, ot), Object.defineProperty(Lt, "isAxiosError", { value: !0 }), k.from = (r, i, u, d, p, w) => {
    const g = Object.create(Lt);
    _.toFlatObject(r, g, function(T) {
      return T !== Error.prototype;
    }, (x) => x !== "isAxiosError");
    const S = r && r.message ? r.message : "Error", C = i == null && r ? r.code : i;
    return k.call(g, S, C, u, d, p), r && g.cause == null && Object.defineProperty(g, "cause", { value: r, configurable: !0 }), g.name = r && r.name || "Error", w && Object.assign(g, w), g;
  };
  var Jr = null;
  function un(r) {
    return _.isPlainObject(r) || _.isArray(r);
  }
  function is(r) {
    return _.endsWith(r, "[]") ? r.slice(0, -2) : r;
  }
  function os(r, i, u) {
    return r ? r.concat(i).map(function(p, w) {
      return p = is(p), !u && w ? "[" + p + "]" : p;
    }).join(u ? "." : "") : i;
  }
  function Kr(r) {
    return _.isArray(r) && !r.some(un);
  }
  const Gr = _.toFlatObject(_, {}, null, function(i) {
    return /^is[A-Z]/.test(i);
  });
  function Dt(r, i, u) {
    if (!_.isObject(r))
      throw new TypeError("target must be an object");
    i = i || new FormData(), u = _.toFlatObject(u, {
      metaTokens: !0,
      dots: !1,
      indexes: !1
    }, !1, function(N, L) {
      return !_.isUndefined(L[N]);
    });
    const d = u.metaTokens, p = u.visitor || T, w = u.dots, g = u.indexes, C = (u.Blob || typeof Blob < "u" && Blob) && _.isSpecCompliantForm(i);
    if (!_.isFunction(p))
      throw new TypeError("visitor must be a function");
    function x(O) {
      if (O === null) return "";
      if (_.isDate(O))
        return O.toISOString();
      if (_.isBoolean(O))
        return O.toString();
      if (!C && _.isBlob(O))
        throw new k("Blob is not supported. Use a Buffer instead.");
      return _.isArrayBuffer(O) || _.isTypedArray(O) ? C && typeof Blob == "function" ? new Blob([O]) : Buffer.from(O) : O;
    }
    function T(O, N, L) {
      let ae = O;
      if (O && !L && typeof O == "object") {
        if (_.endsWith(N, "{}"))
          N = d ? N : N.slice(0, -2), O = JSON.stringify(O);
        else if (_.isArray(O) && Kr(O) || (_.isFileList(O) || _.endsWith(N, "[]")) && (ae = _.toArray(O)))
          return N = is(N), ae.forEach(function(ue, ye) {
            !(_.isUndefined(ue) || ue === null) && i.append(
              // eslint-disable-next-line no-nested-ternary
              g === !0 ? os([N], ye, w) : g === null ? N : N + "[]",
              x(ue)
            );
          }), !1;
      }
      return un(O) ? !0 : (i.append(os(L, N, w), x(O)), !1);
    }
    const D = [], J = Object.assign(Gr, {
      defaultVisitor: T,
      convertValue: x,
      isVisitable: un
    });
    function de(O, N) {
      if (!_.isUndefined(O)) {
        if (D.indexOf(O) !== -1)
          throw Error("Circular reference detected in " + N.join("."));
        D.push(O), _.forEach(O, function(ae, ve) {
          (!(_.isUndefined(ae) || ae === null) && p.call(
            i,
            ae,
            _.isString(ve) ? ve.trim() : ve,
            N,
            J
          )) === !0 && de(ae, N ? N.concat(ve) : [ve]);
        }), D.pop();
      }
    }
    if (!_.isObject(r))
      throw new TypeError("data must be an object");
    return de(r), i;
  }
  function as(r) {
    const i = {
      "!": "%21",
      "'": "%27",
      "(": "%28",
      ")": "%29",
      "~": "%7E",
      "%20": "+",
      "%00": "\0"
    };
    return encodeURIComponent(r).replace(/[!'()~]|%20|%00/g, function(d) {
      return i[d];
    });
  }
  function ln(r, i) {
    this._pairs = [], r && Dt(r, this, i);
  }
  const cs = ln.prototype;
  cs.append = function(i, u) {
    this._pairs.push([i, u]);
  }, cs.toString = function(i) {
    const u = i ? function(d) {
      return i.call(this, d, as);
    } : as;
    return this._pairs.map(function(p) {
      return u(p[0]) + "=" + u(p[1]);
    }, "").join("&");
  };
  function Xr(r) {
    return encodeURIComponent(r).replace(/%3A/gi, ":").replace(/%24/g, "$").replace(/%2C/gi, ",").replace(/%20/g, "+");
  }
  function us(r, i, u) {
    if (!i)
      return r;
    const d = u && u.encode || Xr;
    _.isFunction(u) && (u = {
      serialize: u
    });
    const p = u && u.serialize;
    let w;
    if (p ? w = p(i, u) : w = _.isURLSearchParams(i) ? i.toString() : new ln(i, u).toString(d), w) {
      const g = r.indexOf("#");
      g !== -1 && (r = r.slice(0, g)), r += (r.indexOf("?") === -1 ? "?" : "&") + w;
    }
    return r;
  }
  class Yr {
    constructor() {
      this.handlers = [];
    }
    /**
     * Add a new interceptor to the stack
     *
     * @param {Function} fulfilled The function to handle `then` for a `Promise`
     * @param {Function} rejected The function to handle `reject` for a `Promise`
     *
     * @return {Number} An ID used to remove interceptor later
     */
    use(i, u, d) {
      return this.handlers.push({
        fulfilled: i,
        rejected: u,
        synchronous: d ? d.synchronous : !1,
        runWhen: d ? d.runWhen : null
      }), this.handlers.length - 1;
    }
    /**
     * Remove an interceptor from the stack
     *
     * @param {Number} id The ID that was returned by `use`
     *
     * @returns {Boolean} `true` if the interceptor was removed, `false` otherwise
     */
    eject(i) {
      this.handlers[i] && (this.handlers[i] = null);
    }
    /**
     * Clear all interceptors from the stack
     *
     * @returns {void}
     */
    clear() {
      this.handlers && (this.handlers = []);
    }
    /**
     * Iterate over all the registered interceptors
     *
     * This method is particularly useful for skipping over any
     * interceptors that may have become `null` calling `eject`.
     *
     * @param {Function} fn The function to call for each interceptor
     *
     * @returns {void}
     */
    forEach(i) {
      _.forEach(this.handlers, function(d) {
        d !== null && i(d);
      });
    }
  }
  var ls = Yr, fs = {
    silentJSONParsing: !0,
    forcedJSONParsing: !0,
    clarifyTimeoutError: !1
  }, Qr = typeof URLSearchParams < "u" ? URLSearchParams : ln, Zr = typeof FormData < "u" ? FormData : null, ei = typeof Blob < "u" ? Blob : null, ti = {
    isBrowser: !0,
    classes: {
      URLSearchParams: Qr,
      FormData: Zr,
      Blob: ei
    },
    protocols: ["http", "https", "file", "blob", "url", "data"]
  };
  const fn = typeof window < "u" && typeof document < "u", hn = typeof navigator == "object" && navigator || void 0, ni = fn && (!hn || ["ReactNative", "NativeScript", "NS"].indexOf(hn.product) < 0), si = typeof WorkerGlobalScope < "u" && // eslint-disable-next-line no-undef
  self instanceof WorkerGlobalScope && typeof self.importScripts == "function", ri = fn && window.location.href || "http://localhost";
  var ii = /* @__PURE__ */ Object.freeze({
    __proto__: null,
    hasBrowserEnv: fn,
    hasStandardBrowserWebWorkerEnv: si,
    hasStandardBrowserEnv: ni,
    navigator: hn,
    origin: ri
  }), he = {
    ...ii,
    ...ti
  };
  function oi(r, i) {
    return Dt(r, new he.classes.URLSearchParams(), {
      visitor: function(u, d, p, w) {
        return he.isNode && _.isBuffer(u) ? (this.append(d, u.toString("base64")), !1) : w.defaultVisitor.apply(this, arguments);
      },
      ...i
    });
  }
  function ai(r) {
    return _.matchAll(/\w+|\[(\w*)]/g, r).map((i) => i[0] === "[]" ? "" : i[1] || i[0]);
  }
  function ci(r) {
    const i = {}, u = Object.keys(r);
    let d;
    const p = u.length;
    let w;
    for (d = 0; d < p; d++)
      w = u[d], i[w] = r[w];
    return i;
  }
  function hs(r) {
    function i(u, d, p, w) {
      let g = u[w++];
      if (g === "__proto__") return !0;
      const S = Number.isFinite(+g), C = w >= u.length;
      return g = !g && _.isArray(p) ? p.length : g, C ? (_.hasOwnProp(p, g) ? p[g] = [p[g], d] : p[g] = d, !S) : ((!p[g] || !_.isObject(p[g])) && (p[g] = []), i(u, d, p[g], w) && _.isArray(p[g]) && (p[g] = ci(p[g])), !S);
    }
    if (_.isFormData(r) && _.isFunction(r.entries)) {
      const u = {};
      return _.forEachEntry(r, (d, p) => {
        i(ai(d), p, u, 0);
      }), u;
    }
    return null;
  }
  function ui(r, i, u) {
    if (_.isString(r))
      try {
        return (i || JSON.parse)(r), _.trim(r);
      } catch (d) {
        if (d.name !== "SyntaxError")
          throw d;
      }
    return (u || JSON.stringify)(r);
  }
  const dn = {
    transitional: fs,
    adapter: ["xhr", "http", "fetch"],
    transformRequest: [function(i, u) {
      const d = u.getContentType() || "", p = d.indexOf("application/json") > -1, w = _.isObject(i);
      if (w && _.isHTMLForm(i) && (i = new FormData(i)), _.isFormData(i))
        return p ? JSON.stringify(hs(i)) : i;
      if (_.isArrayBuffer(i) || _.isBuffer(i) || _.isStream(i) || _.isFile(i) || _.isBlob(i) || _.isReadableStream(i))
        return i;
      if (_.isArrayBufferView(i))
        return i.buffer;
      if (_.isURLSearchParams(i))
        return u.setContentType("application/x-www-form-urlencoded;charset=utf-8", !1), i.toString();
      let S;
      if (w) {
        if (d.indexOf("application/x-www-form-urlencoded") > -1)
          return oi(i, this.formSerializer).toString();
        if ((S = _.isFileList(i)) || d.indexOf("multipart/form-data") > -1) {
          const C = this.env && this.env.FormData;
          return Dt(
            S ? { "files[]": i } : i,
            C && new C(),
            this.formSerializer
          );
        }
      }
      return w || p ? (u.setContentType("application/json", !1), ui(i)) : i;
    }],
    transformResponse: [function(i) {
      const u = this.transitional || dn.transitional, d = u && u.forcedJSONParsing, p = this.responseType === "json";
      if (_.isResponse(i) || _.isReadableStream(i))
        return i;
      if (i && _.isString(i) && (d && !this.responseType || p)) {
        const g = !(u && u.silentJSONParsing) && p;
        try {
          return JSON.parse(i, this.parseReviver);
        } catch (S) {
          if (g)
            throw S.name === "SyntaxError" ? k.from(S, k.ERR_BAD_RESPONSE, this, null, this.response) : S;
        }
      }
      return i;
    }],
    /**
     * A timeout in milliseconds to abort a request. If set to 0 (default) a
     * timeout is not created.
     */
    timeout: 0,
    xsrfCookieName: "XSRF-TOKEN",
    xsrfHeaderName: "X-XSRF-TOKEN",
    maxContentLength: -1,
    maxBodyLength: -1,
    env: {
      FormData: he.classes.FormData,
      Blob: he.classes.Blob
    },
    validateStatus: function(i) {
      return i >= 200 && i < 300;
    },
    headers: {
      common: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": void 0
      }
    }
  };
  _.forEach(["delete", "get", "head", "post", "put", "patch"], (r) => {
    dn.headers[r] = {};
  });
  var pn = dn;
  const li = _.toObjectSet([
    "age",
    "authorization",
    "content-length",
    "content-type",
    "etag",
    "expires",
    "from",
    "host",
    "if-modified-since",
    "if-unmodified-since",
    "last-modified",
    "location",
    "max-forwards",
    "proxy-authorization",
    "referer",
    "retry-after",
    "user-agent"
  ]);
  var fi = (r) => {
    const i = {};
    let u, d, p;
    return r && r.split(`
`).forEach(function(g) {
      p = g.indexOf(":"), u = g.substring(0, p).trim().toLowerCase(), d = g.substring(p + 1).trim(), !(!u || i[u] && li[u]) && (u === "set-cookie" ? i[u] ? i[u].push(d) : i[u] = [d] : i[u] = i[u] ? i[u] + ", " + d : d);
    }), i;
  };
  const ds = Symbol("internals");
  function mt(r) {
    return r && String(r).trim().toLowerCase();
  }
  function Nt(r) {
    return r === !1 || r == null ? r : _.isArray(r) ? r.map(Nt) : String(r);
  }
  function hi(r) {
    const i = /* @__PURE__ */ Object.create(null), u = /([^\s,;=]+)\s*(?:=\s*([^,;]+))?/g;
    let d;
    for (; d = u.exec(r); )
      i[d[1]] = d[2];
    return i;
  }
  const di = (r) => /^[-_a-zA-Z0-9^`|~,!#$%&'*+.]+$/.test(r.trim());
  function mn(r, i, u, d, p) {
    if (_.isFunction(d))
      return d.call(this, i, u);
    if (p && (i = u), !!_.isString(i)) {
      if (_.isString(d))
        return i.indexOf(d) !== -1;
      if (_.isRegExp(d))
        return d.test(i);
    }
  }
  function pi(r) {
    return r.trim().toLowerCase().replace(/([a-z\d])(\w*)/g, (i, u, d) => u.toUpperCase() + d);
  }
  function mi(r, i) {
    const u = _.toCamelCase(" " + i);
    ["get", "set", "has"].forEach((d) => {
      Object.defineProperty(r, d + u, {
        value: function(p, w, g) {
          return this[d].call(this, i, p, w, g);
        },
        configurable: !0
      });
    });
  }
  class kt {
    constructor(i) {
      i && this.set(i);
    }
    set(i, u, d) {
      const p = this;
      function w(S, C, x) {
        const T = mt(C);
        if (!T)
          throw new Error("header name must be a non-empty string");
        const D = _.findKey(p, T);
        (!D || p[D] === void 0 || x === !0 || x === void 0 && p[D] !== !1) && (p[D || C] = Nt(S));
      }
      const g = (S, C) => _.forEach(S, (x, T) => w(x, T, C));
      if (_.isPlainObject(i) || i instanceof this.constructor)
        g(i, u);
      else if (_.isString(i) && (i = i.trim()) && !di(i))
        g(fi(i), u);
      else if (_.isObject(i) && _.isIterable(i)) {
        let S = {}, C, x;
        for (const T of i) {
          if (!_.isArray(T))
            throw TypeError("Object iterator must return a key-value pair");
          S[x = T[0]] = (C = S[x]) ? _.isArray(C) ? [...C, T[1]] : [C, T[1]] : T[1];
        }
        g(S, u);
      } else
        i != null && w(u, i, d);
      return this;
    }
    get(i, u) {
      if (i = mt(i), i) {
        const d = _.findKey(this, i);
        if (d) {
          const p = this[d];
          if (!u)
            return p;
          if (u === !0)
            return hi(p);
          if (_.isFunction(u))
            return u.call(this, p, d);
          if (_.isRegExp(u))
            return u.exec(p);
          throw new TypeError("parser must be boolean|regexp|function");
        }
      }
    }
    has(i, u) {
      if (i = mt(i), i) {
        const d = _.findKey(this, i);
        return !!(d && this[d] !== void 0 && (!u || mn(this, this[d], d, u)));
      }
      return !1;
    }
    delete(i, u) {
      const d = this;
      let p = !1;
      function w(g) {
        if (g = mt(g), g) {
          const S = _.findKey(d, g);
          S && (!u || mn(d, d[S], S, u)) && (delete d[S], p = !0);
        }
      }
      return _.isArray(i) ? i.forEach(w) : w(i), p;
    }
    clear(i) {
      const u = Object.keys(this);
      let d = u.length, p = !1;
      for (; d--; ) {
        const w = u[d];
        (!i || mn(this, this[w], w, i, !0)) && (delete this[w], p = !0);
      }
      return p;
    }
    normalize(i) {
      const u = this, d = {};
      return _.forEach(this, (p, w) => {
        const g = _.findKey(d, w);
        if (g) {
          u[g] = Nt(p), delete u[w];
          return;
        }
        const S = i ? pi(w) : String(w).trim();
        S !== w && delete u[w], u[S] = Nt(p), d[S] = !0;
      }), this;
    }
    concat(...i) {
      return this.constructor.concat(this, ...i);
    }
    toJSON(i) {
      const u = /* @__PURE__ */ Object.create(null);
      return _.forEach(this, (d, p) => {
        d != null && d !== !1 && (u[p] = i && _.isArray(d) ? d.join(", ") : d);
      }), u;
    }
    [Symbol.iterator]() {
      return Object.entries(this.toJSON())[Symbol.iterator]();
    }
    toString() {
      return Object.entries(this.toJSON()).map(([i, u]) => i + ": " + u).join(`
`);
    }
    getSetCookie() {
      return this.get("set-cookie") || [];
    }
    get [Symbol.toStringTag]() {
      return "AxiosHeaders";
    }
    static from(i) {
      return i instanceof this ? i : new this(i);
    }
    static concat(i, ...u) {
      const d = new this(i);
      return u.forEach((p) => d.set(p)), d;
    }
    static accessor(i) {
      const d = (this[ds] = this[ds] = {
        accessors: {}
      }).accessors, p = this.prototype;
      function w(g) {
        const S = mt(g);
        d[S] || (mi(p, g), d[S] = !0);
      }
      return _.isArray(i) ? i.forEach(w) : w(i), this;
    }
  }
  kt.accessor(["Content-Type", "Content-Length", "Accept", "Accept-Encoding", "User-Agent", "Authorization"]), _.reduceDescriptors(kt.prototype, ({ value: r }, i) => {
    let u = i[0].toUpperCase() + i.slice(1);
    return {
      get: () => r,
      set(d) {
        this[u] = d;
      }
    };
  }), _.freezeMethods(kt);
  var Oe = kt;
  function yn(r, i) {
    const u = this || pn, d = i || u, p = Oe.from(d.headers);
    let w = d.data;
    return _.forEach(r, function(S) {
      w = S.call(u, w, p.normalize(), i ? i.status : void 0);
    }), p.normalize(), w;
  }
  function ps(r) {
    return !!(r && r.__CANCEL__);
  }
  function at(r, i, u) {
    k.call(this, r ?? "canceled", k.ERR_CANCELED, i, u), this.name = "CanceledError";
  }
  _.inherits(at, k, {
    __CANCEL__: !0
  });
  function ms(r, i, u) {
    const d = u.config.validateStatus;
    !u.status || !d || d(u.status) ? r(u) : i(new k(
      "Request failed with status code " + u.status,
      [k.ERR_BAD_REQUEST, k.ERR_BAD_RESPONSE][Math.floor(u.status / 100) - 4],
      u.config,
      u.request,
      u
    ));
  }
  function yi(r) {
    const i = /^([-+\w]{1,25})(:?\/\/|:)/.exec(r);
    return i && i[1] || "";
  }
  function gi(r, i) {
    r = r || 10;
    const u = new Array(r), d = new Array(r);
    let p = 0, w = 0, g;
    return i = i !== void 0 ? i : 1e3, function(C) {
      const x = Date.now(), T = d[w];
      g || (g = x), u[p] = C, d[p] = x;
      let D = w, J = 0;
      for (; D !== p; )
        J += u[D++], D = D % r;
      if (p = (p + 1) % r, p === w && (w = (w + 1) % r), x - g < i)
        return;
      const de = T && x - T;
      return de ? Math.round(J * 1e3 / de) : void 0;
    };
  }
  function wi(r, i) {
    let u = 0, d = 1e3 / i, p, w;
    const g = (x, T = Date.now()) => {
      u = T, p = null, w && (clearTimeout(w), w = null), r(...x);
    };
    return [(...x) => {
      const T = Date.now(), D = T - u;
      D >= d ? g(x, T) : (p = x, w || (w = setTimeout(() => {
        w = null, g(p);
      }, d - D)));
    }, () => p && g(p)];
  }
  const Ft = (r, i, u = 3) => {
    let d = 0;
    const p = gi(50, 250);
    return wi((w) => {
      const g = w.loaded, S = w.lengthComputable ? w.total : void 0, C = g - d, x = p(C), T = g <= S;
      d = g;
      const D = {
        loaded: g,
        total: S,
        progress: S ? g / S : void 0,
        bytes: C,
        rate: x || void 0,
        estimated: x && S && T ? (S - g) / x : void 0,
        event: w,
        lengthComputable: S != null,
        [i ? "download" : "upload"]: !0
      };
      r(D);
    }, u);
  }, ys = (r, i) => {
    const u = r != null;
    return [(d) => i[0]({
      lengthComputable: u,
      total: r,
      loaded: d
    }), i[1]];
  }, gs = (r) => (...i) => _.asap(() => r(...i));
  var bi = he.hasStandardBrowserEnv ? /* @__PURE__ */ ((r, i) => (u) => (u = new URL(u, he.origin), r.protocol === u.protocol && r.host === u.host && (i || r.port === u.port)))(
    new URL(he.origin),
    he.navigator && /(msie|trident)/i.test(he.navigator.userAgent)
  ) : () => !0, _i = he.hasStandardBrowserEnv ? (
    // Standard browser envs support document.cookie
    {
      write(r, i, u, d, p, w) {
        const g = [r + "=" + encodeURIComponent(i)];
        _.isNumber(u) && g.push("expires=" + new Date(u).toGMTString()), _.isString(d) && g.push("path=" + d), _.isString(p) && g.push("domain=" + p), w === !0 && g.push("secure"), document.cookie = g.join("; ");
      },
      read(r) {
        const i = document.cookie.match(new RegExp("(^|;\\s*)(" + r + ")=([^;]*)"));
        return i ? decodeURIComponent(i[3]) : null;
      },
      remove(r) {
        this.write(r, "", Date.now() - 864e5);
      }
    }
  ) : (
    // Non-standard browser env (web workers, react-native) lack needed support.
    {
      write() {
      },
      read() {
        return null;
      },
      remove() {
      }
    }
  );
  function vi(r) {
    return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(r);
  }
  function Ei(r, i) {
    return i ? r.replace(/\/?\/$/, "") + "/" + i.replace(/^\/+/, "") : r;
  }
  function ws(r, i, u) {
    let d = !vi(i);
    return r && (d || u == !1) ? Ei(r, i) : i;
  }
  const bs = (r) => r instanceof Oe ? { ...r } : r;
  function tt(r, i) {
    i = i || {};
    const u = {};
    function d(x, T, D, J) {
      return _.isPlainObject(x) && _.isPlainObject(T) ? _.merge.call({ caseless: J }, x, T) : _.isPlainObject(T) ? _.merge({}, T) : _.isArray(T) ? T.slice() : T;
    }
    function p(x, T, D, J) {
      if (_.isUndefined(T)) {
        if (!_.isUndefined(x))
          return d(void 0, x, D, J);
      } else return d(x, T, D, J);
    }
    function w(x, T) {
      if (!_.isUndefined(T))
        return d(void 0, T);
    }
    function g(x, T) {
      if (_.isUndefined(T)) {
        if (!_.isUndefined(x))
          return d(void 0, x);
      } else return d(void 0, T);
    }
    function S(x, T, D) {
      if (D in i)
        return d(x, T);
      if (D in r)
        return d(void 0, x);
    }
    const C = {
      url: w,
      method: w,
      data: w,
      baseURL: g,
      transformRequest: g,
      transformResponse: g,
      paramsSerializer: g,
      timeout: g,
      timeoutMessage: g,
      withCredentials: g,
      withXSRFToken: g,
      adapter: g,
      responseType: g,
      xsrfCookieName: g,
      xsrfHeaderName: g,
      onUploadProgress: g,
      onDownloadProgress: g,
      decompress: g,
      maxContentLength: g,
      maxBodyLength: g,
      beforeRedirect: g,
      transport: g,
      httpAgent: g,
      httpsAgent: g,
      cancelToken: g,
      socketPath: g,
      responseEncoding: g,
      validateStatus: S,
      headers: (x, T, D) => p(bs(x), bs(T), D, !0)
    };
    return _.forEach(Object.keys({ ...r, ...i }), function(T) {
      const D = C[T] || p, J = D(r[T], i[T], T);
      _.isUndefined(J) && D !== S || (u[T] = J);
    }), u;
  }
  var _s = (r) => {
    const i = tt({}, r);
    let { data: u, withXSRFToken: d, xsrfHeaderName: p, xsrfCookieName: w, headers: g, auth: S } = i;
    if (i.headers = g = Oe.from(g), i.url = us(ws(i.baseURL, i.url, i.allowAbsoluteUrls), r.params, r.paramsSerializer), S && g.set(
      "Authorization",
      "Basic " + btoa((S.username || "") + ":" + (S.password ? unescape(encodeURIComponent(S.password)) : ""))
    ), _.isFormData(u)) {
      if (he.hasStandardBrowserEnv || he.hasStandardBrowserWebWorkerEnv)
        g.setContentType(void 0);
      else if (_.isFunction(u.getHeaders)) {
        const C = u.getHeaders(), x = ["content-type", "content-length"];
        Object.entries(C).forEach(([T, D]) => {
          x.includes(T.toLowerCase()) && g.set(T, D);
        });
      }
    }
    if (he.hasStandardBrowserEnv && (d && _.isFunction(d) && (d = d(i)), d || d !== !1 && bi(i.url))) {
      const C = p && w && _i.read(w);
      C && g.set(p, C);
    }
    return i;
  }, Si = typeof XMLHttpRequest < "u" && function(r) {
    return new Promise(function(u, d) {
      const p = _s(r);
      let w = p.data;
      const g = Oe.from(p.headers).normalize();
      let { responseType: S, onUploadProgress: C, onDownloadProgress: x } = p, T, D, J, de, O;
      function N() {
        de && de(), O && O(), p.cancelToken && p.cancelToken.unsubscribe(T), p.signal && p.signal.removeEventListener("abort", T);
      }
      let L = new XMLHttpRequest();
      L.open(p.method.toUpperCase(), p.url, !0), L.timeout = p.timeout;
      function ae() {
        if (!L)
          return;
        const ue = Oe.from(
          "getAllResponseHeaders" in L && L.getAllResponseHeaders()
        ), xe = {
          data: !S || S === "text" || S === "json" ? L.responseText : L.response,
          status: L.status,
          statusText: L.statusText,
          headers: ue,
          config: r,
          request: L
        };
        ms(function(Ee) {
          u(Ee), N();
        }, function(Ee) {
          d(Ee), N();
        }, xe), L = null;
      }
      "onloadend" in L ? L.onloadend = ae : L.onreadystatechange = function() {
        !L || L.readyState !== 4 || L.status === 0 && !(L.responseURL && L.responseURL.indexOf("file:") === 0) || setTimeout(ae);
      }, L.onabort = function() {
        L && (d(new k("Request aborted", k.ECONNABORTED, r, L)), L = null);
      }, L.onerror = function(ye) {
        const xe = ye && ye.message ? ye.message : "Network Error", nt = new k(xe, k.ERR_NETWORK, r, L);
        nt.event = ye || null, d(nt), L = null;
      }, L.ontimeout = function() {
        let ye = p.timeout ? "timeout of " + p.timeout + "ms exceeded" : "timeout exceeded";
        const xe = p.transitional || fs;
        p.timeoutErrorMessage && (ye = p.timeoutErrorMessage), d(new k(
          ye,
          xe.clarifyTimeoutError ? k.ETIMEDOUT : k.ECONNABORTED,
          r,
          L
        )), L = null;
      }, w === void 0 && g.setContentType(null), "setRequestHeader" in L && _.forEach(g.toJSON(), function(ye, xe) {
        L.setRequestHeader(xe, ye);
      }), _.isUndefined(p.withCredentials) || (L.withCredentials = !!p.withCredentials), S && S !== "json" && (L.responseType = p.responseType), x && ([J, O] = Ft(x, !0), L.addEventListener("progress", J)), C && L.upload && ([D, de] = Ft(C), L.upload.addEventListener("progress", D), L.upload.addEventListener("loadend", de)), (p.cancelToken || p.signal) && (T = (ue) => {
        L && (d(!ue || ue.type ? new at(null, r, L) : ue), L.abort(), L = null);
      }, p.cancelToken && p.cancelToken.subscribe(T), p.signal && (p.signal.aborted ? T() : p.signal.addEventListener("abort", T)));
      const ve = yi(p.url);
      if (ve && he.protocols.indexOf(ve) === -1) {
        d(new k("Unsupported protocol " + ve + ":", k.ERR_BAD_REQUEST, r));
        return;
      }
      L.send(w || null);
    });
  }, Ri = (r, i) => {
    const { length: u } = r = r ? r.filter(Boolean) : [];
    if (i || u) {
      let d = new AbortController(), p;
      const w = function(x) {
        if (!p) {
          p = !0, S();
          const T = x instanceof Error ? x : this.reason;
          d.abort(T instanceof k ? T : new at(T instanceof Error ? T.message : T));
        }
      };
      let g = i && setTimeout(() => {
        g = null, w(new k(`timeout ${i} of ms exceeded`, k.ETIMEDOUT));
      }, i);
      const S = () => {
        r && (g && clearTimeout(g), g = null, r.forEach((x) => {
          x.unsubscribe ? x.unsubscribe(w) : x.removeEventListener("abort", w);
        }), r = null);
      };
      r.forEach((x) => x.addEventListener("abort", w));
      const { signal: C } = d;
      return C.unsubscribe = () => _.asap(S), C;
    }
  };
  const Ti = function* (r, i) {
    let u = r.byteLength;
    if (u < i) {
      yield r;
      return;
    }
    let d = 0, p;
    for (; d < u; )
      p = d + i, yield r.slice(d, p), d = p;
  }, Oi = async function* (r, i) {
    for await (const u of xi(r))
      yield* Ti(u, i);
  }, xi = async function* (r) {
    if (r[Symbol.asyncIterator]) {
      yield* r;
      return;
    }
    const i = r.getReader();
    try {
      for (; ; ) {
        const { done: u, value: d } = await i.read();
        if (u)
          break;
        yield d;
      }
    } finally {
      await i.cancel();
    }
  }, vs = (r, i, u, d) => {
    const p = Oi(r, i);
    let w = 0, g, S = (C) => {
      g || (g = !0, d && d(C));
    };
    return new ReadableStream({
      async pull(C) {
        try {
          const { done: x, value: T } = await p.next();
          if (x) {
            S(), C.close();
            return;
          }
          let D = T.byteLength;
          if (u) {
            let J = w += D;
            u(J);
          }
          C.enqueue(new Uint8Array(T));
        } catch (x) {
          throw S(x), x;
        }
      },
      cancel(C) {
        return S(C), p.return();
      }
    }, {
      highWaterMark: 2
    });
  }, Es = 64 * 1024, { isFunction: Bt } = _, Ai = (({ Request: r, Response: i }) => ({
    Request: r,
    Response: i
  }))(_.global), {
    ReadableStream: Ss,
    TextEncoder: Rs
  } = _.global, Ts = (r, ...i) => {
    try {
      return !!r(...i);
    } catch {
      return !1;
    }
  }, Ci = (r) => {
    r = _.merge.call({
      skipUndefined: !0
    }, Ai, r);
    const { fetch: i, Request: u, Response: d } = r, p = i ? Bt(i) : typeof fetch == "function", w = Bt(u), g = Bt(d);
    if (!p)
      return !1;
    const S = p && Bt(Ss), C = p && (typeof Rs == "function" ? /* @__PURE__ */ ((O) => (N) => O.encode(N))(new Rs()) : async (O) => new Uint8Array(await new u(O).arrayBuffer())), x = w && S && Ts(() => {
      let O = !1;
      const N = new u(he.origin, {
        body: new Ss(),
        method: "POST",
        get duplex() {
          return O = !0, "half";
        }
      }).headers.has("Content-Type");
      return O && !N;
    }), T = g && S && Ts(() => _.isReadableStream(new d("").body)), D = {
      stream: T && ((O) => O.body)
    };
    p && ["text", "arrayBuffer", "blob", "formData", "stream"].forEach((O) => {
      !D[O] && (D[O] = (N, L) => {
        let ae = N && N[O];
        if (ae)
          return ae.call(N);
        throw new k(`Response type '${O}' is not supported`, k.ERR_NOT_SUPPORT, L);
      });
    });
    const J = async (O) => {
      if (O == null)
        return 0;
      if (_.isBlob(O))
        return O.size;
      if (_.isSpecCompliantForm(O))
        return (await new u(he.origin, {
          method: "POST",
          body: O
        }).arrayBuffer()).byteLength;
      if (_.isArrayBufferView(O) || _.isArrayBuffer(O))
        return O.byteLength;
      if (_.isURLSearchParams(O) && (O = O + ""), _.isString(O))
        return (await C(O)).byteLength;
    }, de = async (O, N) => {
      const L = _.toFiniteNumber(O.getContentLength());
      return L ?? J(N);
    };
    return async (O) => {
      let {
        url: N,
        method: L,
        data: ae,
        signal: ve,
        cancelToken: ue,
        timeout: ye,
        onDownloadProgress: xe,
        onUploadProgress: nt,
        responseType: Ee,
        headers: vn,
        withCredentials: jt = "same-origin",
        fetchOptions: ks
      } = _s(O), Fs = i || fetch;
      Ee = Ee ? (Ee + "").toLowerCase() : "text";
      let Mt = Ri([ve, ue && ue.toAbortSignal()], ye), yt = null;
      const st = Mt && Mt.unsubscribe && (() => {
        Mt.unsubscribe();
      });
      let Bs;
      try {
        if (nt && x && L !== "get" && L !== "head" && (Bs = await de(vn, ae)) !== 0) {
          let Ke = new u(N, {
            method: "POST",
            body: ae,
            duplex: "half"
          }), ct;
          if (_.isFormData(ae) && (ct = Ke.headers.get("content-type")) && vn.setContentType(ct), Ke.body) {
            const [En, Vt] = ys(
              Bs,
              Ft(gs(nt))
            );
            ae = vs(Ke.body, Es, En, Vt);
          }
        }
        _.isString(jt) || (jt = jt ? "include" : "omit");
        const Ue = w && "credentials" in u.prototype, Ps = {
          ...ks,
          signal: Mt,
          method: L.toUpperCase(),
          headers: vn.normalize().toJSON(),
          body: ae,
          duplex: "half",
          credentials: Ue ? jt : void 0
        };
        yt = w && new u(N, Ps);
        let Je = await (w ? Fs(yt, ks) : Fs(N, Ps));
        const Us = T && (Ee === "stream" || Ee === "response");
        if (T && (xe || Us && st)) {
          const Ke = {};
          ["status", "statusText", "headers"].forEach((qs) => {
            Ke[qs] = Je[qs];
          });
          const ct = _.toFiniteNumber(Je.headers.get("content-length")), [En, Vt] = xe && ys(
            ct,
            Ft(gs(xe), !0)
          ) || [];
          Je = new d(
            vs(Je.body, Es, En, () => {
              Vt && Vt(), st && st();
            }),
            Ke
          );
        }
        Ee = Ee || "text";
        let Ui = await D[_.findKey(D, Ee) || "text"](Je, O);
        return !Us && st && st(), await new Promise((Ke, ct) => {
          ms(Ke, ct, {
            data: Ui,
            headers: Oe.from(Je.headers),
            status: Je.status,
            statusText: Je.statusText,
            config: O,
            request: yt
          });
        });
      } catch (Ue) {
        throw st && st(), Ue && Ue.name === "TypeError" && /Load failed|fetch/i.test(Ue.message) ? Object.assign(
          new k("Network Error", k.ERR_NETWORK, O, yt),
          {
            cause: Ue.cause || Ue
          }
        ) : k.from(Ue, Ue && Ue.code, O, yt);
      }
    };
  }, Li = /* @__PURE__ */ new Map(), Os = (r) => {
    let i = r ? r.env : {};
    const { fetch: u, Request: d, Response: p } = i, w = [
      d,
      p,
      u
    ];
    let g = w.length, S = g, C, x, T = Li;
    for (; S--; )
      C = w[S], x = T.get(C), x === void 0 && T.set(C, x = S ? /* @__PURE__ */ new Map() : Ci(i)), T = x;
    return x;
  };
  Os();
  const gn = {
    http: Jr,
    xhr: Si,
    fetch: {
      get: Os
    }
  };
  _.forEach(gn, (r, i) => {
    if (r) {
      try {
        Object.defineProperty(r, "name", { value: i });
      } catch {
      }
      Object.defineProperty(r, "adapterName", { value: i });
    }
  });
  const xs = (r) => `- ${r}`, Di = (r) => _.isFunction(r) || r === null || r === !1;
  var As = {
    getAdapter: (r, i) => {
      r = _.isArray(r) ? r : [r];
      const { length: u } = r;
      let d, p;
      const w = {};
      for (let g = 0; g < u; g++) {
        d = r[g];
        let S;
        if (p = d, !Di(d) && (p = gn[(S = String(d)).toLowerCase()], p === void 0))
          throw new k(`Unknown adapter '${S}'`);
        if (p && (_.isFunction(p) || (p = p.get(i))))
          break;
        w[S || "#" + g] = p;
      }
      if (!p) {
        const g = Object.entries(w).map(
          ([C, x]) => `adapter ${C} ` + (x === !1 ? "is not supported by the environment" : "is not available in the build")
        );
        let S = u ? g.length > 1 ? `since :
` + g.map(xs).join(`
`) : " " + xs(g[0]) : "as no adapter specified";
        throw new k(
          "There is no suitable adapter to dispatch the request " + S,
          "ERR_NOT_SUPPORT"
        );
      }
      return p;
    },
    adapters: gn
  };
  function wn(r) {
    if (r.cancelToken && r.cancelToken.throwIfRequested(), r.signal && r.signal.aborted)
      throw new at(null, r);
  }
  function Cs(r) {
    return wn(r), r.headers = Oe.from(r.headers), r.data = yn.call(
      r,
      r.transformRequest
    ), ["post", "put", "patch"].indexOf(r.method) !== -1 && r.headers.setContentType("application/x-www-form-urlencoded", !1), As.getAdapter(r.adapter || pn.adapter, r)(r).then(function(d) {
      return wn(r), d.data = yn.call(
        r,
        r.transformResponse,
        d
      ), d.headers = Oe.from(d.headers), d;
    }, function(d) {
      return ps(d) || (wn(r), d && d.response && (d.response.data = yn.call(
        r,
        r.transformResponse,
        d.response
      ), d.response.headers = Oe.from(d.response.headers))), Promise.reject(d);
    });
  }
  const Ls = "1.12.2", Pt = {};
  ["object", "boolean", "number", "function", "string", "symbol"].forEach((r, i) => {
    Pt[r] = function(d) {
      return typeof d === r || "a" + (i < 1 ? "n " : " ") + r;
    };
  });
  const Ds = {};
  Pt.transitional = function(i, u, d) {
    function p(w, g) {
      return "[Axios v" + Ls + "] Transitional option '" + w + "'" + g + (d ? ". " + d : "");
    }
    return (w, g, S) => {
      if (i === !1)
        throw new k(
          p(g, " has been removed" + (u ? " in " + u : "")),
          k.ERR_DEPRECATED
        );
      return u && !Ds[g] && (Ds[g] = !0, console.warn(
        p(
          g,
          " has been deprecated since v" + u + " and will be removed in the near future"
        )
      )), i ? i(w, g, S) : !0;
    };
  }, Pt.spelling = function(i) {
    return (u, d) => (console.warn(`${d} is likely a misspelling of ${i}`), !0);
  };
  function Ni(r, i, u) {
    if (typeof r != "object")
      throw new k("options must be an object", k.ERR_BAD_OPTION_VALUE);
    const d = Object.keys(r);
    let p = d.length;
    for (; p-- > 0; ) {
      const w = d[p], g = i[w];
      if (g) {
        const S = r[w], C = S === void 0 || g(S, w, r);
        if (C !== !0)
          throw new k("option " + w + " must be " + C, k.ERR_BAD_OPTION_VALUE);
        continue;
      }
      if (u !== !0)
        throw new k("Unknown option " + w, k.ERR_BAD_OPTION);
    }
  }
  var Ut = {
    assertOptions: Ni,
    validators: Pt
  };
  const Pe = Ut.validators;
  class qt {
    constructor(i) {
      this.defaults = i || {}, this.interceptors = {
        request: new ls(),
        response: new ls()
      };
    }
    /**
     * Dispatch a request
     *
     * @param {String|Object} configOrUrl The config specific for this request (merged with this.defaults)
     * @param {?Object} config
     *
     * @returns {Promise} The Promise to be fulfilled
     */
    async request(i, u) {
      try {
        return await this._request(i, u);
      } catch (d) {
        if (d instanceof Error) {
          let p = {};
          Error.captureStackTrace ? Error.captureStackTrace(p) : p = new Error();
          const w = p.stack ? p.stack.replace(/^.+\n/, "") : "";
          try {
            d.stack ? w && !String(d.stack).endsWith(w.replace(/^.+\n.+\n/, "")) && (d.stack += `
` + w) : d.stack = w;
          } catch {
          }
        }
        throw d;
      }
    }
    _request(i, u) {
      typeof i == "string" ? (u = u || {}, u.url = i) : u = i || {}, u = tt(this.defaults, u);
      const { transitional: d, paramsSerializer: p, headers: w } = u;
      d !== void 0 && Ut.assertOptions(d, {
        silentJSONParsing: Pe.transitional(Pe.boolean),
        forcedJSONParsing: Pe.transitional(Pe.boolean),
        clarifyTimeoutError: Pe.transitional(Pe.boolean)
      }, !1), p != null && (_.isFunction(p) ? u.paramsSerializer = {
        serialize: p
      } : Ut.assertOptions(p, {
        encode: Pe.function,
        serialize: Pe.function
      }, !0)), u.allowAbsoluteUrls !== void 0 || (this.defaults.allowAbsoluteUrls !== void 0 ? u.allowAbsoluteUrls = this.defaults.allowAbsoluteUrls : u.allowAbsoluteUrls = !0), Ut.assertOptions(u, {
        baseUrl: Pe.spelling("baseURL"),
        withXsrfToken: Pe.spelling("withXSRFToken")
      }, !0), u.method = (u.method || this.defaults.method || "get").toLowerCase();
      let g = w && _.merge(
        w.common,
        w[u.method]
      );
      w && _.forEach(
        ["delete", "get", "head", "post", "put", "patch", "common"],
        (O) => {
          delete w[O];
        }
      ), u.headers = Oe.concat(g, w);
      const S = [];
      let C = !0;
      this.interceptors.request.forEach(function(N) {
        typeof N.runWhen == "function" && N.runWhen(u) === !1 || (C = C && N.synchronous, S.unshift(N.fulfilled, N.rejected));
      });
      const x = [];
      this.interceptors.response.forEach(function(N) {
        x.push(N.fulfilled, N.rejected);
      });
      let T, D = 0, J;
      if (!C) {
        const O = [Cs.bind(this), void 0];
        for (O.unshift(...S), O.push(...x), J = O.length, T = Promise.resolve(u); D < J; )
          T = T.then(O[D++], O[D++]);
        return T;
      }
      J = S.length;
      let de = u;
      for (; D < J; ) {
        const O = S[D++], N = S[D++];
        try {
          de = O(de);
        } catch (L) {
          N.call(this, L);
          break;
        }
      }
      try {
        T = Cs.call(this, de);
      } catch (O) {
        return Promise.reject(O);
      }
      for (D = 0, J = x.length; D < J; )
        T = T.then(x[D++], x[D++]);
      return T;
    }
    getUri(i) {
      i = tt(this.defaults, i);
      const u = ws(i.baseURL, i.url, i.allowAbsoluteUrls);
      return us(u, i.params, i.paramsSerializer);
    }
  }
  _.forEach(["delete", "get", "head", "options"], function(i) {
    qt.prototype[i] = function(u, d) {
      return this.request(tt(d || {}, {
        method: i,
        url: u,
        data: (d || {}).data
      }));
    };
  }), _.forEach(["post", "put", "patch"], function(i) {
    function u(d) {
      return function(w, g, S) {
        return this.request(tt(S || {}, {
          method: i,
          headers: d ? {
            "Content-Type": "multipart/form-data"
          } : {},
          url: w,
          data: g
        }));
      };
    }
    qt.prototype[i] = u(), qt.prototype[i + "Form"] = u(!0);
  });
  var It = qt;
  class bn {
    constructor(i) {
      if (typeof i != "function")
        throw new TypeError("executor must be a function.");
      let u;
      this.promise = new Promise(function(w) {
        u = w;
      });
      const d = this;
      this.promise.then((p) => {
        if (!d._listeners) return;
        let w = d._listeners.length;
        for (; w-- > 0; )
          d._listeners[w](p);
        d._listeners = null;
      }), this.promise.then = (p) => {
        let w;
        const g = new Promise((S) => {
          d.subscribe(S), w = S;
        }).then(p);
        return g.cancel = function() {
          d.unsubscribe(w);
        }, g;
      }, i(function(w, g, S) {
        d.reason || (d.reason = new at(w, g, S), u(d.reason));
      });
    }
    /**
     * Throws a `CanceledError` if cancellation has been requested.
     */
    throwIfRequested() {
      if (this.reason)
        throw this.reason;
    }
    /**
     * Subscribe to the cancel signal
     */
    subscribe(i) {
      if (this.reason) {
        i(this.reason);
        return;
      }
      this._listeners ? this._listeners.push(i) : this._listeners = [i];
    }
    /**
     * Unsubscribe from the cancel signal
     */
    unsubscribe(i) {
      if (!this._listeners)
        return;
      const u = this._listeners.indexOf(i);
      u !== -1 && this._listeners.splice(u, 1);
    }
    toAbortSignal() {
      const i = new AbortController(), u = (d) => {
        i.abort(d);
      };
      return this.subscribe(u), i.signal.unsubscribe = () => this.unsubscribe(u), i.signal;
    }
    /**
     * Returns an object that contains a new `CancelToken` and a function that, when called,
     * cancels the `CancelToken`.
     */
    static source() {
      let i;
      return {
        token: new bn(function(p) {
          i = p;
        }),
        cancel: i
      };
    }
  }
  var ki = bn;
  function Fi(r) {
    return function(u) {
      return r.apply(null, u);
    };
  }
  function Bi(r) {
    return _.isObject(r) && r.isAxiosError === !0;
  }
  const _n = {
    Continue: 100,
    SwitchingProtocols: 101,
    Processing: 102,
    EarlyHints: 103,
    Ok: 200,
    Created: 201,
    Accepted: 202,
    NonAuthoritativeInformation: 203,
    NoContent: 204,
    ResetContent: 205,
    PartialContent: 206,
    MultiStatus: 207,
    AlreadyReported: 208,
    ImUsed: 226,
    MultipleChoices: 300,
    MovedPermanently: 301,
    Found: 302,
    SeeOther: 303,
    NotModified: 304,
    UseProxy: 305,
    Unused: 306,
    TemporaryRedirect: 307,
    PermanentRedirect: 308,
    BadRequest: 400,
    Unauthorized: 401,
    PaymentRequired: 402,
    Forbidden: 403,
    NotFound: 404,
    MethodNotAllowed: 405,
    NotAcceptable: 406,
    ProxyAuthenticationRequired: 407,
    RequestTimeout: 408,
    Conflict: 409,
    Gone: 410,
    LengthRequired: 411,
    PreconditionFailed: 412,
    PayloadTooLarge: 413,
    UriTooLong: 414,
    UnsupportedMediaType: 415,
    RangeNotSatisfiable: 416,
    ExpectationFailed: 417,
    ImATeapot: 418,
    MisdirectedRequest: 421,
    UnprocessableEntity: 422,
    Locked: 423,
    FailedDependency: 424,
    TooEarly: 425,
    UpgradeRequired: 426,
    PreconditionRequired: 428,
    TooManyRequests: 429,
    RequestHeaderFieldsTooLarge: 431,
    UnavailableForLegalReasons: 451,
    InternalServerError: 500,
    NotImplemented: 501,
    BadGateway: 502,
    ServiceUnavailable: 503,
    GatewayTimeout: 504,
    HttpVersionNotSupported: 505,
    VariantAlsoNegotiates: 506,
    InsufficientStorage: 507,
    LoopDetected: 508,
    NotExtended: 510,
    NetworkAuthenticationRequired: 511
  };
  Object.entries(_n).forEach(([r, i]) => {
    _n[i] = r;
  });
  var Pi = _n;
  function Ns(r) {
    const i = new It(r), u = t(It.prototype.request, i);
    return _.extend(u, It.prototype, i, { allOwnKeys: !0 }), _.extend(u, i, null, { allOwnKeys: !0 }), u.create = function(p) {
      return Ns(tt(r, p));
    }, u;
  }
  const te = Ns(pn);
  return te.Axios = It, te.CanceledError = at, te.CancelToken = ki, te.isCancel = ps, te.VERSION = Ls, te.toFormData = Dt, te.AxiosError = k, te.Cancel = te.CanceledError, te.all = function(i) {
    return Promise.all(i);
  }, te.spread = Fi, te.isAxiosError = Bi, te.mergeConfig = tt, te.AxiosHeaders = Oe, te.formToJSON = (r) => hs(_.isHTMLForm(r) ? new FormData(r) : r), te.getAdapter = As.getAdapter, te.HttpStatusCode = Pi, te.default = te, Sn = te, Sn;
}
var $s;
function gr() {
  if ($s) return Ve;
  $s = 1;
  var t = Ve && Ve.__assign || function() {
    return t = Object.assign || function(a) {
      for (var c, o = 1, h = arguments.length; o < h; o++) {
        c = arguments[o];
        for (var f in c) Object.prototype.hasOwnProperty.call(c, f) && (a[f] = c[f]);
      }
      return a;
    }, t.apply(this, arguments);
  };
  Object.defineProperty(Ve, "__esModule", { value: !0 }), Ve.getRequestHeaders = Ve.getAxiosClient = void 0;
  var e = /* @__PURE__ */ Hi();
  function n(a, c, o, h, f) {
    var l = e.default.create({
      baseURL: a,
      headers: s(c, h, o, a, f),
      withCredentials: !0
    });
    return l.interceptors.request.use(function(m) {
      return typeof window < "u" && window.csrf_token && window.csrf_token !== "{{ csrf_token }}" && (m.headers["X-Frappe-CSRF-Token"] = window.csrf_token), c && h && o && (m.headers.Authorization = "".concat(h, " ").concat(o())), m;
    }), l;
  }
  Ve.getAxiosClient = n;
  function s(a, c, o, h, f) {
    a === void 0 && (a = !1);
    var l = {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8"
    };
    return a && c && o && (l.Authorization = "".concat(c, " ").concat(o())), typeof window < "u" && typeof document < "u" && (window.location && (h && h !== window.location.origin || (l["X-Frappe-Site-Name"] = window.location.hostname)), window.csrf_token && window.csrf_token !== "{{ csrf_token }}" && (l["X-Frappe-CSRF-Token"] = window.csrf_token)), t(t({}, l), f ?? {});
  }
  return Ve.getRequestHeaders = s, Ve;
}
var Hs;
function wr() {
  if (Hs) return Le;
  Hs = 1;
  var t = Le && Le.__assign || function() {
    return t = Object.assign || function(c) {
      for (var o, h = 1, f = arguments.length; h < f; h++) {
        o = arguments[h];
        for (var l in o) Object.prototype.hasOwnProperty.call(o, l) && (c[l] = o[l]);
      }
      return c;
    }, t.apply(this, arguments);
  }, e = Le && Le.__awaiter || function(c, o, h, f) {
    function l(m) {
      return m instanceof h ? m : new h(function(b) {
        b(m);
      });
    }
    return new (h || (h = Promise))(function(m, b) {
      function E(R) {
        try {
          v(f.next(R));
        } catch (U) {
          b(U);
        }
      }
      function y(R) {
        try {
          v(f.throw(R));
        } catch (U) {
          b(U);
        }
      }
      function v(R) {
        R.done ? m(R.value) : l(R.value).then(E, y);
      }
      v((f = f.apply(c, o || [])).next());
    });
  }, n = Le && Le.__generator || function(c, o) {
    var h = { label: 0, sent: function() {
      if (m[0] & 1) throw m[1];
      return m[1];
    }, trys: [], ops: [] }, f, l, m, b;
    return b = { next: E(0), throw: E(1), return: E(2) }, typeof Symbol == "function" && (b[Symbol.iterator] = function() {
      return this;
    }), b;
    function E(v) {
      return function(R) {
        return y([v, R]);
      };
    }
    function y(v) {
      if (f) throw new TypeError("Generator is already executing.");
      for (; b && (b = 0, v[0] && (h = 0)), h; ) try {
        if (f = 1, l && (m = v[0] & 2 ? l.return : v[0] ? l.throw || ((m = l.return) && m.call(l), 0) : l.next) && !(m = m.call(l, v[1])).done) return m;
        switch (l = 0, m && (v = [v[0] & 2, m.value]), v[0]) {
          case 0:
          case 1:
            m = v;
            break;
          case 4:
            return h.label++, { value: v[1], done: !1 };
          case 5:
            h.label++, l = v[1], v = [0];
            continue;
          case 7:
            v = h.ops.pop(), h.trys.pop();
            continue;
          default:
            if (m = h.trys, !(m = m.length > 0 && m[m.length - 1]) && (v[0] === 6 || v[0] === 2)) {
              h = 0;
              continue;
            }
            if (v[0] === 3 && (!m || v[1] > m[0] && v[1] < m[3])) {
              h.label = v[1];
              break;
            }
            if (v[0] === 6 && h.label < m[1]) {
              h.label = m[1], m = v;
              break;
            }
            if (m && h.label < m[2]) {
              h.label = m[2], h.ops.push(v);
              break;
            }
            m[2] && h.ops.pop(), h.trys.pop();
            continue;
        }
        v = o.call(c, h);
      } catch (R) {
        v = [6, R], l = 0;
      } finally {
        f = m = 0;
      }
      if (v[0] & 5) throw v[1];
      return { value: v[0] ? v[1] : void 0, done: !0 };
    }
  };
  Object.defineProperty(Le, "__esModule", { value: !0 }), Le.FrappeFileUpload = void 0;
  var s = gr(), a = (
    /** @class */
    function() {
      function c(o, h, f, l, m, b) {
        this.appURL = o, this.axios = h, this.useToken = f ?? !1, this.token = l, this.tokenType = m, this.customHeaders = b;
      }
      return c.prototype.uploadFile = function(o, h, f, l) {
        return l === void 0 && (l = "upload_file"), e(this, void 0, void 0, function() {
          var m, b, E, y, v, R, U, A;
          return n(this, function(K) {
            return m = new FormData(), o && m.append("file", o, o.name), b = h.isPrivate, E = h.folder, y = h.file_url, v = h.doctype, R = h.docname, U = h.fieldname, A = h.otherData, b && m.append("is_private", "1"), E && m.append("folder", E), y && m.append("file_url", y), v && R && (m.append("doctype", v), m.append("docname", R), U && m.append("fieldname", U)), A && Object.keys(A).forEach(function(G) {
              var H = A[G];
              m.append(G, H);
            }), [2, this.axios.post("/api/method/".concat(l), m, {
              onUploadProgress: function(G) {
                f && f(G.loaded, G.total, G);
              },
              headers: t(t({}, (0, s.getRequestHeaders)(this.useToken, this.tokenType, this.token, this.appURL, this.customHeaders)), { "Content-Type": "multipart/form-data" })
            }).catch(function(G) {
              var H, q;
              throw t(t({}, G.response.data), { httpStatus: G.response.status, httpStatusText: G.response.statusText, message: (H = G.response.data.message) !== null && H !== void 0 ? H : "There was an error while uploading the file.", exception: (q = G.response.data.exception) !== null && q !== void 0 ? q : "" });
            })];
          });
        });
      }, c;
    }()
  );
  return Le.FrappeFileUpload = a, Le;
}
var Ws;
function Wi() {
  if (Ws) return gt;
  Ws = 1, Object.defineProperty(gt, "__esModule", { value: !0 }), gt.FrappeApp = void 0;
  var t = br(), e = mr(), n = yr(), s = wr(), a = gr(), c = (
    /** @class */
    function() {
      function o(h, f, l, m) {
        var b, E;
        this.url = h, this.name = l ?? "FrappeApp", this.useToken = (b = f == null ? void 0 : f.useToken) !== null && b !== void 0 ? b : !1, this.token = f == null ? void 0 : f.token, this.tokenType = (E = f == null ? void 0 : f.type) !== null && E !== void 0 ? E : "Bearer", this.customHeaders = m, this.axios = (0, a.getAxiosClient)(this.url, this.useToken, this.token, this.tokenType, this.customHeaders);
      }
      return o.prototype.auth = function() {
        return new t.FrappeAuth(this.url, this.axios, this.useToken, this.token, this.tokenType);
      }, o.prototype.db = function() {
        return new n.FrappeDB(this.url, this.axios, this.useToken, this.token, this.tokenType);
      }, o.prototype.file = function() {
        return new s.FrappeFileUpload(this.url, this.axios, this.useToken, this.token, this.tokenType, this.customHeaders);
      }, o.prototype.call = function() {
        return new e.FrappeCall(this.url, this.axios, this.useToken, this.token, this.tokenType);
      }, o;
    }()
  );
  return gt.FrappeApp = c, gt;
}
var De = {}, zs;
function zi() {
  if (zs) return De;
  zs = 1;
  var t = De && De.__assign || function() {
    return t = Object.assign || function(a) {
      for (var c, o = 1, h = arguments.length; o < h; o++) {
        c = arguments[o];
        for (var f in c) Object.prototype.hasOwnProperty.call(c, f) && (a[f] = c[f]);
      }
      return a;
    }, t.apply(this, arguments);
  }, e = De && De.__awaiter || function(a, c, o, h) {
    function f(l) {
      return l instanceof o ? l : new o(function(m) {
        m(l);
      });
    }
    return new (o || (o = Promise))(function(l, m) {
      function b(v) {
        try {
          y(h.next(v));
        } catch (R) {
          m(R);
        }
      }
      function E(v) {
        try {
          y(h.throw(v));
        } catch (R) {
          m(R);
        }
      }
      function y(v) {
        v.done ? l(v.value) : f(v.value).then(b, E);
      }
      y((h = h.apply(a, c || [])).next());
    });
  }, n = De && De.__generator || function(a, c) {
    var o = { label: 0, sent: function() {
      if (l[0] & 1) throw l[1];
      return l[1];
    }, trys: [], ops: [] }, h, f, l, m;
    return m = { next: b(0), throw: b(1), return: b(2) }, typeof Symbol == "function" && (m[Symbol.iterator] = function() {
      return this;
    }), m;
    function b(y) {
      return function(v) {
        return E([y, v]);
      };
    }
    function E(y) {
      if (h) throw new TypeError("Generator is already executing.");
      for (; m && (m = 0, y[0] && (o = 0)), o; ) try {
        if (h = 1, f && (l = y[0] & 2 ? f.return : y[0] ? f.throw || ((l = f.return) && l.call(f), 0) : f.next) && !(l = l.call(f, y[1])).done) return l;
        switch (f = 0, l && (y = [y[0] & 2, l.value]), y[0]) {
          case 0:
          case 1:
            l = y;
            break;
          case 4:
            return o.label++, { value: y[1], done: !1 };
          case 5:
            o.label++, f = y[1], y = [0];
            continue;
          case 7:
            y = o.ops.pop(), o.trys.pop();
            continue;
          default:
            if (l = o.trys, !(l = l.length > 0 && l[l.length - 1]) && (y[0] === 6 || y[0] === 2)) {
              o = 0;
              continue;
            }
            if (y[0] === 3 && (!l || y[1] > l[0] && y[1] < l[3])) {
              o.label = y[1];
              break;
            }
            if (y[0] === 6 && o.label < l[1]) {
              o.label = l[1], l = y;
              break;
            }
            if (l && o.label < l[2]) {
              o.label = l[2], o.ops.push(y);
              break;
            }
            l[2] && o.ops.pop(), o.trys.pop();
            continue;
        }
        y = c.call(a, o);
      } catch (v) {
        y = [6, v], f = 0;
      } finally {
        h = l = 0;
      }
      if (y[0] & 5) throw y[1];
      return { value: y[0] ? y[1] : void 0, done: !0 };
    }
  };
  Object.defineProperty(De, "__esModule", { value: !0 }), De.FrappeAuth = void 0;
  var s = (
    /** @class */
    function() {
      function a(c, o, h, f, l) {
        this.appURL = c, this.axios = o, this.useToken = h ?? !1, this.token = f, this.tokenType = l;
      }
      return a.prototype.loginWithUsernamePassword = function(c) {
        return e(this, void 0, void 0, function() {
          return n(this, function(o) {
            return [2, this.axios.post("/api/method/login", {
              usr: c.username,
              pwd: c.password,
              otp: c.otp,
              tmp_id: c.tmp_id,
              device: c.device
            }).then(function(h) {
              return h.data;
            }).catch(function(h) {
              var f, l;
              throw t(t({}, h.response.data), { httpStatus: h.response.status, httpStatusText: h.response.statusText, message: (f = h.response.data.message) !== null && f !== void 0 ? f : "There was an error while logging in", exception: (l = h.response.data.exception) !== null && l !== void 0 ? l : "" });
            })];
          });
        });
      }, a.prototype.getLoggedInUser = function() {
        return e(this, void 0, void 0, function() {
          return n(this, function(c) {
            return [2, this.axios.get("/api/method/frappe.auth.get_logged_user").then(function(o) {
              return o.data.message;
            }).catch(function(o) {
              var h;
              throw t(t({}, o.response.data), { httpStatus: o.response.status, httpStatusText: o.response.statusText, message: "There was an error while fetching the logged in user", exception: (h = o.response.data.exception) !== null && h !== void 0 ? h : "" });
            })];
          });
        });
      }, a.prototype.logout = function() {
        return e(this, void 0, void 0, function() {
          return n(this, function(c) {
            return [2, this.axios.post("/api/method/logout", {}).then(function() {
            }).catch(function(o) {
              var h, f;
              throw t(t({}, o.response.data), { httpStatus: o.response.status, httpStatusText: o.response.statusText, message: (h = o.response.data.message) !== null && h !== void 0 ? h : "There was an error while logging out", exception: (f = o.response.data.exception) !== null && f !== void 0 ? f : "" });
            })];
          });
        });
      }, a.prototype.forgetPassword = function(c) {
        return e(this, void 0, void 0, function() {
          return n(this, function(o) {
            return [2, this.axios.post("/", {
              cmd: "frappe.core.doctype.user.user.reset_password",
              user: c
            }).then(function() {
            }).catch(function(h) {
              var f, l;
              throw t(t({}, h.response.data), { httpStatus: h.response.status, httpStatusText: h.response.statusText, message: (f = h.response.data.message) !== null && f !== void 0 ? f : "There was an error sending password reset email.", exception: (l = h.response.data.exception) !== null && l !== void 0 ? l : "" });
            })];
          });
        });
      }, a;
    }()
  );
  return De.FrappeAuth = s, De;
}
var Js;
function br() {
  return Js || (Js = 1, function(t) {
    var e = rt && rt.__createBinding || (Object.create ? function(s, a, c, o) {
      o === void 0 && (o = c);
      var h = Object.getOwnPropertyDescriptor(a, c);
      (!h || ("get" in h ? !a.__esModule : h.writable || h.configurable)) && (h = { enumerable: !0, get: function() {
        return a[c];
      } }), Object.defineProperty(s, o, h);
    } : function(s, a, c, o) {
      o === void 0 && (o = c), s[o] = a[c];
    }), n = rt && rt.__exportStar || function(s, a) {
      for (var c in s) c !== "default" && !Object.prototype.hasOwnProperty.call(a, c) && e(a, s, c);
    };
    Object.defineProperty(t, "__esModule", { value: !0 }), n(Wi(), t), n(zi(), t), n(yr(), t), n(wr(), t), n(mr(), t);
  }(rt)), rt;
}
var Ji = br(), $t = { exports: {} }, Rn = {};
/**
 * @license React
 * use-sync-external-store-shim.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Ks;
function Ki() {
  if (Ks) return Rn;
  Ks = 1;
  var t = St;
  function e(b, E) {
    return b === E && (b !== 0 || 1 / b === 1 / E) || b !== b && E !== E;
  }
  var n = typeof Object.is == "function" ? Object.is : e, s = t.useState, a = t.useEffect, c = t.useLayoutEffect, o = t.useDebugValue;
  function h(b, E) {
    var y = E(), v = s({ inst: { value: y, getSnapshot: E } }), R = v[0].inst, U = v[1];
    return c(
      function() {
        R.value = y, R.getSnapshot = E, f(R) && U({ inst: R });
      },
      [b, y, E]
    ), a(
      function() {
        return f(R) && U({ inst: R }), b(function() {
          f(R) && U({ inst: R });
        });
      },
      [b]
    ), o(y), y;
  }
  function f(b) {
    var E = b.getSnapshot;
    b = b.value;
    try {
      var y = E();
      return !n(b, y);
    } catch {
      return !0;
    }
  }
  function l(b, E) {
    return E();
  }
  var m = typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u" ? l : h;
  return Rn.useSyncExternalStore = t.useSyncExternalStore !== void 0 ? t.useSyncExternalStore : m, Rn;
}
var Tn = {};
/**
 * @license React
 * use-sync-external-store-shim.development.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Gs;
function Gi() {
  return Gs || (Gs = 1, process.env.NODE_ENV !== "production" && function() {
    function t(y, v) {
      return y === v && (y !== 0 || 1 / y === 1 / v) || y !== y && v !== v;
    }
    function e(y, v) {
      m || a.startTransition === void 0 || (m = !0, console.error(
        "You are using an outdated, pre-release alpha of React 18 that does not support useSyncExternalStore. The use-sync-external-store shim will not work correctly. Upgrade to a newer pre-release."
      ));
      var R = v();
      if (!b) {
        var U = v();
        c(R, U) || (console.error(
          "The result of getSnapshot should be cached to avoid an infinite loop"
        ), b = !0);
      }
      U = o({
        inst: { value: R, getSnapshot: v }
      });
      var A = U[0].inst, K = U[1];
      return f(
        function() {
          A.value = R, A.getSnapshot = v, n(A) && K({ inst: A });
        },
        [y, R, v]
      ), h(
        function() {
          return n(A) && K({ inst: A }), y(function() {
            n(A) && K({ inst: A });
          });
        },
        [y]
      ), l(R), R;
    }
    function n(y) {
      var v = y.getSnapshot;
      y = y.value;
      try {
        var R = v();
        return !c(y, R);
      } catch {
        return !0;
      }
    }
    function s(y, v) {
      return v();
    }
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart == "function" && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
    var a = St, c = typeof Object.is == "function" ? Object.is : t, o = a.useState, h = a.useEffect, f = a.useLayoutEffect, l = a.useDebugValue, m = !1, b = !1, E = typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u" ? s : e;
    Tn.useSyncExternalStore = a.useSyncExternalStore !== void 0 ? a.useSyncExternalStore : E, typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop == "function" && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
  }()), Tn;
}
var Xs;
function Xi() {
  return Xs || (Xs = 1, process.env.NODE_ENV === "production" ? $t.exports = Ki() : $t.exports = Gi()), $t.exports;
}
var _r = Xi();
const vr = 0, Er = 1, Sr = 2, Ys = 3;
var Qs = Object.prototype.hasOwnProperty;
function Bn(t, e) {
  var n, s;
  if (t === e) return !0;
  if (t && e && (n = t.constructor) === e.constructor) {
    if (n === Date) return t.getTime() === e.getTime();
    if (n === RegExp) return t.toString() === e.toString();
    if (n === Array) {
      if ((s = t.length) === e.length)
        for (; s-- && Bn(t[s], e[s]); ) ;
      return s === -1;
    }
    if (!n || typeof t == "object") {
      s = 0;
      for (n in t)
        if (Qs.call(t, n) && ++s && !Qs.call(e, n) || !(n in e) || !Bn(t[n], e[n])) return !1;
      return Object.keys(e).length === s;
    }
  }
  return t !== t && e !== e;
}
const ke = /* @__PURE__ */ new WeakMap(), Ye = () => {
}, ne = (
  /*#__NOINLINE__*/
  Ye()
), en = Object, B = (t) => t === ne, Re = (t) => typeof t == "function", $e = (t, e) => ({
  ...t,
  ...e
}), Rr = (t) => Re(t.then), On = {}, Ht = {}, Qn = "undefined", Rt = typeof window != Qn, Pn = typeof document != Qn, Yi = Rt && "Deno" in window, Qi = () => Rt && typeof window.requestAnimationFrame != Qn, Xe = (t, e) => {
  const n = ke.get(t);
  return [
    // Getter
    () => !B(e) && t.get(e) || On,
    // Setter
    (s) => {
      if (!B(e)) {
        const a = t.get(e);
        e in Ht || (Ht[e] = a), n[5](e, $e(a, s), a || On);
      }
    },
    // Subscriber
    n[6],
    // Get server cache snapshot
    () => !B(e) && e in Ht ? Ht[e] : !B(e) && t.get(e) || On
  ];
};
let Un = !0;
const Zi = () => Un, [qn, In] = Rt && window.addEventListener ? [
  window.addEventListener.bind(window),
  window.removeEventListener.bind(window)
] : [
  Ye,
  Ye
], eo = () => {
  const t = Pn && document.visibilityState;
  return B(t) || t !== "hidden";
}, to = (t) => (Pn && document.addEventListener("visibilitychange", t), qn("focus", t), () => {
  Pn && document.removeEventListener("visibilitychange", t), In("focus", t);
}), no = (t) => {
  const e = () => {
    Un = !0, t();
  }, n = () => {
    Un = !1;
  };
  return qn("online", e), qn("offline", n), () => {
    In("online", e), In("offline", n);
  };
}, so = {
  isOnline: Zi,
  isVisible: eo
}, ro = {
  initFocus: to,
  initReconnect: no
}, Zs = !St.useId, Et = !Rt || Yi, io = (t) => Qi() ? window.requestAnimationFrame(t) : setTimeout(t, 1), _t = Et ? ft : ji, xn = typeof navigator < "u" && navigator.connection, er = !Et && xn && ([
  "slow-2g",
  "2g"
].includes(xn.effectiveType) || xn.saveData), Wt = /* @__PURE__ */ new WeakMap(), oo = (t) => en.prototype.toString.call(t), An = (t, e) => t === `[object ${e}]`;
let ao = 0;
const jn = (t) => {
  const e = typeof t, n = oo(t), s = An(n, "Date"), a = An(n, "RegExp"), c = An(n, "Object");
  let o, h;
  if (en(t) === t && !s && !a) {
    if (o = Wt.get(t), o) return o;
    if (o = ++ao + "~", Wt.set(t, o), Array.isArray(t)) {
      for (o = "@", h = 0; h < t.length; h++)
        o += jn(t[h]) + ",";
      Wt.set(t, o);
    }
    if (c) {
      o = "#";
      const f = en.keys(t).sort();
      for (; !B(h = f.pop()); )
        B(t[h]) || (o += h + ":" + jn(t[h]) + ",");
      Wt.set(t, o);
    }
  } else
    o = s ? t.toJSON() : e == "symbol" ? t.toString() : e == "string" ? JSON.stringify(t) : "" + t;
  return o;
}, lt = (t) => {
  if (Re(t))
    try {
      t = t();
    } catch {
      t = "";
    }
  const e = t;
  return t = typeof t == "string" ? t : (Array.isArray(t) ? t.length : t) ? jn(t) : "", [
    t,
    e
  ];
};
let co = 0;
const Mn = () => ++co;
async function Tr(...t) {
  const [e, n, s, a] = t, c = $e({
    populateCache: !0,
    throwOnError: !0
  }, typeof a == "boolean" ? {
    revalidate: a
  } : a || {});
  let o = c.populateCache;
  const h = c.rollbackOnError;
  let f = c.optimisticData;
  const l = (E) => typeof h == "function" ? h(E) : h !== !1, m = c.throwOnError;
  if (Re(n)) {
    const E = n, y = [], v = e.keys();
    for (const R of v)
      // Skip the special useSWRInfinite and useSWRSubscription keys.
      !/^\$(inf|sub)\$/.test(R) && E(e.get(R)._k) && y.push(R);
    return Promise.all(y.map(b));
  }
  return b(n);
  async function b(E) {
    const [y] = lt(E);
    if (!y) return;
    const [v, R] = Xe(e, y), [U, A, K, G] = ke.get(e), H = () => {
      const W = U[y];
      return (Re(c.revalidate) ? c.revalidate(v().data, E) : c.revalidate !== !1) && (delete K[y], delete G[y], W && W[0]) ? W[0](Sr).then(() => v().data) : v().data;
    };
    if (t.length < 3)
      return H();
    let q = s, Y, pe = !1;
    const F = Mn();
    A[y] = [
      F,
      0
    ];
    const fe = !B(f), V = v(), ce = V.data, Fe = V._c, me = B(Fe) ? ce : Fe;
    if (fe && (f = Re(f) ? f(me, ce) : f, R({
      data: f,
      _c: me
    })), Re(q))
      try {
        q = q(me);
      } catch (W) {
        Y = W, pe = !0;
      }
    if (q && Rr(q))
      if (q = await q.catch((W) => {
        Y = W, pe = !0;
      }), F !== A[y][0]) {
        if (pe) throw Y;
        return q;
      } else pe && fe && l(Y) && (o = !0, R({
        data: me,
        _c: ne
      }));
    if (o && !pe)
      if (Re(o)) {
        const W = o(q, me);
        R({
          data: W,
          error: ne,
          _c: ne
        });
      } else
        R({
          data: q,
          error: ne,
          _c: ne
        });
    if (A[y][1] = Mn(), Promise.resolve(H()).then(() => {
      R({
        _c: ne
      });
    }), pe) {
      if (m) throw Y;
      return;
    }
    return q;
  }
}
const tr = (t, e) => {
  for (const n in t)
    t[n][0] && t[n][0](e);
}, Or = (t, e) => {
  if (!ke.has(t)) {
    const n = $e(ro, e), s = /* @__PURE__ */ Object.create(null), a = Tr.bind(ne, t);
    let c = Ye;
    const o = /* @__PURE__ */ Object.create(null), h = (m, b) => {
      const E = o[m] || [];
      return o[m] = E, E.push(b), () => E.splice(E.indexOf(b), 1);
    }, f = (m, b, E) => {
      t.set(m, b);
      const y = o[m];
      if (y)
        for (const v of y)
          v(b, E);
    }, l = () => {
      if (!ke.has(t) && (ke.set(t, [
        s,
        /* @__PURE__ */ Object.create(null),
        /* @__PURE__ */ Object.create(null),
        /* @__PURE__ */ Object.create(null),
        a,
        f,
        h
      ]), !Et)) {
        const m = n.initFocus(setTimeout.bind(ne, tr.bind(ne, s, vr))), b = n.initReconnect(setTimeout.bind(ne, tr.bind(ne, s, Er)));
        c = () => {
          m && m(), b && b(), ke.delete(t);
        };
      }
    };
    return l(), [
      t,
      a,
      l,
      c
    ];
  }
  return [
    t,
    ke.get(t)[4]
  ];
}, uo = (t, e, n, s, a) => {
  const c = n.errorRetryCount, o = a.retryCount, h = ~~((Math.random() + 0.5) * (1 << (o < 8 ? o : 8))) * n.errorRetryInterval;
  !B(c) && o > c || setTimeout(s, h, a);
}, lo = Bn, [Tt, fo] = Or(/* @__PURE__ */ new Map()), xr = $e(
  {
    // events
    onLoadingSlow: Ye,
    onSuccess: Ye,
    onError: Ye,
    onErrorRetry: uo,
    onDiscarded: Ye,
    // switches
    revalidateOnFocus: !0,
    revalidateOnReconnect: !0,
    revalidateIfStale: !0,
    shouldRetryOnError: !0,
    // timeouts
    errorRetryInterval: er ? 1e4 : 5e3,
    focusThrottleInterval: 5 * 1e3,
    dedupingInterval: 2 * 1e3,
    loadingTimeout: er ? 5e3 : 3e3,
    // providers
    compare: lo,
    isPaused: () => !1,
    cache: Tt,
    mutate: fo,
    fallback: {}
  },
  // use web preset by default
  so
), Ar = (t, e) => {
  const n = $e(t, e);
  if (e) {
    const { use: s, fallback: a } = t, { use: c, fallback: o } = e;
    s && c && (n.use = s.concat(c)), a && o && (n.fallback = $e(a, o));
  }
  return n;
}, Vn = pr({}), ho = (t) => {
  const { value: e } = t, n = X(Vn), s = Re(e), a = vt(() => s ? e(n) : e, [
    s,
    n,
    e
  ]), c = vt(() => s ? a : Ar(n, a), [
    s,
    n,
    a
  ]), o = a && a.provider, h = qe(ne);
  o && !h.current && (h.current = Or(o(c.cache || Tt), a));
  const f = h.current;
  return f && (c.cache = f[0], c.mutate = f[1]), _t(() => {
    if (f)
      return f[2] && f[2](), f[3];
  }, []), Mi(Vn.Provider, $e(t, {
    value: c
  }));
}, Cr = "$inf$", Lr = Rt && window.__SWR_DEVTOOLS_USE__, po = Lr ? window.__SWR_DEVTOOLS_USE__ : [], mo = () => {
  Lr && (window.__SWR_DEVTOOLS_REACT__ = St);
}, Dr = (t) => Re(t[1]) ? [
  t[0],
  t[1],
  t[2] || {}
] : [
  t[0],
  null,
  (t[1] === null ? t[2] : t[1]) || {}
], yo = () => {
  const t = X(Vn);
  return vt(() => $e(xr, t), [
    t
  ]);
}, tn = (t, e) => {
  const [n, s] = lt(t), [, , , a] = ke.get(Tt);
  if (a[n]) return a[n];
  const c = e(s);
  return a[n] = c, c;
}, go = (t) => (e, n, s) => t(e, n && ((...c) => {
  const [o] = lt(e), [, , , h] = ke.get(Tt);
  if (o.startsWith(Cr))
    return n(...c);
  const f = h[o];
  return B(f) ? n(...c) : (delete h[o], f);
}), s), wo = po.concat(go), bo = (t) => function(...n) {
  const s = yo(), [a, c, o] = Dr(n), h = Ar(s, o);
  let f = t;
  const { use: l } = h, m = (l || []).concat(wo);
  for (let b = m.length; b--; )
    f = m[b](f);
  return f(a, c || h.fetcher || null, h);
}, _o = (t, e, n) => {
  const s = e[t] || (e[t] = []);
  return s.push(n), () => {
    const a = s.indexOf(n);
    a >= 0 && (s[a] = s[s.length - 1], s.pop());
  };
}, vo = (t, e) => (...n) => {
  const [s, a, c] = Dr(n), o = (c.use || []).concat(e);
  return t(s, a, {
    ...c,
    use: o
  });
};
mo();
const Cn = St.use || // This extra generic is to avoid TypeScript mixing up the generic and JSX sytax
// and emitting an error.
// We assume that this is only for the `use(thenable)` case, not `use(context)`.
// https://github.com/facebook/react/blob/aed00dacfb79d17c53218404c52b1c7aa59c4a89/packages/react-server/src/ReactFizzThenable.js#L45
((t) => {
  switch (t.status) {
    case "pending":
      throw t;
    case "fulfilled":
      return t.value;
    case "rejected":
      throw t.reason;
    default:
      throw t.status = "pending", t.then((e) => {
        t.status = "fulfilled", t.value = e;
      }, (e) => {
        t.status = "rejected", t.reason = e;
      }), t;
  }
}), Ln = {
  dedupe: !0
}, nr = Promise.resolve(ne), Eo = (t, e, n) => {
  const { cache: s, compare: a, suspense: c, fallbackData: o, revalidateOnMount: h, revalidateIfStale: f, refreshInterval: l, refreshWhenHidden: m, refreshWhenOffline: b, keepPreviousData: E } = n, [y, v, R, U] = ke.get(s), [A, K] = lt(t), G = qe(!1), H = qe(!1), q = qe(A), Y = qe(e), pe = qe(n), F = () => pe.current, fe = () => F().isVisible() && F().isOnline(), [V, ce, Fe, me] = Xe(s, A), W = qe({}).current, ge = B(o) ? B(n.fallback) ? ne : n.fallback[A] : o, we = (j, z) => {
    for (const ee in W) {
      const $ = ee;
      if ($ === "data") {
        if (!a(j[$], z[$]) && (!B(j[$]) || !a(Ze, z[$])))
          return !1;
      } else if (z[$] !== j[$])
        return !1;
    }
    return !0;
  }, Q = vt(() => {
    const j = !A || !e ? !1 : B(h) ? F().isPaused() || c ? !1 : f !== !1 : h, z = (le) => {
      const Te = $e(le);
      return delete Te._k, j ? {
        isValidating: !0,
        isLoading: !0,
        ...Te
      } : Te;
    }, ee = V(), $ = me(), be = z(ee), ze = ee === $ ? be : z($);
    let oe = be;
    return [
      () => {
        const le = z(V());
        return we(le, oe) ? (oe.data = le.data, oe.isLoading = le.isLoading, oe.isValidating = le.isValidating, oe.error = le.error, oe) : (oe = le, le);
      },
      () => ze
    ];
  }, [
    s,
    A
  ]), Z = _r.useSyncExternalStore(I(
    (j) => Fe(A, (z, ee) => {
      we(ee, z) || j();
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      s,
      A
    ]
  ), Q[0], Q[1]), Me = !G.current, Qe = y[A] && y[A].length > 0, Be = Z.data, ie = B(Be) ? ge && Rr(ge) ? Cn(ge) : ge : Be, He = Z.error, We = qe(ie), Ze = E ? B(Be) ? B(We.current) ? ie : We.current : Be : ie, it = Qe && !B(He) ? !1 : Me && !B(h) ? h : F().isPaused() ? !1 : c ? B(ie) ? !1 : f : B(ie) || f, Ot = !!(A && e && Me && it), on = B(Z.isValidating) ? Ot : Z.isValidating, an = B(Z.isLoading) ? Ot : Z.isLoading, et = I(
    async (j) => {
      const z = Y.current;
      if (!A || !z || H.current || F().isPaused())
        return !1;
      let ee, $, be = !0;
      const ze = j || {}, oe = !R[A] || !ze.dedupe, le = () => Zs ? !H.current && A === q.current && G.current : A === q.current, Te = {
        isValidating: !1,
        isLoading: !1
      }, At = () => {
        ce(Te);
      }, pt = () => {
        const _e = R[A];
        _e && _e[1] === $ && delete R[A];
      }, Ct = {
        isValidating: !0
      };
      B(V().data) && (Ct.isLoading = !0);
      try {
        if (oe && (ce(Ct), n.loadingTimeout && B(V().data) && setTimeout(() => {
          be && le() && F().onLoadingSlow(A, n);
        }, n.loadingTimeout), R[A] = [
          z(K),
          Mn()
        ]), [ee, $] = R[A], ee = await ee, oe && setTimeout(pt, n.dedupingInterval), !R[A] || R[A][1] !== $)
          return oe && le() && F().onDiscarded(A), !1;
        Te.error = ne;
        const _e = v[A];
        if (!B(_e) && // case 1
        ($ <= _e[0] || // case 2
        $ <= _e[1] || // case 3
        _e[1] === 0))
          return At(), oe && le() && F().onDiscarded(A), !1;
        const _ = V().data;
        Te.data = a(_, ee) ? _ : ee, oe && le() && F().onSuccess(ee, A, n);
      } catch (_e) {
        pt();
        const _ = F(), { shouldRetryOnError: k } = _;
        _.isPaused() || (Te.error = _e, oe && le() && (_.onError(_e, A, _), (k === !0 || Re(k) && k(_e)) && (!F().revalidateOnFocus || !F().revalidateOnReconnect || fe()) && _.onErrorRetry(_e, A, _, (Lt) => {
          const ot = y[A];
          ot && ot[0] && ot[0](Ys, Lt);
        }, {
          retryCount: (ze.retryCount || 0) + 1,
          dedupe: !0
        })));
      }
      return be = !1, At(), !0;
    },
    // `setState` is immutable, and `eventsCallback`, `fnArg`, and
    // `keyValidating` are depending on `key`, so we can exclude them from
    // the deps array.
    //
    // FIXME:
    // `fn` and `config` might be changed during the lifecycle,
    // but they might be changed every render like this.
    // `useSWR('key', () => fetch('/api/'), { suspense: true })`
    // So we omit the values from the deps array
    // even though it might cause unexpected behaviors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      A,
      s
    ]
  ), xt = I(
    // Use callback to make sure `keyRef.current` returns latest result every time
    (...j) => Tr(s, q.current, ...j),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  if (_t(() => {
    Y.current = e, pe.current = n, B(Be) || (We.current = Be);
  }), _t(() => {
    if (!A) return;
    const j = et.bind(ne, Ln);
    let z = 0;
    F().revalidateOnFocus && (z = Date.now() + F().focusThrottleInterval);
    const $ = _o(A, y, (be, ze = {}) => {
      if (be == vr) {
        const oe = Date.now();
        F().revalidateOnFocus && oe > z && fe() && (z = oe + F().focusThrottleInterval, j());
      } else if (be == Er)
        F().revalidateOnReconnect && fe() && j();
      else {
        if (be == Sr)
          return et();
        if (be == Ys)
          return et(ze);
      }
    });
    return H.current = !1, q.current = A, G.current = !0, ce({
      _k: K
    }), it && (R[A] || (B(ie) || Et ? j() : io(j))), () => {
      H.current = !0, $();
    };
  }, [
    A
  ]), _t(() => {
    let j;
    function z() {
      const $ = Re(l) ? l(V().data) : l;
      $ && j !== -1 && (j = setTimeout(ee, $));
    }
    function ee() {
      !V().error && (m || F().isVisible()) && (b || F().isOnline()) ? et(Ln).then(z) : z();
    }
    return z(), () => {
      j && (clearTimeout(j), j = -1);
    };
  }, [
    l,
    m,
    b,
    A
  ]), Vi(Ze), c) {
    const j = A && B(ie);
    if (!Zs && Et && j)
      throw new Error("Fallback data is required when using Suspense in SSR.");
    j && (Y.current = e, pe.current = n, H.current = !1);
    const z = U[A], ee = !B(z) && j ? xt(z) : nr;
    if (Cn(ee), !B(He) && j)
      throw He;
    const $ = j ? et(Ln) : nr;
    !B(Ze) && j && ($.status = "fulfilled", $.value = !0), Cn($);
  }
  return {
    mutate: xt,
    get data() {
      return W.data = !0, Ze;
    },
    get error() {
      return W.error = !0, He;
    },
    get isValidating() {
      return W.isValidating = !0, on;
    },
    get isLoading() {
      return W.isLoading = !0, an;
    }
  };
}, So = en.defineProperty(ho, "defaultValue", {
  value: xr
}), ht = bo(Eo), Ro = () => {
}, To = (
  /*#__NOINLINE__*/
  Ro()
), $n = Object, sr = (t) => t === To, Oo = (t) => typeof t == "function", zt = /* @__PURE__ */ new WeakMap(), xo = (t) => $n.prototype.toString.call(t), Dn = (t, e) => t === `[object ${e}]`;
let Ao = 0;
const Hn = (t) => {
  const e = typeof t, n = xo(t), s = Dn(n, "Date"), a = Dn(n, "RegExp"), c = Dn(n, "Object");
  let o, h;
  if ($n(t) === t && !s && !a) {
    if (o = zt.get(t), o) return o;
    if (o = ++Ao + "~", zt.set(t, o), Array.isArray(t)) {
      for (o = "@", h = 0; h < t.length; h++)
        o += Hn(t[h]) + ",";
      zt.set(t, o);
    }
    if (c) {
      o = "#";
      const f = $n.keys(t).sort();
      for (; !sr(h = f.pop()); )
        sr(t[h]) || (o += h + ":" + Hn(t[h]) + ",");
      zt.set(t, o);
    }
  } else
    o = s ? t.toJSON() : e == "symbol" ? t.toString() : e == "string" ? JSON.stringify(t) : "" + t;
  return o;
}, Co = (t) => {
  if (Oo(t))
    try {
      t = t();
    } catch {
      t = "";
    }
  const e = t;
  return t = typeof t == "string" ? t : (Array.isArray(t) ? t.length : t) ? Hn(t) : "", [
    t,
    e
  ];
}, Lo = (t) => Co(t ? t(0, null) : null)[0], Nn = Promise.resolve(), Do = (t) => (e, n, s) => {
  const a = qe(!1), { cache: c, initialSize: o = 1, revalidateAll: h = !1, persistSize: f = !1, revalidateFirstPage: l = !0, revalidateOnMount: m = !1, parallel: b = !1 } = s, [, , , E] = ke.get(Tt);
  let y;
  try {
    y = Lo(e), y && (y = Cr + y);
  } catch {
  }
  const [v, R, U] = Xe(c, y), A = I(() => B(v()._l) ? o : v()._l, [
    c,
    y,
    o
  ]);
  _r.useSyncExternalStore(I(
    (F) => y ? U(y, () => {
      F();
    }) : () => {
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      c,
      y
    ]
  ), A, A);
  const K = I(() => {
    const F = v()._l;
    return B(F) ? o : F;
  }, [
    y,
    o
  ]), G = qe(K());
  _t(() => {
    if (!a.current) {
      a.current = !0;
      return;
    }
    y && R({
      _l: f ? G.current : K()
    });
  }, [
    y,
    c
  ]);
  const H = m && !a.current, q = t(y, async (F) => {
    const fe = v()._i, V = v()._r;
    R({
      _r: ne
    });
    const ce = [], Fe = K(), [me] = Xe(c, F), W = me().data, ge = [];
    let we = null;
    for (let Q = 0; Q < Fe; ++Q) {
      const [Z, Me] = lt(e(Q, b ? null : we));
      if (!Z)
        break;
      const [Qe, Be] = Xe(c, Z);
      let ie = Qe().data;
      const He = h || fe || B(ie) || l && !Q && !B(W) || H || W && !B(W[Q]) && !s.compare(W[Q], ie);
      if (n && (typeof V == "function" ? V(ie, Me) : He)) {
        const We = async () => {
          if (!(Z in E))
            ie = await n(Me);
          else {
            const it = E[Z];
            delete E[Z], ie = await it;
          }
          Be({
            data: ie,
            _k: Me
          }), ce[Q] = ie;
        };
        b ? ge.push(We) : await We();
      } else
        ce[Q] = ie;
      b || (we = ie);
    }
    return b && await Promise.all(ge.map((Q) => Q())), R({
      _i: ne
    }), ce;
  }, s), Y = I(
    // eslint-disable-next-line func-names
    function(F, fe) {
      const V = typeof fe == "boolean" ? {
        revalidate: fe
      } : fe || {}, ce = V.revalidate !== !1;
      return y ? (ce && (B(F) ? R({
        _i: !0,
        _r: V.revalidate
      }) : R({
        _i: !1,
        _r: V.revalidate
      })), arguments.length ? q.mutate(F, {
        ...V,
        revalidate: ce
      }) : q.mutate()) : Nn;
    },
    // swr.mutate is always the same reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      y,
      c
    ]
  ), pe = I(
    (F) => {
      if (!y) return Nn;
      const [, fe] = Xe(c, y);
      let V;
      if (Re(F) ? V = F(K()) : typeof F == "number" && (V = F), typeof V != "number") return Nn;
      fe({
        _l: V
      }), G.current = V;
      const ce = [], [Fe] = Xe(c, y);
      let me = null;
      for (let W = 0; W < V; ++W) {
        const [ge] = lt(e(W, me)), [we] = Xe(c, ge), Q = ge ? we().data : ne;
        if (B(Q))
          return Y(Fe().data);
        ce.push(Q), me = Q;
      }
      return Y(ce);
    },
    // exclude getKey from the dependencies, which isn't allowed to change during the lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      y,
      c,
      Y,
      K
    ]
  );
  return {
    size: K(),
    setSize: pe,
    mutate: Y,
    get data() {
      return q.data;
    },
    get error() {
      return q.error;
    },
    get isValidating() {
      return q.isValidating;
    },
    get isLoading() {
      return q.isLoading;
    }
  };
}, Ca = vo(ht, Do), je = /* @__PURE__ */ Object.create(null);
je.open = "0";
je.close = "1";
je.ping = "2";
je.pong = "3";
je.message = "4";
je.upgrade = "5";
je.noop = "6";
const Yt = /* @__PURE__ */ Object.create(null);
Object.keys(je).forEach((t) => {
  Yt[je[t]] = t;
});
const Wn = { type: "error", data: "parser error" }, Nr = typeof Blob == "function" || typeof Blob < "u" && Object.prototype.toString.call(Blob) === "[object BlobConstructor]", kr = typeof ArrayBuffer == "function", Fr = (t) => typeof ArrayBuffer.isView == "function" ? ArrayBuffer.isView(t) : t && t.buffer instanceof ArrayBuffer, Zn = ({ type: t, data: e }, n, s) => Nr && e instanceof Blob ? n ? s(e) : rr(e, s) : kr && (e instanceof ArrayBuffer || Fr(e)) ? n ? s(e) : rr(new Blob([e]), s) : s(je[t] + (e || "")), rr = (t, e) => {
  const n = new FileReader();
  return n.onload = function() {
    const s = n.result.split(",")[1];
    e("b" + (s || ""));
  }, n.readAsDataURL(t);
};
function ir(t) {
  return t instanceof Uint8Array ? t : t instanceof ArrayBuffer ? new Uint8Array(t) : new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
}
let kn;
function No(t, e) {
  if (Nr && t.data instanceof Blob)
    return t.data.arrayBuffer().then(ir).then(e);
  if (kr && (t.data instanceof ArrayBuffer || Fr(t.data)))
    return e(ir(t.data));
  Zn(t, !1, (n) => {
    kn || (kn = new TextEncoder()), e(kn.encode(n));
  });
}
const or = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bt = typeof Uint8Array > "u" ? [] : new Uint8Array(256);
for (let t = 0; t < or.length; t++)
  bt[or.charCodeAt(t)] = t;
const ko = (t) => {
  let e = t.length * 0.75, n = t.length, s, a = 0, c, o, h, f;
  t[t.length - 1] === "=" && (e--, t[t.length - 2] === "=" && e--);
  const l = new ArrayBuffer(e), m = new Uint8Array(l);
  for (s = 0; s < n; s += 4)
    c = bt[t.charCodeAt(s)], o = bt[t.charCodeAt(s + 1)], h = bt[t.charCodeAt(s + 2)], f = bt[t.charCodeAt(s + 3)], m[a++] = c << 2 | o >> 4, m[a++] = (o & 15) << 4 | h >> 2, m[a++] = (h & 3) << 6 | f & 63;
  return l;
}, Fo = typeof ArrayBuffer == "function", es = (t, e) => {
  if (typeof t != "string")
    return {
      type: "message",
      data: Br(t, e)
    };
  const n = t.charAt(0);
  return n === "b" ? {
    type: "message",
    data: Bo(t.substring(1), e)
  } : Yt[n] ? t.length > 1 ? {
    type: Yt[n],
    data: t.substring(1)
  } : {
    type: Yt[n]
  } : Wn;
}, Bo = (t, e) => {
  if (Fo) {
    const n = ko(t);
    return Br(n, e);
  } else
    return { base64: !0, data: t };
}, Br = (t, e) => {
  switch (e) {
    case "blob":
      return t instanceof Blob ? t : new Blob([t]);
    case "arraybuffer":
    default:
      return t instanceof ArrayBuffer ? t : t.buffer;
  }
}, Pr = "", Po = (t, e) => {
  const n = t.length, s = new Array(n);
  let a = 0;
  t.forEach((c, o) => {
    Zn(c, !1, (h) => {
      s[o] = h, ++a === n && e(s.join(Pr));
    });
  });
}, Uo = (t, e) => {
  const n = t.split(Pr), s = [];
  for (let a = 0; a < n.length; a++) {
    const c = es(n[a], e);
    if (s.push(c), c.type === "error")
      break;
  }
  return s;
};
function qo() {
  return new TransformStream({
    transform(t, e) {
      No(t, (n) => {
        const s = n.length;
        let a;
        if (s < 126)
          a = new Uint8Array(1), new DataView(a.buffer).setUint8(0, s);
        else if (s < 65536) {
          a = new Uint8Array(3);
          const c = new DataView(a.buffer);
          c.setUint8(0, 126), c.setUint16(1, s);
        } else {
          a = new Uint8Array(9);
          const c = new DataView(a.buffer);
          c.setUint8(0, 127), c.setBigUint64(1, BigInt(s));
        }
        t.data && typeof t.data != "string" && (a[0] |= 128), e.enqueue(a), e.enqueue(n);
      });
    }
  });
}
let Fn;
function Jt(t) {
  return t.reduce((e, n) => e + n.length, 0);
}
function Kt(t, e) {
  if (t[0].length === e)
    return t.shift();
  const n = new Uint8Array(e);
  let s = 0;
  for (let a = 0; a < e; a++)
    n[a] = t[0][s++], s === t[0].length && (t.shift(), s = 0);
  return t.length && s < t[0].length && (t[0] = t[0].slice(s)), n;
}
function Io(t, e) {
  Fn || (Fn = new TextDecoder());
  const n = [];
  let s = 0, a = -1, c = !1;
  return new TransformStream({
    transform(o, h) {
      for (n.push(o); ; ) {
        if (s === 0) {
          if (Jt(n) < 1)
            break;
          const f = Kt(n, 1);
          c = (f[0] & 128) === 128, a = f[0] & 127, a < 126 ? s = 3 : a === 126 ? s = 1 : s = 2;
        } else if (s === 1) {
          if (Jt(n) < 2)
            break;
          const f = Kt(n, 2);
          a = new DataView(f.buffer, f.byteOffset, f.length).getUint16(0), s = 3;
        } else if (s === 2) {
          if (Jt(n) < 8)
            break;
          const f = Kt(n, 8), l = new DataView(f.buffer, f.byteOffset, f.length), m = l.getUint32(0);
          if (m > Math.pow(2, 21) - 1) {
            h.enqueue(Wn);
            break;
          }
          a = m * Math.pow(2, 32) + l.getUint32(4), s = 3;
        } else {
          if (Jt(n) < a)
            break;
          const f = Kt(n, a);
          h.enqueue(es(c ? f : Fn.decode(f), e)), s = 0;
        }
        if (a === 0 || a > t) {
          h.enqueue(Wn);
          break;
        }
      }
    }
  });
}
const Ur = 4;
function se(t) {
  if (t) return jo(t);
}
function jo(t) {
  for (var e in se.prototype)
    t[e] = se.prototype[e];
  return t;
}
se.prototype.on = se.prototype.addEventListener = function(t, e) {
  return this._callbacks = this._callbacks || {}, (this._callbacks["$" + t] = this._callbacks["$" + t] || []).push(e), this;
};
se.prototype.once = function(t, e) {
  function n() {
    this.off(t, n), e.apply(this, arguments);
  }
  return n.fn = e, this.on(t, n), this;
};
se.prototype.off = se.prototype.removeListener = se.prototype.removeAllListeners = se.prototype.removeEventListener = function(t, e) {
  if (this._callbacks = this._callbacks || {}, arguments.length == 0)
    return this._callbacks = {}, this;
  var n = this._callbacks["$" + t];
  if (!n) return this;
  if (arguments.length == 1)
    return delete this._callbacks["$" + t], this;
  for (var s, a = 0; a < n.length; a++)
    if (s = n[a], s === e || s.fn === e) {
      n.splice(a, 1);
      break;
    }
  return n.length === 0 && delete this._callbacks["$" + t], this;
};
se.prototype.emit = function(t) {
  this._callbacks = this._callbacks || {};
  for (var e = new Array(arguments.length - 1), n = this._callbacks["$" + t], s = 1; s < arguments.length; s++)
    e[s - 1] = arguments[s];
  if (n) {
    n = n.slice(0);
    for (var s = 0, a = n.length; s < a; ++s)
      n[s].apply(this, e);
  }
  return this;
};
se.prototype.emitReserved = se.prototype.emit;
se.prototype.listeners = function(t) {
  return this._callbacks = this._callbacks || {}, this._callbacks["$" + t] || [];
};
se.prototype.hasListeners = function(t) {
  return !!this.listeners(t).length;
};
const Se = typeof self < "u" ? self : typeof window < "u" ? window : Function("return this")();
function qr(t, ...e) {
  return e.reduce((n, s) => (t.hasOwnProperty(s) && (n[s] = t[s]), n), {});
}
const Mo = Se.setTimeout, Vo = Se.clearTimeout;
function nn(t, e) {
  e.useNativeTimers ? (t.setTimeoutFn = Mo.bind(Se), t.clearTimeoutFn = Vo.bind(Se)) : (t.setTimeoutFn = Se.setTimeout.bind(Se), t.clearTimeoutFn = Se.clearTimeout.bind(Se));
}
const $o = 1.33;
function Ho(t) {
  return typeof t == "string" ? Wo(t) : Math.ceil((t.byteLength || t.size) * $o);
}
function Wo(t) {
  let e = 0, n = 0;
  for (let s = 0, a = t.length; s < a; s++)
    e = t.charCodeAt(s), e < 128 ? n += 1 : e < 2048 ? n += 2 : e < 55296 || e >= 57344 ? n += 3 : (s++, n += 4);
  return n;
}
function zo(t) {
  let e = "";
  for (let n in t)
    t.hasOwnProperty(n) && (e.length && (e += "&"), e += encodeURIComponent(n) + "=" + encodeURIComponent(t[n]));
  return e;
}
function Jo(t) {
  let e = {}, n = t.split("&");
  for (let s = 0, a = n.length; s < a; s++) {
    let c = n[s].split("=");
    e[decodeURIComponent(c[0])] = decodeURIComponent(c[1]);
  }
  return e;
}
class Ko extends Error {
  constructor(e, n, s) {
    super(e), this.description = n, this.context = s, this.type = "TransportError";
  }
}
class ts extends se {
  /**
   * Transport abstract constructor.
   *
   * @param {Object} opts - options
   * @protected
   */
  constructor(e) {
    super(), this.writable = !1, nn(this, e), this.opts = e, this.query = e.query, this.socket = e.socket;
  }
  /**
   * Emits an error.
   *
   * @param {String} reason
   * @param description
   * @param context - the error context
   * @return {Transport} for chaining
   * @protected
   */
  onError(e, n, s) {
    return super.emitReserved("error", new Ko(e, n, s)), this;
  }
  /**
   * Opens the transport.
   */
  open() {
    return this.readyState = "opening", this.doOpen(), this;
  }
  /**
   * Closes the transport.
   */
  close() {
    return (this.readyState === "opening" || this.readyState === "open") && (this.doClose(), this.onClose()), this;
  }
  /**
   * Sends multiple packets.
   *
   * @param {Array} packets
   */
  send(e) {
    this.readyState === "open" && this.write(e);
  }
  /**
   * Called upon open
   *
   * @protected
   */
  onOpen() {
    this.readyState = "open", this.writable = !0, super.emitReserved("open");
  }
  /**
   * Called with data.
   *
   * @param {String} data
   * @protected
   */
  onData(e) {
    const n = es(e, this.socket.binaryType);
    this.onPacket(n);
  }
  /**
   * Called with a decoded packet.
   *
   * @protected
   */
  onPacket(e) {
    super.emitReserved("packet", e);
  }
  /**
   * Called upon close.
   *
   * @protected
   */
  onClose(e) {
    this.readyState = "closed", super.emitReserved("close", e);
  }
  /**
   * Pauses the transport, in order not to lose packets during an upgrade.
   *
   * @param onPause
   */
  pause(e) {
  }
  createUri(e, n = {}) {
    return e + "://" + this._hostname() + this._port() + this.opts.path + this._query(n);
  }
  _hostname() {
    const e = this.opts.hostname;
    return e.indexOf(":") === -1 ? e : "[" + e + "]";
  }
  _port() {
    return this.opts.port && (this.opts.secure && +(this.opts.port !== 443) || !this.opts.secure && Number(this.opts.port) !== 80) ? ":" + this.opts.port : "";
  }
  _query(e) {
    const n = zo(e);
    return n.length ? "?" + n : "";
  }
}
const Ir = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_".split(""), zn = 64, Go = {};
let ar = 0, Gt = 0, cr;
function ur(t) {
  let e = "";
  do
    e = Ir[t % zn] + e, t = Math.floor(t / zn);
  while (t > 0);
  return e;
}
function jr() {
  const t = ur(+/* @__PURE__ */ new Date());
  return t !== cr ? (ar = 0, cr = t) : t + "." + ur(ar++);
}
for (; Gt < zn; Gt++)
  Go[Ir[Gt]] = Gt;
let Mr = !1;
try {
  Mr = typeof XMLHttpRequest < "u" && "withCredentials" in new XMLHttpRequest();
} catch {
}
const Xo = Mr;
function Vr(t) {
  const e = t.xdomain;
  try {
    if (typeof XMLHttpRequest < "u" && (!e || Xo))
      return new XMLHttpRequest();
  } catch {
  }
  if (!e)
    try {
      return new Se[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP");
    } catch {
    }
}
function Yo() {
}
const Qo = function() {
  return new Vr({
    xdomain: !1
  }).responseType != null;
}();
class Zo extends ts {
  /**
   * XHR Polling constructor.
   *
   * @param {Object} opts
   * @package
   */
  constructor(e) {
    if (super(e), this.polling = !1, typeof location < "u") {
      const s = location.protocol === "https:";
      let a = location.port;
      a || (a = s ? "443" : "80"), this.xd = typeof location < "u" && e.hostname !== location.hostname || a !== e.port;
    }
    const n = e && e.forceBase64;
    this.supportsBinary = Qo && !n, this.opts.withCredentials && (this.cookieJar = void 0);
  }
  get name() {
    return "polling";
  }
  /**
   * Opens the socket (triggers polling). We write a PING message to determine
   * when the transport is open.
   *
   * @protected
   */
  doOpen() {
    this.poll();
  }
  /**
   * Pauses polling.
   *
   * @param {Function} onPause - callback upon buffers are flushed and transport is paused
   * @package
   */
  pause(e) {
    this.readyState = "pausing";
    const n = () => {
      this.readyState = "paused", e();
    };
    if (this.polling || !this.writable) {
      let s = 0;
      this.polling && (s++, this.once("pollComplete", function() {
        --s || n();
      })), this.writable || (s++, this.once("drain", function() {
        --s || n();
      }));
    } else
      n();
  }
  /**
   * Starts polling cycle.
   *
   * @private
   */
  poll() {
    this.polling = !0, this.doPoll(), this.emitReserved("poll");
  }
  /**
   * Overloads onData to detect payloads.
   *
   * @protected
   */
  onData(e) {
    const n = (s) => {
      if (this.readyState === "opening" && s.type === "open" && this.onOpen(), s.type === "close")
        return this.onClose({ description: "transport closed by the server" }), !1;
      this.onPacket(s);
    };
    Uo(e, this.socket.binaryType).forEach(n), this.readyState !== "closed" && (this.polling = !1, this.emitReserved("pollComplete"), this.readyState === "open" && this.poll());
  }
  /**
   * For polling, send a close packet.
   *
   * @protected
   */
  doClose() {
    const e = () => {
      this.write([{ type: "close" }]);
    };
    this.readyState === "open" ? e() : this.once("open", e);
  }
  /**
   * Writes a packets payload.
   *
   * @param {Array} packets - data packets
   * @protected
   */
  write(e) {
    this.writable = !1, Po(e, (n) => {
      this.doWrite(n, () => {
        this.writable = !0, this.emitReserved("drain");
      });
    });
  }
  /**
   * Generates uri for connection.
   *
   * @private
   */
  uri() {
    const e = this.opts.secure ? "https" : "http", n = this.query || {};
    return this.opts.timestampRequests !== !1 && (n[this.opts.timestampParam] = jr()), !this.supportsBinary && !n.sid && (n.b64 = 1), this.createUri(e, n);
  }
  /**
   * Creates a request.
   *
   * @param {String} method
   * @private
   */
  request(e = {}) {
    return Object.assign(e, { xd: this.xd, cookieJar: this.cookieJar }, this.opts), new Ie(this.uri(), e);
  }
  /**
   * Sends data.
   *
   * @param {String} data to send.
   * @param {Function} called upon flush.
   * @private
   */
  doWrite(e, n) {
    const s = this.request({
      method: "POST",
      data: e
    });
    s.on("success", n), s.on("error", (a, c) => {
      this.onError("xhr post error", a, c);
    });
  }
  /**
   * Starts a poll cycle.
   *
   * @private
   */
  doPoll() {
    const e = this.request();
    e.on("data", this.onData.bind(this)), e.on("error", (n, s) => {
      this.onError("xhr poll error", n, s);
    }), this.pollXhr = e;
  }
}
class Ie extends se {
  /**
   * Request constructor
   *
   * @param {Object} options
   * @package
   */
  constructor(e, n) {
    super(), nn(this, n), this.opts = n, this.method = n.method || "GET", this.uri = e, this.data = n.data !== void 0 ? n.data : null, this.create();
  }
  /**
   * Creates the XHR object and sends the request.
   *
   * @private
   */
  create() {
    var e;
    const n = qr(this.opts, "agent", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "autoUnref");
    n.xdomain = !!this.opts.xd;
    const s = this.xhr = new Vr(n);
    try {
      s.open(this.method, this.uri, !0);
      try {
        if (this.opts.extraHeaders) {
          s.setDisableHeaderCheck && s.setDisableHeaderCheck(!0);
          for (let a in this.opts.extraHeaders)
            this.opts.extraHeaders.hasOwnProperty(a) && s.setRequestHeader(a, this.opts.extraHeaders[a]);
        }
      } catch {
      }
      if (this.method === "POST")
        try {
          s.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
        } catch {
        }
      try {
        s.setRequestHeader("Accept", "*/*");
      } catch {
      }
      (e = this.opts.cookieJar) === null || e === void 0 || e.addCookies(s), "withCredentials" in s && (s.withCredentials = this.opts.withCredentials), this.opts.requestTimeout && (s.timeout = this.opts.requestTimeout), s.onreadystatechange = () => {
        var a;
        s.readyState === 3 && ((a = this.opts.cookieJar) === null || a === void 0 || a.parseCookies(s)), s.readyState === 4 && (s.status === 200 || s.status === 1223 ? this.onLoad() : this.setTimeoutFn(() => {
          this.onError(typeof s.status == "number" ? s.status : 0);
        }, 0));
      }, s.send(this.data);
    } catch (a) {
      this.setTimeoutFn(() => {
        this.onError(a);
      }, 0);
      return;
    }
    typeof document < "u" && (this.index = Ie.requestsCount++, Ie.requests[this.index] = this);
  }
  /**
   * Called upon error.
   *
   * @private
   */
  onError(e) {
    this.emitReserved("error", e, this.xhr), this.cleanup(!0);
  }
  /**
   * Cleans up house.
   *
   * @private
   */
  cleanup(e) {
    if (!(typeof this.xhr > "u" || this.xhr === null)) {
      if (this.xhr.onreadystatechange = Yo, e)
        try {
          this.xhr.abort();
        } catch {
        }
      typeof document < "u" && delete Ie.requests[this.index], this.xhr = null;
    }
  }
  /**
   * Called upon load.
   *
   * @private
   */
  onLoad() {
    const e = this.xhr.responseText;
    e !== null && (this.emitReserved("data", e), this.emitReserved("success"), this.cleanup());
  }
  /**
   * Aborts the request.
   *
   * @package
   */
  abort() {
    this.cleanup();
  }
}
Ie.requestsCount = 0;
Ie.requests = {};
if (typeof document < "u") {
  if (typeof attachEvent == "function")
    attachEvent("onunload", lr);
  else if (typeof addEventListener == "function") {
    const t = "onpagehide" in Se ? "pagehide" : "unload";
    addEventListener(t, lr, !1);
  }
}
function lr() {
  for (let t in Ie.requests)
    Ie.requests.hasOwnProperty(t) && Ie.requests[t].abort();
}
const ns = typeof Promise == "function" && typeof Promise.resolve == "function" ? (e) => Promise.resolve().then(e) : (e, n) => n(e, 0), Xt = Se.WebSocket || Se.MozWebSocket, fr = !0, ea = "arraybuffer", hr = typeof navigator < "u" && typeof navigator.product == "string" && navigator.product.toLowerCase() === "reactnative";
class ta extends ts {
  /**
   * WebSocket transport constructor.
   *
   * @param {Object} opts - connection options
   * @protected
   */
  constructor(e) {
    super(e), this.supportsBinary = !e.forceBase64;
  }
  get name() {
    return "websocket";
  }
  doOpen() {
    if (!this.check())
      return;
    const e = this.uri(), n = this.opts.protocols, s = hr ? {} : qr(this.opts, "agent", "perMessageDeflate", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "localAddress", "protocolVersion", "origin", "maxPayload", "family", "checkServerIdentity");
    this.opts.extraHeaders && (s.headers = this.opts.extraHeaders);
    try {
      this.ws = fr && !hr ? n ? new Xt(e, n) : new Xt(e) : new Xt(e, n, s);
    } catch (a) {
      return this.emitReserved("error", a);
    }
    this.ws.binaryType = this.socket.binaryType, this.addEventListeners();
  }
  /**
   * Adds event listeners to the socket
   *
   * @private
   */
  addEventListeners() {
    this.ws.onopen = () => {
      this.opts.autoUnref && this.ws._socket.unref(), this.onOpen();
    }, this.ws.onclose = (e) => this.onClose({
      description: "websocket connection closed",
      context: e
    }), this.ws.onmessage = (e) => this.onData(e.data), this.ws.onerror = (e) => this.onError("websocket error", e);
  }
  write(e) {
    this.writable = !1;
    for (let n = 0; n < e.length; n++) {
      const s = e[n], a = n === e.length - 1;
      Zn(s, this.supportsBinary, (c) => {
        const o = {};
        try {
          fr && this.ws.send(c);
        } catch {
        }
        a && ns(() => {
          this.writable = !0, this.emitReserved("drain");
        }, this.setTimeoutFn);
      });
    }
  }
  doClose() {
    typeof this.ws < "u" && (this.ws.close(), this.ws = null);
  }
  /**
   * Generates uri for connection.
   *
   * @private
   */
  uri() {
    const e = this.opts.secure ? "wss" : "ws", n = this.query || {};
    return this.opts.timestampRequests && (n[this.opts.timestampParam] = jr()), this.supportsBinary || (n.b64 = 1), this.createUri(e, n);
  }
  /**
   * Feature detection for WebSocket.
   *
   * @return {Boolean} whether this transport is available.
   * @private
   */
  check() {
    return !!Xt;
  }
}
class na extends ts {
  get name() {
    return "webtransport";
  }
  doOpen() {
    typeof WebTransport == "function" && (this.transport = new WebTransport(this.createUri("https"), this.opts.transportOptions[this.name]), this.transport.closed.then(() => {
      this.onClose();
    }).catch((e) => {
      this.onError("webtransport error", e);
    }), this.transport.ready.then(() => {
      this.transport.createBidirectionalStream().then((e) => {
        const n = Io(Number.MAX_SAFE_INTEGER, this.socket.binaryType), s = e.readable.pipeThrough(n).getReader(), a = qo();
        a.readable.pipeTo(e.writable), this.writer = a.writable.getWriter();
        const c = () => {
          s.read().then(({ done: h, value: f }) => {
            h || (this.onPacket(f), c());
          }).catch((h) => {
          });
        };
        c();
        const o = { type: "open" };
        this.query.sid && (o.data = `{"sid":"${this.query.sid}"}`), this.writer.write(o).then(() => this.onOpen());
      });
    }));
  }
  write(e) {
    this.writable = !1;
    for (let n = 0; n < e.length; n++) {
      const s = e[n], a = n === e.length - 1;
      this.writer.write(s).then(() => {
        a && ns(() => {
          this.writable = !0, this.emitReserved("drain");
        }, this.setTimeoutFn);
      });
    }
  }
  doClose() {
    var e;
    (e = this.transport) === null || e === void 0 || e.close();
  }
}
const sa = {
  websocket: ta,
  webtransport: na,
  polling: Zo
}, ra = /^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/, ia = [
  "source",
  "protocol",
  "authority",
  "userInfo",
  "user",
  "password",
  "host",
  "port",
  "relative",
  "path",
  "directory",
  "file",
  "query",
  "anchor"
];
function Jn(t) {
  if (t.length > 2e3)
    throw "URI too long";
  const e = t, n = t.indexOf("["), s = t.indexOf("]");
  n != -1 && s != -1 && (t = t.substring(0, n) + t.substring(n, s).replace(/:/g, ";") + t.substring(s, t.length));
  let a = ra.exec(t || ""), c = {}, o = 14;
  for (; o--; )
    c[ia[o]] = a[o] || "";
  return n != -1 && s != -1 && (c.source = e, c.host = c.host.substring(1, c.host.length - 1).replace(/;/g, ":"), c.authority = c.authority.replace("[", "").replace("]", "").replace(/;/g, ":"), c.ipv6uri = !0), c.pathNames = oa(c, c.path), c.queryKey = aa(c, c.query), c;
}
function oa(t, e) {
  const n = /\/{2,9}/g, s = e.replace(n, "/").split("/");
  return (e.slice(0, 1) == "/" || e.length === 0) && s.splice(0, 1), e.slice(-1) == "/" && s.splice(s.length - 1, 1), s;
}
function aa(t, e) {
  const n = {};
  return e.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function(s, a, c) {
    a && (n[a] = c);
  }), n;
}
let $r = class ut extends se {
  /**
   * Socket constructor.
   *
   * @param {String|Object} uri - uri or options
   * @param {Object} opts - options
   */
  constructor(e, n = {}) {
    super(), this.binaryType = ea, this.writeBuffer = [], e && typeof e == "object" && (n = e, e = null), e ? (e = Jn(e), n.hostname = e.host, n.secure = e.protocol === "https" || e.protocol === "wss", n.port = e.port, e.query && (n.query = e.query)) : n.host && (n.hostname = Jn(n.host).host), nn(this, n), this.secure = n.secure != null ? n.secure : typeof location < "u" && location.protocol === "https:", n.hostname && !n.port && (n.port = this.secure ? "443" : "80"), this.hostname = n.hostname || (typeof location < "u" ? location.hostname : "localhost"), this.port = n.port || (typeof location < "u" && location.port ? location.port : this.secure ? "443" : "80"), this.transports = n.transports || [
      "polling",
      "websocket",
      "webtransport"
    ], this.writeBuffer = [], this.prevBufferLen = 0, this.opts = Object.assign({
      path: "/engine.io",
      agent: !1,
      withCredentials: !1,
      upgrade: !0,
      timestampParam: "t",
      rememberUpgrade: !1,
      addTrailingSlash: !0,
      rejectUnauthorized: !0,
      perMessageDeflate: {
        threshold: 1024
      },
      transportOptions: {},
      closeOnBeforeunload: !1
    }, n), this.opts.path = this.opts.path.replace(/\/$/, "") + (this.opts.addTrailingSlash ? "/" : ""), typeof this.opts.query == "string" && (this.opts.query = Jo(this.opts.query)), this.id = null, this.upgrades = null, this.pingInterval = null, this.pingTimeout = null, this.pingTimeoutTimer = null, typeof addEventListener == "function" && (this.opts.closeOnBeforeunload && (this.beforeunloadEventListener = () => {
      this.transport && (this.transport.removeAllListeners(), this.transport.close());
    }, addEventListener("beforeunload", this.beforeunloadEventListener, !1)), this.hostname !== "localhost" && (this.offlineEventListener = () => {
      this.onClose("transport close", {
        description: "network connection lost"
      });
    }, addEventListener("offline", this.offlineEventListener, !1))), this.open();
  }
  /**
   * Creates transport of the given type.
   *
   * @param {String} name - transport name
   * @return {Transport}
   * @private
   */
  createTransport(e) {
    const n = Object.assign({}, this.opts.query);
    n.EIO = Ur, n.transport = e, this.id && (n.sid = this.id);
    const s = Object.assign({}, this.opts, {
      query: n,
      socket: this,
      hostname: this.hostname,
      secure: this.secure,
      port: this.port
    }, this.opts.transportOptions[e]);
    return new sa[e](s);
  }
  /**
   * Initializes transport to use and starts probe.
   *
   * @private
   */
  open() {
    let e;
    if (this.opts.rememberUpgrade && ut.priorWebsocketSuccess && this.transports.indexOf("websocket") !== -1)
      e = "websocket";
    else if (this.transports.length === 0) {
      this.setTimeoutFn(() => {
        this.emitReserved("error", "No transports available");
      }, 0);
      return;
    } else
      e = this.transports[0];
    this.readyState = "opening";
    try {
      e = this.createTransport(e);
    } catch {
      this.transports.shift(), this.open();
      return;
    }
    e.open(), this.setTransport(e);
  }
  /**
   * Sets the current transport. Disables the existing one (if any).
   *
   * @private
   */
  setTransport(e) {
    this.transport && this.transport.removeAllListeners(), this.transport = e, e.on("drain", this.onDrain.bind(this)).on("packet", this.onPacket.bind(this)).on("error", this.onError.bind(this)).on("close", (n) => this.onClose("transport close", n));
  }
  /**
   * Probes a transport.
   *
   * @param {String} name - transport name
   * @private
   */
  probe(e) {
    let n = this.createTransport(e), s = !1;
    ut.priorWebsocketSuccess = !1;
    const a = () => {
      s || (n.send([{ type: "ping", data: "probe" }]), n.once("packet", (b) => {
        if (!s)
          if (b.type === "pong" && b.data === "probe") {
            if (this.upgrading = !0, this.emitReserved("upgrading", n), !n)
              return;
            ut.priorWebsocketSuccess = n.name === "websocket", this.transport.pause(() => {
              s || this.readyState !== "closed" && (m(), this.setTransport(n), n.send([{ type: "upgrade" }]), this.emitReserved("upgrade", n), n = null, this.upgrading = !1, this.flush());
            });
          } else {
            const E = new Error("probe error");
            E.transport = n.name, this.emitReserved("upgradeError", E);
          }
      }));
    };
    function c() {
      s || (s = !0, m(), n.close(), n = null);
    }
    const o = (b) => {
      const E = new Error("probe error: " + b);
      E.transport = n.name, c(), this.emitReserved("upgradeError", E);
    };
    function h() {
      o("transport closed");
    }
    function f() {
      o("socket closed");
    }
    function l(b) {
      n && b.name !== n.name && c();
    }
    const m = () => {
      n.removeListener("open", a), n.removeListener("error", o), n.removeListener("close", h), this.off("close", f), this.off("upgrading", l);
    };
    n.once("open", a), n.once("error", o), n.once("close", h), this.once("close", f), this.once("upgrading", l), this.upgrades.indexOf("webtransport") !== -1 && e !== "webtransport" ? this.setTimeoutFn(() => {
      s || n.open();
    }, 200) : n.open();
  }
  /**
   * Called when connection is deemed open.
   *
   * @private
   */
  onOpen() {
    if (this.readyState = "open", ut.priorWebsocketSuccess = this.transport.name === "websocket", this.emitReserved("open"), this.flush(), this.readyState === "open" && this.opts.upgrade) {
      let e = 0;
      const n = this.upgrades.length;
      for (; e < n; e++)
        this.probe(this.upgrades[e]);
    }
  }
  /**
   * Handles a packet.
   *
   * @private
   */
  onPacket(e) {
    if (this.readyState === "opening" || this.readyState === "open" || this.readyState === "closing")
      switch (this.emitReserved("packet", e), this.emitReserved("heartbeat"), this.resetPingTimeout(), e.type) {
        case "open":
          this.onHandshake(JSON.parse(e.data));
          break;
        case "ping":
          this.sendPacket("pong"), this.emitReserved("ping"), this.emitReserved("pong");
          break;
        case "error":
          const n = new Error("server error");
          n.code = e.data, this.onError(n);
          break;
        case "message":
          this.emitReserved("data", e.data), this.emitReserved("message", e.data);
          break;
      }
  }
  /**
   * Called upon handshake completion.
   *
   * @param {Object} data - handshake obj
   * @private
   */
  onHandshake(e) {
    this.emitReserved("handshake", e), this.id = e.sid, this.transport.query.sid = e.sid, this.upgrades = this.filterUpgrades(e.upgrades), this.pingInterval = e.pingInterval, this.pingTimeout = e.pingTimeout, this.maxPayload = e.maxPayload, this.onOpen(), this.readyState !== "closed" && this.resetPingTimeout();
  }
  /**
   * Sets and resets ping timeout timer based on server pings.
   *
   * @private
   */
  resetPingTimeout() {
    this.clearTimeoutFn(this.pingTimeoutTimer), this.pingTimeoutTimer = this.setTimeoutFn(() => {
      this.onClose("ping timeout");
    }, this.pingInterval + this.pingTimeout), this.opts.autoUnref && this.pingTimeoutTimer.unref();
  }
  /**
   * Called on `drain` event
   *
   * @private
   */
  onDrain() {
    this.writeBuffer.splice(0, this.prevBufferLen), this.prevBufferLen = 0, this.writeBuffer.length === 0 ? this.emitReserved("drain") : this.flush();
  }
  /**
   * Flush write buffers.
   *
   * @private
   */
  flush() {
    if (this.readyState !== "closed" && this.transport.writable && !this.upgrading && this.writeBuffer.length) {
      const e = this.getWritablePackets();
      this.transport.send(e), this.prevBufferLen = e.length, this.emitReserved("flush");
    }
  }
  /**
   * Ensure the encoded size of the writeBuffer is below the maxPayload value sent by the server (only for HTTP
   * long-polling)
   *
   * @private
   */
  getWritablePackets() {
    if (!(this.maxPayload && this.transport.name === "polling" && this.writeBuffer.length > 1))
      return this.writeBuffer;
    let n = 1;
    for (let s = 0; s < this.writeBuffer.length; s++) {
      const a = this.writeBuffer[s].data;
      if (a && (n += Ho(a)), s > 0 && n > this.maxPayload)
        return this.writeBuffer.slice(0, s);
      n += 2;
    }
    return this.writeBuffer;
  }
  /**
   * Sends a message.
   *
   * @param {String} msg - message.
   * @param {Object} options.
   * @param {Function} callback function.
   * @return {Socket} for chaining.
   */
  write(e, n, s) {
    return this.sendPacket("message", e, n, s), this;
  }
  send(e, n, s) {
    return this.sendPacket("message", e, n, s), this;
  }
  /**
   * Sends a packet.
   *
   * @param {String} type: packet type.
   * @param {String} data.
   * @param {Object} options.
   * @param {Function} fn - callback function.
   * @private
   */
  sendPacket(e, n, s, a) {
    if (typeof n == "function" && (a = n, n = void 0), typeof s == "function" && (a = s, s = null), this.readyState === "closing" || this.readyState === "closed")
      return;
    s = s || {}, s.compress = s.compress !== !1;
    const c = {
      type: e,
      data: n,
      options: s
    };
    this.emitReserved("packetCreate", c), this.writeBuffer.push(c), a && this.once("flush", a), this.flush();
  }
  /**
   * Closes the connection.
   */
  close() {
    const e = () => {
      this.onClose("forced close"), this.transport.close();
    }, n = () => {
      this.off("upgrade", n), this.off("upgradeError", n), e();
    }, s = () => {
      this.once("upgrade", n), this.once("upgradeError", n);
    };
    return (this.readyState === "opening" || this.readyState === "open") && (this.readyState = "closing", this.writeBuffer.length ? this.once("drain", () => {
      this.upgrading ? s() : e();
    }) : this.upgrading ? s() : e()), this;
  }
  /**
   * Called upon transport error
   *
   * @private
   */
  onError(e) {
    ut.priorWebsocketSuccess = !1, this.emitReserved("error", e), this.onClose("transport error", e);
  }
  /**
   * Called upon transport close.
   *
   * @private
   */
  onClose(e, n) {
    (this.readyState === "opening" || this.readyState === "open" || this.readyState === "closing") && (this.clearTimeoutFn(this.pingTimeoutTimer), this.transport.removeAllListeners("close"), this.transport.close(), this.transport.removeAllListeners(), typeof removeEventListener == "function" && (removeEventListener("beforeunload", this.beforeunloadEventListener, !1), removeEventListener("offline", this.offlineEventListener, !1)), this.readyState = "closed", this.id = null, this.emitReserved("close", e, n), this.writeBuffer = [], this.prevBufferLen = 0);
  }
  /**
   * Filters upgrades, returning only those matching client transports.
   *
   * @param {Array} upgrades - server upgrades
   * @private
   */
  filterUpgrades(e) {
    const n = [];
    let s = 0;
    const a = e.length;
    for (; s < a; s++)
      ~this.transports.indexOf(e[s]) && n.push(e[s]);
    return n;
  }
};
$r.protocol = Ur;
function ca(t, e = "", n) {
  let s = t;
  n = n || typeof location < "u" && location, t == null && (t = n.protocol + "//" + n.host), typeof t == "string" && (t.charAt(0) === "/" && (t.charAt(1) === "/" ? t = n.protocol + t : t = n.host + t), /^(https?|wss?):\/\//.test(t) || (typeof n < "u" ? t = n.protocol + "//" + t : t = "https://" + t), s = Jn(t)), s.port || (/^(http|ws)$/.test(s.protocol) ? s.port = "80" : /^(http|ws)s$/.test(s.protocol) && (s.port = "443")), s.path = s.path || "/";
  const c = s.host.indexOf(":") !== -1 ? "[" + s.host + "]" : s.host;
  return s.id = s.protocol + "://" + c + ":" + s.port + e, s.href = s.protocol + "://" + c + (n && n.port === s.port ? "" : ":" + s.port), s;
}
const ua = typeof ArrayBuffer == "function", la = (t) => typeof ArrayBuffer.isView == "function" ? ArrayBuffer.isView(t) : t.buffer instanceof ArrayBuffer, Hr = Object.prototype.toString, fa = typeof Blob == "function" || typeof Blob < "u" && Hr.call(Blob) === "[object BlobConstructor]", ha = typeof File == "function" || typeof File < "u" && Hr.call(File) === "[object FileConstructor]";
function ss(t) {
  return ua && (t instanceof ArrayBuffer || la(t)) || fa && t instanceof Blob || ha && t instanceof File;
}
function Qt(t, e) {
  if (!t || typeof t != "object")
    return !1;
  if (Array.isArray(t)) {
    for (let n = 0, s = t.length; n < s; n++)
      if (Qt(t[n]))
        return !0;
    return !1;
  }
  if (ss(t))
    return !0;
  if (t.toJSON && typeof t.toJSON == "function" && arguments.length === 1)
    return Qt(t.toJSON(), !0);
  for (const n in t)
    if (Object.prototype.hasOwnProperty.call(t, n) && Qt(t[n]))
      return !0;
  return !1;
}
function da(t) {
  const e = [], n = t.data, s = t;
  return s.data = Kn(n, e), s.attachments = e.length, { packet: s, buffers: e };
}
function Kn(t, e) {
  if (!t)
    return t;
  if (ss(t)) {
    const n = { _placeholder: !0, num: e.length };
    return e.push(t), n;
  } else if (Array.isArray(t)) {
    const n = new Array(t.length);
    for (let s = 0; s < t.length; s++)
      n[s] = Kn(t[s], e);
    return n;
  } else if (typeof t == "object" && !(t instanceof Date)) {
    const n = {};
    for (const s in t)
      Object.prototype.hasOwnProperty.call(t, s) && (n[s] = Kn(t[s], e));
    return n;
  }
  return t;
}
function pa(t, e) {
  return t.data = Gn(t.data, e), delete t.attachments, t;
}
function Gn(t, e) {
  if (!t)
    return t;
  if (t && t._placeholder === !0) {
    if (typeof t.num == "number" && t.num >= 0 && t.num < e.length)
      return e[t.num];
    throw new Error("illegal attachments");
  } else if (Array.isArray(t))
    for (let n = 0; n < t.length; n++)
      t[n] = Gn(t[n], e);
  else if (typeof t == "object")
    for (const n in t)
      Object.prototype.hasOwnProperty.call(t, n) && (t[n] = Gn(t[n], e));
  return t;
}
const ma = [
  "connect",
  "connect_error",
  "disconnect",
  "disconnecting",
  "newListener",
  "removeListener"
  // used by the Node.js EventEmitter
], ya = 5;
var P;
(function(t) {
  t[t.CONNECT = 0] = "CONNECT", t[t.DISCONNECT = 1] = "DISCONNECT", t[t.EVENT = 2] = "EVENT", t[t.ACK = 3] = "ACK", t[t.CONNECT_ERROR = 4] = "CONNECT_ERROR", t[t.BINARY_EVENT = 5] = "BINARY_EVENT", t[t.BINARY_ACK = 6] = "BINARY_ACK";
})(P || (P = {}));
class ga {
  /**
   * Encoder constructor
   *
   * @param {function} replacer - custom replacer to pass down to JSON.parse
   */
  constructor(e) {
    this.replacer = e;
  }
  /**
   * Encode a packet as a single string if non-binary, or as a
   * buffer sequence, depending on packet type.
   *
   * @param {Object} obj - packet object
   */
  encode(e) {
    return (e.type === P.EVENT || e.type === P.ACK) && Qt(e) ? this.encodeAsBinary({
      type: e.type === P.EVENT ? P.BINARY_EVENT : P.BINARY_ACK,
      nsp: e.nsp,
      data: e.data,
      id: e.id
    }) : [this.encodeAsString(e)];
  }
  /**
   * Encode packet as string.
   */
  encodeAsString(e) {
    let n = "" + e.type;
    return (e.type === P.BINARY_EVENT || e.type === P.BINARY_ACK) && (n += e.attachments + "-"), e.nsp && e.nsp !== "/" && (n += e.nsp + ","), e.id != null && (n += e.id), e.data != null && (n += JSON.stringify(e.data, this.replacer)), n;
  }
  /**
   * Encode packet as 'buffer sequence' by removing blobs, and
   * deconstructing packet into object with placeholders and
   * a list of buffers.
   */
  encodeAsBinary(e) {
    const n = da(e), s = this.encodeAsString(n.packet), a = n.buffers;
    return a.unshift(s), a;
  }
}
function dr(t) {
  return Object.prototype.toString.call(t) === "[object Object]";
}
class rs extends se {
  /**
   * Decoder constructor
   *
   * @param {function} reviver - custom reviver to pass down to JSON.stringify
   */
  constructor(e) {
    super(), this.reviver = e;
  }
  /**
   * Decodes an encoded packet string into packet JSON.
   *
   * @param {String} obj - encoded packet
   */
  add(e) {
    let n;
    if (typeof e == "string") {
      if (this.reconstructor)
        throw new Error("got plaintext data when reconstructing a packet");
      n = this.decodeString(e);
      const s = n.type === P.BINARY_EVENT;
      s || n.type === P.BINARY_ACK ? (n.type = s ? P.EVENT : P.ACK, this.reconstructor = new wa(n), n.attachments === 0 && super.emitReserved("decoded", n)) : super.emitReserved("decoded", n);
    } else if (ss(e) || e.base64)
      if (this.reconstructor)
        n = this.reconstructor.takeBinaryData(e), n && (this.reconstructor = null, super.emitReserved("decoded", n));
      else
        throw new Error("got binary data when not reconstructing a packet");
    else
      throw new Error("Unknown type: " + e);
  }
  /**
   * Decode a packet String (JSON data)
   *
   * @param {String} str
   * @return {Object} packet
   */
  decodeString(e) {
    let n = 0;
    const s = {
      type: Number(e.charAt(0))
    };
    if (P[s.type] === void 0)
      throw new Error("unknown packet type " + s.type);
    if (s.type === P.BINARY_EVENT || s.type === P.BINARY_ACK) {
      const c = n + 1;
      for (; e.charAt(++n) !== "-" && n != e.length; )
        ;
      const o = e.substring(c, n);
      if (o != Number(o) || e.charAt(n) !== "-")
        throw new Error("Illegal attachments");
      s.attachments = Number(o);
    }
    if (e.charAt(n + 1) === "/") {
      const c = n + 1;
      for (; ++n && !(e.charAt(n) === "," || n === e.length); )
        ;
      s.nsp = e.substring(c, n);
    } else
      s.nsp = "/";
    const a = e.charAt(n + 1);
    if (a !== "" && Number(a) == a) {
      const c = n + 1;
      for (; ++n; ) {
        const o = e.charAt(n);
        if (o == null || Number(o) != o) {
          --n;
          break;
        }
        if (n === e.length)
          break;
      }
      s.id = Number(e.substring(c, n + 1));
    }
    if (e.charAt(++n)) {
      const c = this.tryParse(e.substr(n));
      if (rs.isPayloadValid(s.type, c))
        s.data = c;
      else
        throw new Error("invalid payload");
    }
    return s;
  }
  tryParse(e) {
    try {
      return JSON.parse(e, this.reviver);
    } catch {
      return !1;
    }
  }
  static isPayloadValid(e, n) {
    switch (e) {
      case P.CONNECT:
        return dr(n);
      case P.DISCONNECT:
        return n === void 0;
      case P.CONNECT_ERROR:
        return typeof n == "string" || dr(n);
      case P.EVENT:
      case P.BINARY_EVENT:
        return Array.isArray(n) && (typeof n[0] == "number" || typeof n[0] == "string" && ma.indexOf(n[0]) === -1);
      case P.ACK:
      case P.BINARY_ACK:
        return Array.isArray(n);
    }
  }
  /**
   * Deallocates a parser's resources
   */
  destroy() {
    this.reconstructor && (this.reconstructor.finishedReconstruction(), this.reconstructor = null);
  }
}
class wa {
  constructor(e) {
    this.packet = e, this.buffers = [], this.reconPack = e;
  }
  /**
   * Method to be called when binary data received from connection
   * after a BINARY_EVENT packet.
   *
   * @param {Buffer | ArrayBuffer} binData - the raw binary data received
   * @return {null | Object} returns null if more binary data is expected or
   *   a reconstructed packet object if all buffers have been received.
   */
  takeBinaryData(e) {
    if (this.buffers.push(e), this.buffers.length === this.reconPack.attachments) {
      const n = pa(this.reconPack, this.buffers);
      return this.finishedReconstruction(), n;
    }
    return null;
  }
  /**
   * Cleans up binary packet reconstruction variables.
   */
  finishedReconstruction() {
    this.reconPack = null, this.buffers = [];
  }
}
const ba = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Decoder: rs,
  Encoder: ga,
  get PacketType() {
    return P;
  },
  protocol: ya
}, Symbol.toStringTag, { value: "Module" }));
function Ne(t, e, n) {
  return t.on(e, n), function() {
    t.off(e, n);
  };
}
const _a = Object.freeze({
  connect: 1,
  connect_error: 1,
  disconnect: 1,
  disconnecting: 1,
  // EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
  newListener: 1,
  removeListener: 1
});
class Wr extends se {
  /**
   * `Socket` constructor.
   */
  constructor(e, n, s) {
    super(), this.connected = !1, this.recovered = !1, this.receiveBuffer = [], this.sendBuffer = [], this._queue = [], this._queueSeq = 0, this.ids = 0, this.acks = {}, this.flags = {}, this.io = e, this.nsp = n, s && s.auth && (this.auth = s.auth), this._opts = Object.assign({}, s), this.io._autoConnect && this.open();
  }
  /**
   * Whether the socket is currently disconnected
   *
   * @example
   * const socket = io();
   *
   * socket.on("connect", () => {
   *   console.log(socket.disconnected); // false
   * });
   *
   * socket.on("disconnect", () => {
   *   console.log(socket.disconnected); // true
   * });
   */
  get disconnected() {
    return !this.connected;
  }
  /**
   * Subscribe to open, close and packet events
   *
   * @private
   */
  subEvents() {
    if (this.subs)
      return;
    const e = this.io;
    this.subs = [
      Ne(e, "open", this.onopen.bind(this)),
      Ne(e, "packet", this.onpacket.bind(this)),
      Ne(e, "error", this.onerror.bind(this)),
      Ne(e, "close", this.onclose.bind(this))
    ];
  }
  /**
   * Whether the Socket will try to reconnect when its Manager connects or reconnects.
   *
   * @example
   * const socket = io();
   *
   * console.log(socket.active); // true
   *
   * socket.on("disconnect", (reason) => {
   *   if (reason === "io server disconnect") {
   *     // the disconnection was initiated by the server, you need to manually reconnect
   *     console.log(socket.active); // false
   *   }
   *   // else the socket will automatically try to reconnect
   *   console.log(socket.active); // true
   * });
   */
  get active() {
    return !!this.subs;
  }
  /**
   * "Opens" the socket.
   *
   * @example
   * const socket = io({
   *   autoConnect: false
   * });
   *
   * socket.connect();
   */
  connect() {
    return this.connected ? this : (this.subEvents(), this.io._reconnecting || this.io.open(), this.io._readyState === "open" && this.onopen(), this);
  }
  /**
   * Alias for {@link connect()}.
   */
  open() {
    return this.connect();
  }
  /**
   * Sends a `message` event.
   *
   * This method mimics the WebSocket.send() method.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
   *
   * @example
   * socket.send("hello");
   *
   * // this is equivalent to
   * socket.emit("message", "hello");
   *
   * @return self
   */
  send(...e) {
    return e.unshift("message"), this.emit.apply(this, e), this;
  }
  /**
   * Override `emit`.
   * If the event is in `events`, it's emitted normally.
   *
   * @example
   * socket.emit("hello", "world");
   *
   * // all serializable datastructures are supported (no need to call JSON.stringify)
   * socket.emit("hello", 1, "2", { 3: ["4"], 5: Uint8Array.from([6]) });
   *
   * // with an acknowledgement from the server
   * socket.emit("hello", "world", (val) => {
   *   // ...
   * });
   *
   * @return self
   */
  emit(e, ...n) {
    if (_a.hasOwnProperty(e))
      throw new Error('"' + e.toString() + '" is a reserved event name');
    if (n.unshift(e), this._opts.retries && !this.flags.fromQueue && !this.flags.volatile)
      return this._addToQueue(n), this;
    const s = {
      type: P.EVENT,
      data: n
    };
    if (s.options = {}, s.options.compress = this.flags.compress !== !1, typeof n[n.length - 1] == "function") {
      const o = this.ids++, h = n.pop();
      this._registerAckCallback(o, h), s.id = o;
    }
    const a = this.io.engine && this.io.engine.transport && this.io.engine.transport.writable;
    return this.flags.volatile && (!a || !this.connected) || (this.connected ? (this.notifyOutgoingListeners(s), this.packet(s)) : this.sendBuffer.push(s)), this.flags = {}, this;
  }
  /**
   * @private
   */
  _registerAckCallback(e, n) {
    var s;
    const a = (s = this.flags.timeout) !== null && s !== void 0 ? s : this._opts.ackTimeout;
    if (a === void 0) {
      this.acks[e] = n;
      return;
    }
    const c = this.io.setTimeoutFn(() => {
      delete this.acks[e];
      for (let o = 0; o < this.sendBuffer.length; o++)
        this.sendBuffer[o].id === e && this.sendBuffer.splice(o, 1);
      n.call(this, new Error("operation has timed out"));
    }, a);
    this.acks[e] = (...o) => {
      this.io.clearTimeoutFn(c), n.apply(this, [null, ...o]);
    };
  }
  /**
   * Emits an event and waits for an acknowledgement
   *
   * @example
   * // without timeout
   * const response = await socket.emitWithAck("hello", "world");
   *
   * // with a specific timeout
   * try {
   *   const response = await socket.timeout(1000).emitWithAck("hello", "world");
   * } catch (err) {
   *   // the server did not acknowledge the event in the given delay
   * }
   *
   * @return a Promise that will be fulfilled when the server acknowledges the event
   */
  emitWithAck(e, ...n) {
    const s = this.flags.timeout !== void 0 || this._opts.ackTimeout !== void 0;
    return new Promise((a, c) => {
      n.push((o, h) => s ? o ? c(o) : a(h) : a(o)), this.emit(e, ...n);
    });
  }
  /**
   * Add the packet to the queue.
   * @param args
   * @private
   */
  _addToQueue(e) {
    let n;
    typeof e[e.length - 1] == "function" && (n = e.pop());
    const s = {
      id: this._queueSeq++,
      tryCount: 0,
      pending: !1,
      args: e,
      flags: Object.assign({ fromQueue: !0 }, this.flags)
    };
    e.push((a, ...c) => s !== this._queue[0] ? void 0 : (a !== null ? s.tryCount > this._opts.retries && (this._queue.shift(), n && n(a)) : (this._queue.shift(), n && n(null, ...c)), s.pending = !1, this._drainQueue())), this._queue.push(s), this._drainQueue();
  }
  /**
   * Send the first packet of the queue, and wait for an acknowledgement from the server.
   * @param force - whether to resend a packet that has not been acknowledged yet
   *
   * @private
   */
  _drainQueue(e = !1) {
    if (!this.connected || this._queue.length === 0)
      return;
    const n = this._queue[0];
    n.pending && !e || (n.pending = !0, n.tryCount++, this.flags = n.flags, this.emit.apply(this, n.args));
  }
  /**
   * Sends a packet.
   *
   * @param packet
   * @private
   */
  packet(e) {
    e.nsp = this.nsp, this.io._packet(e);
  }
  /**
   * Called upon engine `open`.
   *
   * @private
   */
  onopen() {
    typeof this.auth == "function" ? this.auth((e) => {
      this._sendConnectPacket(e);
    }) : this._sendConnectPacket(this.auth);
  }
  /**
   * Sends a CONNECT packet to initiate the Socket.IO session.
   *
   * @param data
   * @private
   */
  _sendConnectPacket(e) {
    this.packet({
      type: P.CONNECT,
      data: this._pid ? Object.assign({ pid: this._pid, offset: this._lastOffset }, e) : e
    });
  }
  /**
   * Called upon engine or manager `error`.
   *
   * @param err
   * @private
   */
  onerror(e) {
    this.connected || this.emitReserved("connect_error", e);
  }
  /**
   * Called upon engine `close`.
   *
   * @param reason
   * @param description
   * @private
   */
  onclose(e, n) {
    this.connected = !1, delete this.id, this.emitReserved("disconnect", e, n);
  }
  /**
   * Called with socket packet.
   *
   * @param packet
   * @private
   */
  onpacket(e) {
    if (e.nsp === this.nsp)
      switch (e.type) {
        case P.CONNECT:
          e.data && e.data.sid ? this.onconnect(e.data.sid, e.data.pid) : this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
          break;
        case P.EVENT:
        case P.BINARY_EVENT:
          this.onevent(e);
          break;
        case P.ACK:
        case P.BINARY_ACK:
          this.onack(e);
          break;
        case P.DISCONNECT:
          this.ondisconnect();
          break;
        case P.CONNECT_ERROR:
          this.destroy();
          const s = new Error(e.data.message);
          s.data = e.data.data, this.emitReserved("connect_error", s);
          break;
      }
  }
  /**
   * Called upon a server event.
   *
   * @param packet
   * @private
   */
  onevent(e) {
    const n = e.data || [];
    e.id != null && n.push(this.ack(e.id)), this.connected ? this.emitEvent(n) : this.receiveBuffer.push(Object.freeze(n));
  }
  emitEvent(e) {
    if (this._anyListeners && this._anyListeners.length) {
      const n = this._anyListeners.slice();
      for (const s of n)
        s.apply(this, e);
    }
    super.emit.apply(this, e), this._pid && e.length && typeof e[e.length - 1] == "string" && (this._lastOffset = e[e.length - 1]);
  }
  /**
   * Produces an ack callback to emit with an event.
   *
   * @private
   */
  ack(e) {
    const n = this;
    let s = !1;
    return function(...a) {
      s || (s = !0, n.packet({
        type: P.ACK,
        id: e,
        data: a
      }));
    };
  }
  /**
   * Called upon a server acknowlegement.
   *
   * @param packet
   * @private
   */
  onack(e) {
    const n = this.acks[e.id];
    typeof n == "function" && (n.apply(this, e.data), delete this.acks[e.id]);
  }
  /**
   * Called upon server connect.
   *
   * @private
   */
  onconnect(e, n) {
    this.id = e, this.recovered = n && this._pid === n, this._pid = n, this.connected = !0, this.emitBuffered(), this.emitReserved("connect"), this._drainQueue(!0);
  }
  /**
   * Emit buffered events (received and emitted).
   *
   * @private
   */
  emitBuffered() {
    this.receiveBuffer.forEach((e) => this.emitEvent(e)), this.receiveBuffer = [], this.sendBuffer.forEach((e) => {
      this.notifyOutgoingListeners(e), this.packet(e);
    }), this.sendBuffer = [];
  }
  /**
   * Called upon server disconnect.
   *
   * @private
   */
  ondisconnect() {
    this.destroy(), this.onclose("io server disconnect");
  }
  /**
   * Called upon forced client/server side disconnections,
   * this method ensures the manager stops tracking us and
   * that reconnections don't get triggered for this.
   *
   * @private
   */
  destroy() {
    this.subs && (this.subs.forEach((e) => e()), this.subs = void 0), this.io._destroy(this);
  }
  /**
   * Disconnects the socket manually. In that case, the socket will not try to reconnect.
   *
   * If this is the last active Socket instance of the {@link Manager}, the low-level connection will be closed.
   *
   * @example
   * const socket = io();
   *
   * socket.on("disconnect", (reason) => {
   *   // console.log(reason); prints "io client disconnect"
   * });
   *
   * socket.disconnect();
   *
   * @return self
   */
  disconnect() {
    return this.connected && this.packet({ type: P.DISCONNECT }), this.destroy(), this.connected && this.onclose("io client disconnect"), this;
  }
  /**
   * Alias for {@link disconnect()}.
   *
   * @return self
   */
  close() {
    return this.disconnect();
  }
  /**
   * Sets the compress flag.
   *
   * @example
   * socket.compress(false).emit("hello");
   *
   * @param compress - if `true`, compresses the sending data
   * @return self
   */
  compress(e) {
    return this.flags.compress = e, this;
  }
  /**
   * Sets a modifier for a subsequent event emission that the event message will be dropped when this socket is not
   * ready to send messages.
   *
   * @example
   * socket.volatile.emit("hello"); // the server may or may not receive it
   *
   * @returns self
   */
  get volatile() {
    return this.flags.volatile = !0, this;
  }
  /**
   * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
   * given number of milliseconds have elapsed without an acknowledgement from the server:
   *
   * @example
   * socket.timeout(5000).emit("my-event", (err) => {
   *   if (err) {
   *     // the server did not acknowledge the event in the given delay
   *   }
   * });
   *
   * @returns self
   */
  timeout(e) {
    return this.flags.timeout = e, this;
  }
  /**
   * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
   * callback.
   *
   * @example
   * socket.onAny((event, ...args) => {
   *   console.log(`got ${event}`);
   * });
   *
   * @param listener
   */
  onAny(e) {
    return this._anyListeners = this._anyListeners || [], this._anyListeners.push(e), this;
  }
  /**
   * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
   * callback. The listener is added to the beginning of the listeners array.
   *
   * @example
   * socket.prependAny((event, ...args) => {
   *   console.log(`got event ${event}`);
   * });
   *
   * @param listener
   */
  prependAny(e) {
    return this._anyListeners = this._anyListeners || [], this._anyListeners.unshift(e), this;
  }
  /**
   * Removes the listener that will be fired when any event is emitted.
   *
   * @example
   * const catchAllListener = (event, ...args) => {
   *   console.log(`got event ${event}`);
   * }
   *
   * socket.onAny(catchAllListener);
   *
   * // remove a specific listener
   * socket.offAny(catchAllListener);
   *
   * // or remove all listeners
   * socket.offAny();
   *
   * @param listener
   */
  offAny(e) {
    if (!this._anyListeners)
      return this;
    if (e) {
      const n = this._anyListeners;
      for (let s = 0; s < n.length; s++)
        if (e === n[s])
          return n.splice(s, 1), this;
    } else
      this._anyListeners = [];
    return this;
  }
  /**
   * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
   * e.g. to remove listeners.
   */
  listenersAny() {
    return this._anyListeners || [];
  }
  /**
   * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
   * callback.
   *
   * Note: acknowledgements sent to the server are not included.
   *
   * @example
   * socket.onAnyOutgoing((event, ...args) => {
   *   console.log(`sent event ${event}`);
   * });
   *
   * @param listener
   */
  onAnyOutgoing(e) {
    return this._anyOutgoingListeners = this._anyOutgoingListeners || [], this._anyOutgoingListeners.push(e), this;
  }
  /**
   * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
   * callback. The listener is added to the beginning of the listeners array.
   *
   * Note: acknowledgements sent to the server are not included.
   *
   * @example
   * socket.prependAnyOutgoing((event, ...args) => {
   *   console.log(`sent event ${event}`);
   * });
   *
   * @param listener
   */
  prependAnyOutgoing(e) {
    return this._anyOutgoingListeners = this._anyOutgoingListeners || [], this._anyOutgoingListeners.unshift(e), this;
  }
  /**
   * Removes the listener that will be fired when any event is emitted.
   *
   * @example
   * const catchAllListener = (event, ...args) => {
   *   console.log(`sent event ${event}`);
   * }
   *
   * socket.onAnyOutgoing(catchAllListener);
   *
   * // remove a specific listener
   * socket.offAnyOutgoing(catchAllListener);
   *
   * // or remove all listeners
   * socket.offAnyOutgoing();
   *
   * @param [listener] - the catch-all listener (optional)
   */
  offAnyOutgoing(e) {
    if (!this._anyOutgoingListeners)
      return this;
    if (e) {
      const n = this._anyOutgoingListeners;
      for (let s = 0; s < n.length; s++)
        if (e === n[s])
          return n.splice(s, 1), this;
    } else
      this._anyOutgoingListeners = [];
    return this;
  }
  /**
   * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
   * e.g. to remove listeners.
   */
  listenersAnyOutgoing() {
    return this._anyOutgoingListeners || [];
  }
  /**
   * Notify the listeners for each packet sent
   *
   * @param packet
   *
   * @private
   */
  notifyOutgoingListeners(e) {
    if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
      const n = this._anyOutgoingListeners.slice();
      for (const s of n)
        s.apply(this, e.data);
    }
  }
}
function dt(t) {
  t = t || {}, this.ms = t.min || 100, this.max = t.max || 1e4, this.factor = t.factor || 2, this.jitter = t.jitter > 0 && t.jitter <= 1 ? t.jitter : 0, this.attempts = 0;
}
dt.prototype.duration = function() {
  var t = this.ms * Math.pow(this.factor, this.attempts++);
  if (this.jitter) {
    var e = Math.random(), n = Math.floor(e * this.jitter * t);
    t = (Math.floor(e * 10) & 1) == 0 ? t - n : t + n;
  }
  return Math.min(t, this.max) | 0;
};
dt.prototype.reset = function() {
  this.attempts = 0;
};
dt.prototype.setMin = function(t) {
  this.ms = t;
};
dt.prototype.setMax = function(t) {
  this.max = t;
};
dt.prototype.setJitter = function(t) {
  this.jitter = t;
};
class Xn extends se {
  constructor(e, n) {
    var s;
    super(), this.nsps = {}, this.subs = [], e && typeof e == "object" && (n = e, e = void 0), n = n || {}, n.path = n.path || "/socket.io", this.opts = n, nn(this, n), this.reconnection(n.reconnection !== !1), this.reconnectionAttempts(n.reconnectionAttempts || 1 / 0), this.reconnectionDelay(n.reconnectionDelay || 1e3), this.reconnectionDelayMax(n.reconnectionDelayMax || 5e3), this.randomizationFactor((s = n.randomizationFactor) !== null && s !== void 0 ? s : 0.5), this.backoff = new dt({
      min: this.reconnectionDelay(),
      max: this.reconnectionDelayMax(),
      jitter: this.randomizationFactor()
    }), this.timeout(n.timeout == null ? 2e4 : n.timeout), this._readyState = "closed", this.uri = e;
    const a = n.parser || ba;
    this.encoder = new a.Encoder(), this.decoder = new a.Decoder(), this._autoConnect = n.autoConnect !== !1, this._autoConnect && this.open();
  }
  reconnection(e) {
    return arguments.length ? (this._reconnection = !!e, this) : this._reconnection;
  }
  reconnectionAttempts(e) {
    return e === void 0 ? this._reconnectionAttempts : (this._reconnectionAttempts = e, this);
  }
  reconnectionDelay(e) {
    var n;
    return e === void 0 ? this._reconnectionDelay : (this._reconnectionDelay = e, (n = this.backoff) === null || n === void 0 || n.setMin(e), this);
  }
  randomizationFactor(e) {
    var n;
    return e === void 0 ? this._randomizationFactor : (this._randomizationFactor = e, (n = this.backoff) === null || n === void 0 || n.setJitter(e), this);
  }
  reconnectionDelayMax(e) {
    var n;
    return e === void 0 ? this._reconnectionDelayMax : (this._reconnectionDelayMax = e, (n = this.backoff) === null || n === void 0 || n.setMax(e), this);
  }
  timeout(e) {
    return arguments.length ? (this._timeout = e, this) : this._timeout;
  }
  /**
   * Starts trying to reconnect if reconnection is enabled and we have not
   * started reconnecting yet
   *
   * @private
   */
  maybeReconnectOnOpen() {
    !this._reconnecting && this._reconnection && this.backoff.attempts === 0 && this.reconnect();
  }
  /**
   * Sets the current transport `socket`.
   *
   * @param {Function} fn - optional, callback
   * @return self
   * @public
   */
  open(e) {
    if (~this._readyState.indexOf("open"))
      return this;
    this.engine = new $r(this.uri, this.opts);
    const n = this.engine, s = this;
    this._readyState = "opening", this.skipReconnect = !1;
    const a = Ne(n, "open", function() {
      s.onopen(), e && e();
    }), c = (h) => {
      this.cleanup(), this._readyState = "closed", this.emitReserved("error", h), e ? e(h) : this.maybeReconnectOnOpen();
    }, o = Ne(n, "error", c);
    if (this._timeout !== !1) {
      const h = this._timeout, f = this.setTimeoutFn(() => {
        a(), c(new Error("timeout")), n.close();
      }, h);
      this.opts.autoUnref && f.unref(), this.subs.push(() => {
        this.clearTimeoutFn(f);
      });
    }
    return this.subs.push(a), this.subs.push(o), this;
  }
  /**
   * Alias for open()
   *
   * @return self
   * @public
   */
  connect(e) {
    return this.open(e);
  }
  /**
   * Called upon transport open.
   *
   * @private
   */
  onopen() {
    this.cleanup(), this._readyState = "open", this.emitReserved("open");
    const e = this.engine;
    this.subs.push(Ne(e, "ping", this.onping.bind(this)), Ne(e, "data", this.ondata.bind(this)), Ne(e, "error", this.onerror.bind(this)), Ne(e, "close", this.onclose.bind(this)), Ne(this.decoder, "decoded", this.ondecoded.bind(this)));
  }
  /**
   * Called upon a ping.
   *
   * @private
   */
  onping() {
    this.emitReserved("ping");
  }
  /**
   * Called with data.
   *
   * @private
   */
  ondata(e) {
    try {
      this.decoder.add(e);
    } catch (n) {
      this.onclose("parse error", n);
    }
  }
  /**
   * Called when parser fully decodes a packet.
   *
   * @private
   */
  ondecoded(e) {
    ns(() => {
      this.emitReserved("packet", e);
    }, this.setTimeoutFn);
  }
  /**
   * Called upon socket error.
   *
   * @private
   */
  onerror(e) {
    this.emitReserved("error", e);
  }
  /**
   * Creates a new socket for the given `nsp`.
   *
   * @return {Socket}
   * @public
   */
  socket(e, n) {
    let s = this.nsps[e];
    return s ? this._autoConnect && !s.active && s.connect() : (s = new Wr(this, e, n), this.nsps[e] = s), s;
  }
  /**
   * Called upon a socket close.
   *
   * @param socket
   * @private
   */
  _destroy(e) {
    const n = Object.keys(this.nsps);
    for (const s of n)
      if (this.nsps[s].active)
        return;
    this._close();
  }
  /**
   * Writes a packet.
   *
   * @param packet
   * @private
   */
  _packet(e) {
    const n = this.encoder.encode(e);
    for (let s = 0; s < n.length; s++)
      this.engine.write(n[s], e.options);
  }
  /**
   * Clean up transport subscriptions and packet buffer.
   *
   * @private
   */
  cleanup() {
    this.subs.forEach((e) => e()), this.subs.length = 0, this.decoder.destroy();
  }
  /**
   * Close the current socket.
   *
   * @private
   */
  _close() {
    this.skipReconnect = !0, this._reconnecting = !1, this.onclose("forced close"), this.engine && this.engine.close();
  }
  /**
   * Alias for close()
   *
   * @private
   */
  disconnect() {
    return this._close();
  }
  /**
   * Called upon engine close.
   *
   * @private
   */
  onclose(e, n) {
    this.cleanup(), this.backoff.reset(), this._readyState = "closed", this.emitReserved("close", e, n), this._reconnection && !this.skipReconnect && this.reconnect();
  }
  /**
   * Attempt a reconnection.
   *
   * @private
   */
  reconnect() {
    if (this._reconnecting || this.skipReconnect)
      return this;
    const e = this;
    if (this.backoff.attempts >= this._reconnectionAttempts)
      this.backoff.reset(), this.emitReserved("reconnect_failed"), this._reconnecting = !1;
    else {
      const n = this.backoff.duration();
      this._reconnecting = !0;
      const s = this.setTimeoutFn(() => {
        e.skipReconnect || (this.emitReserved("reconnect_attempt", e.backoff.attempts), !e.skipReconnect && e.open((a) => {
          a ? (e._reconnecting = !1, e.reconnect(), this.emitReserved("reconnect_error", a)) : e.onreconnect();
        }));
      }, n);
      this.opts.autoUnref && s.unref(), this.subs.push(() => {
        this.clearTimeoutFn(s);
      });
    }
  }
  /**
   * Called upon successful reconnect.
   *
   * @private
   */
  onreconnect() {
    const e = this.backoff.attempts;
    this._reconnecting = !1, this.backoff.reset(), this.emitReserved("reconnect", e);
  }
}
const wt = {};
function Zt(t, e) {
  typeof t == "object" && (e = t, t = void 0), e = e || {};
  const n = ca(t, e.path || "/socket.io"), s = n.source, a = n.id, c = n.path, o = wt[a] && c in wt[a].nsps, h = e.forceNew || e["force new connection"] || e.multiplex === !1 || o;
  let f;
  return h ? f = new Xn(s, e) : (wt[a] || (wt[a] = new Xn(s, e)), f = wt[a]), n.query && !e.query && (e.query = n.queryKey), f.socket(n.path, e);
}
Object.assign(Zt, {
  Manager: Xn,
  Socket: Wr,
  io: Zt,
  connect: Zt
});
class va {
  constructor(e, n, s, a) {
    Ge(this, "socket_port");
    Ge(this, "host");
    Ge(this, "port");
    Ge(this, "protocol");
    Ge(this, "url");
    Ge(this, "site_name");
    Ge(this, "socket");
    var c, o, h, f;
    if (this.socket_port = s ?? "9000", this.host = (c = window.location) == null ? void 0 : c.hostname, this.port = (o = window.location) != null && o.port ? `:${this.socket_port}` : "", this.protocol = ((h = window.location) == null ? void 0 : h.protocol) === "https:" ? "https" : "http", e) {
      let l = new URL(e);
      l.port = "", s ? (l.port = s, this.url = l.toString()) : this.url = l.toString();
    } else
      this.url = `${this.protocol}://${this.host}${this.port}/`;
    n && (this.url = `${this.url}${n}`), this.site_name = n, this.socket = Zt(`${this.url}`, {
      withCredentials: !0,
      secure: this.protocol === "https",
      extraHeaders: a && a.useToken === !0 ? {
        Authorization: `${a.type} ${(f = a.token) == null ? void 0 : f.call(a)}`
      } : {}
    });
  }
}
const re = pr(null), La = ({ url: t = "", tokenParams: e, socketPort: n, swrConfig: s, siteName: a, enableSocket: c = !0, children: o, customHeaders: h }) => {
  const f = vt(() => {
    const l = new Ji.FrappeApp(t, e, void 0, h);
    return {
      url: t,
      tokenParams: e,
      app: l,
      auth: l.auth(),
      db: l.db(),
      call: l.call(),
      file: l.file(),
      socket: c ? new va(t, a, n, e).socket : void 0,
      enableSocket: c,
      socketPort: n
    };
  }, [t, e, n, c, h]);
  return /* @__PURE__ */ Is(re.Provider, { value: f, children: /* @__PURE__ */ Is(So, { value: s, children: o }) });
}, Da = (t) => {
  const { url: e, auth: n, tokenParams: s } = X(re), [a, c] = M(), o = I(() => {
    const v = document.cookie.split(";").find((R) => R.trim().startsWith("user_id="));
    if (v) {
      const R = v.split("=")[1];
      c(R && R !== "Guest" ? R : null);
    } else
      c(null);
  }, []);
  ft(() => {
    s && s.useToken ? c(null) : o();
  }, []);
  const { data: h, error: f, isLoading: l, isValidating: m, mutate: b } = ht(
    () => s && s.useToken || a ? `${e}/api/method/frappe.auth.get_logged_user` : null,
    () => n.getLoggedInUser(),
    {
      onError: () => {
        c(null);
      },
      shouldRetryOnError: !1,
      revalidateOnFocus: !1,
      ...t
    }
  ), E = I(async (v) => n.loginWithUsernamePassword(v).then((R) => (o(), R)), []), y = I(async () => n.logout().then(() => b(null)).then(() => c(null)), []);
  return {
    isLoading: a === void 0 || l,
    currentUser: h,
    isValidating: m,
    error: f,
    login: E,
    logout: y,
    updateCurrentUser: b,
    getUserCookie: o
  };
}, sn = (t, e, n) => {
  let s = `${e}/api/resource/`;
  return n ? s += `${t}/${n}` : s += `${t}`, s;
}, Na = (t, e, n, s) => {
  const { url: a, db: c } = X(re);
  return ht(n === void 0 ? sn(t, a, e) : n, () => c.getDoc(t, e), s);
}, ka = (t, e, n, s) => {
  const { db: a, url: c } = X(re), o = n === void 0 ? sn(t, c, e) : n;
  return I(() => {
    tn(o, () => a.getDoc(t, e));
  }, [o, t, e]);
}, zr = (t) => {
  var n, s;
  let e = "";
  if (t != null && t.fields && (e += "fields=" + JSON.stringify(t == null ? void 0 : t.fields) + "&"), t != null && t.filters && (e += "filters=" + JSON.stringify(t == null ? void 0 : t.filters) + "&"), t != null && t.orFilters && (e += "or_filters=" + JSON.stringify(t == null ? void 0 : t.orFilters) + "&"), t != null && t.limit_start && (e += "limit_start=" + JSON.stringify(t == null ? void 0 : t.limit_start) + "&"), t != null && t.limit && (e += "limit=" + JSON.stringify(t == null ? void 0 : t.limit) + "&"), t != null && t.groupBy && (e += "group_by=" + String(t.groupBy) + "&"), t != null && t.orderBy) {
    const a = `${String((n = t.orderBy) == null ? void 0 : n.field)} ${((s = t.orderBy) == null ? void 0 : s.order) ?? "asc"}`;
    e += "order_by=" + a + "&";
  }
  return t != null && t.asDict && (e += "as_dict=" + t.asDict), e;
}, Fa = (t, e, n, s) => {
  const { url: a, db: c } = X(re);
  return ht(n === void 0 ? `${sn(t, a)}?${zr(e)}` : n, () => c.getDocList(t, e), s);
}, Ba = (t, e, n) => {
  const { db: s, url: a } = X(re), c = n === void 0 ? `${sn(t, a)}?${zr(e)}` : n;
  return I(() => {
    tn(c, () => s.getDocList(t, e));
  }, [c, t, e]);
}, Pa = () => {
  const { db: t } = X(re), [e, n] = M(!1), [s, a] = M(null), [c, o] = M(!1), h = I(() => {
    n(!1), a(null), o(!1);
  }, []);
  return {
    createDoc: I(async (l, m) => (a(null), o(!1), n(!0), t.createDoc(l, m).then((b) => (n(!1), o(!0), b)).catch((b) => {
      throw n(!1), o(!1), a(b), b;
    })), []),
    loading: e,
    error: s,
    isCompleted: c,
    reset: h
  };
}, Ua = () => {
  const { db: t } = X(re), [e, n] = M(!1), [s, a] = M(null), [c, o] = M(!1), h = I(() => {
    n(!1), a(null), o(!1);
  }, []);
  return {
    updateDoc: I(async (l, m, b) => (a(null), o(!1), n(!0), t.updateDoc(l, m, b).then((E) => (n(!1), o(!0), E)).catch((E) => {
      throw n(!1), o(!1), a(E), E;
    })), []),
    loading: e,
    error: s,
    reset: h,
    isCompleted: c
  };
}, qa = () => {
  const { db: t } = X(re), [e, n] = M(!1), [s, a] = M(null), [c, o] = M(!1), h = I(() => {
    n(!1), a(null), o(!1);
  }, []);
  return {
    deleteDoc: I(async (l, m) => (a(null), o(!1), n(!0), t.deleteDoc(l, m).then((b) => (n(!1), o(!0), b)).catch((b) => {
      throw n(!1), o(!1), a(b), b;
    })), []),
    loading: e,
    error: s,
    reset: h,
    isCompleted: c
  };
};
function rn(t) {
  const e = [];
  for (let n in t)
    e.push(encodeURIComponent(n) + "=" + encodeURIComponent(t[n]));
  return e.join("&");
}
const Ia = (t, e, n = !1, s, a) => {
  const { url: c, db: o } = X(re);
  return ht(s === void 0 ? (() => {
    const l = rn({ doctype: t, filters: e ?? [], debug: n });
    return `${c}/api/method/frappe.client.get_count?${l}`;
  })() : s, () => o.getCount(t, e, n), a);
}, ja = (t, e, n = !1, s) => {
  const { db: a, url: c } = X(re), o = s === void 0 ? `${c}/api/method/frappe.client.get_count?${rn({ doctype: t, filters: e ?? [], debug: n })}` : s;
  return I(() => {
    tn(o, () => a.getCount(t, e, !1));
  }, [o, t, e]);
}, Ea = (t, e, n, s, a = "GET") => {
  const { call: c } = X(re), o = rn(e ?? {}), h = `${t}?${o}`;
  return {
    ...ht(n === void 0 ? h : n, a === "GET" ? () => c.get(t, e) : () => c.post(t, e), s)
  };
}, Ma = (t, e, n, s = "GET") => {
  const { call: a } = X(re), c = rn(e ?? {}), o = `${t}?${c}`;
  return I(() => {
    tn(n ?? o, s === "GET" ? () => a.get(t, e) : () => a.post(t, e));
  }, [o, t, e, n]);
}, Va = (t) => {
  const { call: e } = X(re), [n, s] = M(null), [a, c] = M(!1), [o, h] = M(null), [f, l] = M(!1), m = I(() => {
    s(null), c(!1), h(null), l(!1);
  }, []);
  return {
    call: I(async (E) => (h(null), l(!1), c(!0), s(null), e.post(t, E).then((y) => (s(y), c(!1), l(!0), y)).catch((y) => {
      throw c(!1), l(!1), h(y), y;
    })), []),
    result: n,
    loading: a,
    error: o,
    reset: m,
    isCompleted: f
  };
}, $a = (t) => {
  const { call: e } = X(re), [n, s] = M(null), [a, c] = M(!1), [o, h] = M(null), [f, l] = M(!1), m = I(() => {
    s(null), c(!1), h(null), l(!1);
  }, []);
  return {
    call: I(async (E) => (h(null), l(!1), c(!0), s(null), e.put(t, E).then((y) => (s(y), c(!1), l(!0), y)).catch((y) => {
      throw c(!1), l(!1), h(y), y;
    })), []),
    result: n,
    loading: a,
    error: o,
    reset: m,
    isCompleted: f
  };
}, Ha = (t) => {
  const { call: e } = X(re), [n, s] = M(null), [a, c] = M(!1), [o, h] = M(null), [f, l] = M(!1), m = I(() => {
    s(null), c(!1), h(null), l(!1);
  }, []);
  return {
    call: I(async (E) => (h(null), l(!1), c(!0), s(null), e.delete(t, E).then((y) => (s(y), c(!1), l(!0), y)).catch((y) => {
      throw c(!1), l(!1), h(y), y;
    })), []),
    result: n,
    loading: a,
    error: o,
    reset: m,
    isCompleted: f
  };
}, Wa = () => {
  const { file: t } = X(re), [e, n] = M(0), [s, a] = M(!1), [c, o] = M(null), [h, f] = M(!1), l = I(async (b, E, y) => (m(), a(!0), t.uploadFile(b, E, (v, R) => {
    R && n(Math.round(v / R * 100));
  }, y).then((v) => (f(!0), n(100), a(!1), v.data.message)).catch((v) => {
    throw console.error(v), o(v), a(!1), v;
  })), []), m = I(() => {
    n(0), a(!1), o(null), f(!1);
  }, []);
  return {
    upload: l,
    progress: e,
    loading: s,
    isCompleted: h,
    error: c,
    reset: m
  };
}, za = (t, e, n = [], s = 20, a = 250) => {
  const c = Sa(e, a);
  return Ea("frappe.desk.search.search_link", {
    doctype: t,
    page_length: s,
    txt: c,
    filters: JSON.stringify(n ?? [])
  });
}, Sa = (t, e) => {
  const [n, s] = M(t);
  return ft(() => {
    const a = setTimeout(() => {
      s(t);
    }, e);
    return () => {
      clearTimeout(a);
    };
  }, [t, e]), n;
}, Yn = (t, e) => {
  const { socket: n } = X(re);
  ft(() => {
    n === void 0 && console.warn("Socket is not enabled. Please enable socket in FrappeProvider.");
    let s = n == null ? void 0 : n.on(t, e);
    return () => {
      s == null || s.off(t);
    };
  }, [t, e]);
}, Ja = (t, e, n, s = !0) => {
  const { socket: a } = X(re), [c, o] = M([]);
  ft(() => (a === void 0 && console.warn("Socket is not enabled. Please enable socket in FrappeProvider."), a == null || a.emit("doc_subscribe", t, e), a == null || a.io.on("reconnect", () => {
    a == null || a.emit("doc_subscribe", t, e);
  }), s && (a == null || a.emit("doc_open", t, e)), () => {
    a == null || a.emit("doc_unsubscribe", t, e), s && (a == null || a.emit("doc_close", t, e));
  }), [t, e, s]), Yn("doc_update", n);
  const h = I(() => {
    a == null || a.emit("doc_open", t, e);
  }, [t, e]), f = I(() => {
    a == null || a.emit("doc_close", t, e);
  }, [t, e]), l = I((m) => {
    m.doctype === t && m.docname === e && o(m.users);
  }, [t, e]);
  return Yn("doc_viewers", l), {
    /** Array of user IDs of users currently viewing the document. This is updated when "doc_viewers" event is published */
    viewers: c,
    /** Emit doc_open event - this will explicitly send a doc_open event to the server. */
    emitDocOpen: h,
    /** Emit doc_close event - this will explicitly send a doc_close event to the server. */
    emitDocClose: f
  };
}, Ka = (t, e) => {
  const { socket: n } = X(re);
  ft(() => (n === void 0 && console.warn("Socket is not enabled. Please enable socket in FrappeProvider."), n == null || n.emit("doctype_subscribe", t), n == null || n.io.on("reconnect", () => {
    n == null || n.emit("doctype_subscribe", t);
  }), () => {
    n == null || n.emit("doctype_unsubscribe", t);
  }), [t]), Yn("list_update", e);
};
export {
  re as FrappeContext,
  La as FrappeProvider,
  zr as getDocListQueryString,
  sn as getRequestURL,
  tn as preload,
  Da as useFrappeAuth,
  Pa as useFrappeCreateDoc,
  Ha as useFrappeDeleteCall,
  qa as useFrappeDeleteDoc,
  Ka as useFrappeDocTypeEventListener,
  Ja as useFrappeDocumentEventListener,
  Yn as useFrappeEventListener,
  Wa as useFrappeFileUpload,
  Ea as useFrappeGetCall,
  Na as useFrappeGetDoc,
  Ia as useFrappeGetDocCount,
  Fa as useFrappeGetDocList,
  Va as useFrappePostCall,
  Ma as useFrappePrefetchCall,
  ka as useFrappePrefetchDoc,
  ja as useFrappePrefetchDocCount,
  Ba as useFrappePrefetchDocList,
  $a as useFrappePutCall,
  Ua as useFrappeUpdateDoc,
  ht as useSWR,
  yo as useSWRConfig,
  Ca as useSWRInfinite,
  za as useSearch
};
