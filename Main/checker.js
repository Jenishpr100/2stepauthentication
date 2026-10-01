// Tolerant math answer checker. Works in Node and in the browser.
// Parses both answers into functions of x and compares them numerically.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.checkAnswer = factory().check;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NAMES = ['sqrt', 'sin', 'cos', 'tan', 'ln', 'log', 'exp', 'pi', 'e', 'x'];
  const FUNCS = {
    sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    ln: Math.log, log: Math.log, exp: Math.exp
  };

  function normalize(s) {
    return String(s)
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/\*\*/g, '^')
      .replace(/[×·]/g, '*')
      .replace(/[−–]/g, '-')
      .replace(/\|/g, '')
      .replace(/√/g, 'sqrt')
      .replace(/π/g, 'pi')
      .replace(/^(dy\/dx|y|f\(x\)|f'\(x\))=/, '')
      .replace(/^c\+(.+)$/, '$1+c'); // allow "C + x^2"
  }

  function tokenize(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/[0-9.]/.test(c)) {
        const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
        if (!m) throw new Error('bad number');
        out.push({ n: parseFloat(m[0]) });
        i += m[0].length;
      } else if (/[a-z]/.test(c)) {
        const name = NAMES.find(n => s.startsWith(n, i));
        if (!name) throw new Error('bad name');
        out.push({ id: name });
        i += name.length;
      } else if ('+-*/^()'.includes(c)) {
        out.push({ op: c });
        i++;
      } else {
        throw new Error('bad char');
      }
    }
    return out;
  }

  function parse(src) {
    const t = tokenize(src);
    let p = 0;
    const isOp = o => t[p] && t[p].op === o;
    const startsPrimary = () => {
      const k = t[p];
      return k && (k.n !== undefined || k.id || k.op === '(');
    };

    function expr() {
      let l = term();
      while (isOp('+') || isOp('-')) {
        const o = t[p++].op, r = term(), a = l;
        l = o === '+' ? x => a(x) + r(x) : x => a(x) - r(x);
      }
      return l;
    }
    function term() {
      let l = unary();
      for (;;) {
        if (isOp('*') || isOp('/')) {
          const o = t[p++].op, r = unary(), a = l;
          l = o === '*' ? x => a(x) * r(x) : x => a(x) / r(x);
        } else if (startsPrimary()) {
          const r = power(), a = l; // implicit multiplication
          l = x => a(x) * r(x);
        } else return l;
      }
    }
    function unary() {
      if (isOp('-')) { p++; const a = unary(); return x => -a(x); }
      if (isOp('+')) { p++; return unary(); }
      return power();
    }
    function power() {
      const b = primary();
      if (isOp('^')) { p++; const e = unary(); return x => Math.pow(b(x), e(x)); }
      return b;
    }
    function primary() {
      const k = t[p++];
      if (!k) throw new Error('unexpected end');
      if (k.n !== undefined) return () => k.n;
      if (k.op === '(') {
        const e = expr();
        if (!isOp(')')) throw new Error('missing )');
        p++;
        return e;
      }
      if (k.id === 'x') return x => x;
      if (k.id === 'e') return () => Math.E;
      if (k.id === 'pi') return () => Math.PI;
      if (k.id) {
        const f = FUNCS[k.id];
        let arg;
        if (isOp('(')) arg = primary();
        else {
          const numFirst = t[p] && t[p].n !== undefined;
          arg = power();
          // "cos2x" -> cos(2x)
          while (numFirst && t[p] && (t[p].n !== undefined || t[p].id === 'x')) {
            const r = power(), a = arg;
            arg = x => a(x) * r(x);
          }
        }
        return x => f(arg(x));
      }
      throw new Error('unexpected token');
    }

    const f = expr();
    if (p < t.length) throw new Error('trailing input');
    return f;
  }

  function check(userAnswer, correct) {
    if (typeof userAnswer !== 'string' || !userAnswer.trim() || userAnswer.length > 200) return false;
    let nu = normalize(userAnswer), nc = normalize(correct);
    if (nu === nc) return true;
    // Indefinite integrals need + C; everything else must not have it.
    const needC = /\+c$/.test(nc);
    if (needC !== /\+c$/.test(nu)) return false;
    if (needC) { nu = nu.slice(0, -2); nc = nc.slice(0, -2); }
    let a, b;
    try { a = parse(nu); } catch (e) { return false; }
    try { b = parse(nc); } catch (e) { return false; }
    let compared = 0;
    for (const x of [0.5, 0.9, 1.4, 2.2, 3.1]) {
      const u = a(x), v = b(x);
      if (!isFinite(u) && !isFinite(v)) continue;
      if (!isFinite(u) || !isFinite(v)) return false;
      if (Math.abs(u - v) > 1e-6 * Math.max(1, Math.abs(u), Math.abs(v))) return false;
      compared++;
    }
    return compared > 0;
  }

  return { check };
});
