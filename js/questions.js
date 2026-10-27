/* ============================================================
 * questions.js —— 口算题生成器
 * 5 档难度，答案为非负整数
 * ============================================================ */
var QGen = (function () {

  function ri(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // 只输出算式本体（如 "12 + 9"），等号与答案框由界面拼接
  function add(a, b) { return { text: a + " + " + b, ans: a + b }; }
  function sub(a, b) { return { text: a + " − " + b, ans: a - b }; }
  function mul(a, b) { return { text: a + " × " + b, ans: a * b }; }
  function div(a, b) { return { text: a + " ÷ " + b, ans: a / b }; }

  /* ---- 第 1 档：10 以内加减 ---- */
  function L1() {
    if (Math.random() < 0.55) {
      var a = ri(1, 8), b = ri(1, 10 - a);
      return add(a, b);
    }
    var a = ri(2, 10), b = ri(1, a);
    return sub(a, b);
  }

  /* ---- 第 2 档：20 以内进位加 / 退位减 ---- */
  function L2() {
    if (Math.random() < 0.5) {
      // 进位加法，结果不超过 20
      var a = ri(4, 14);
      var bMax = Math.min(9, 20 - a);
      if (bMax < 6) return L2();
      var b = ri(6, bMax);
      if (a + b > 20) return L2();
      if (a % 10 + b % 10 < 10) return L2();  // 保证个位进位
      return add(a, b);
    }
    var a = ri(11, 20), b = ri(2, 9);
    if (a - b > 9 || a % 10 >= b % 10) return L2();   // 保证退位且结果 <10
    return sub(a, b);
  }

  /* ---- 第 3 档：100 以内加减 + 表内乘除 ---- */
  function L3() {
    var t = ri(0, 3);
    if (t === 0) return add(ri(11, 49), ri(11, 49));
    if (t === 1) { var a = ri(30, 99), b = ri(11, a - 1); return sub(a, b); }
    if (t === 2) return mul(ri(2, 9), ri(2, 9));
    var b2 = ri(2, 9), q = ri(2, 9);
    return div(b2 * q, b2);
  }

  /* ---- 第 4 档：两位数×一位、混合两步、整除 ---- */
  function L4() {
    var t = ri(0, 3);
    if (t === 0) return mul(ri(11, 29), ri(2, 9));
    if (t === 1) {
      var b = ri(2, 9), q = ri(3, 19);
      if (b * q > 99) return L4();
      return div(b * q, b);
    }
    if (t === 2) {
      var a = ri(2, 9), b = ri(2, 9), c = ri(1, 40);
      return { text: a + " × " + b + " + " + c, ans: a * b + c };
    }
    var a2 = ri(2, 9), b2 = ri(2, 9), c2 = ri(1, a2 * b2 - 1);
    return { text: a2 + " × " + b2 + " − " + c2, ans: a2 * b2 - c2 };
  }

  /* ---- 第 5 档：100 以内混合四则（带括号） ---- */
  function L5() {
    var t = ri(0, 4);
    if (t === 0) {
      var b = ri(2, 8), c = ri(2, 8), a = ri(1, 9);
      while ((a + b) * c > 120) { b = ri(2, 8); c = ri(2, 8); a = ri(1, 9); }
      return { text: "(" + a + " + " + b + ") × " + c, ans: (a + b) * c };
    }
    if (t === 1) {
      var s = ri(2, 9), b2 = ri(2, 9);
      while (s * b2 <= 10) { s = ri(2, 9); b2 = ri(2, 9); }
      var a2 = s + ri(1, 30);
      return { text: a2 + " − " + s + " × " + b2, ans: a2 - s * b2 };
    }
    if (t === 2) {
      // 保证 (被减数 − 减数) 一定是除数的整数倍
      var p = ri(2, 9);
      var s2 = p * ri(3, 11);
      var j = p * ri(2, 9);
      var a3 = s2 + j;
      return { text: "(" + a3 + " − " + s2 + ") ÷ " + p, ans: j / p };
    }
    // 100 以内两位数加法
    var a5 = ri(21, 79), b5 = ri(11, 100 - a5);
    return add(a5, b5);
    var a4 = ri(20, 99), b4 = ri(11, a4 - 1), c4 = ri(1, 30);
    return { text: a4 + " − " + b4 + " + " + c4, ans: a4 - b4 + c4 };
  }

  var LEVELS = [
    { id: 0, name: "入门", desc: "10以内加减", gen: L1 },
    { id: 1, name: "基础", desc: "20以内进位/退位", gen: L2 },
    { id: 2, name: "提高", desc: "100以内 + 表内乘除", gen: L3 },
    { id: 3, name: "进阶", desc: "两位数乘法 / 混合", gen: L4 },
    { id: 4, name: "挑战", desc: "100以内四则混合", gen: L5 }
  ];

  var recent = [];
  function seen(t) {
    for (var i = 0; i < recent.length; i++) if (recent[i] === t) return true;
    return false;
  }

  /* 生成一道题（尽量避免近期重复） */
  function next(levelId) {
    var gen = LEVELS[levelId] ? LEVELS[levelId].gen : L2;
    var q = null;
    for (var i = 0; i < 20; i++) {
      q = gen();
      if (!q) continue;
      var ok = typeof q.ans === 'number' && isFinite(q.ans) &&
        q.ans >= 0 && q.ans <= 999 &&
        Math.floor(q.ans) === q.ans &&        // 必须是整数（除法不能除不尽）
        !seen(q.text);
      if (ok) break;
    }
    q.ans = Math.round(q.ans);
    recent.push(q.text);
    if (recent.length > 12) recent.shift();
    return q;
  }

  return { LEVELS: LEVELS, next: next };
})();
