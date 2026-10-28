/* ============================================================
 * questions.js —— 口算题生成器
 * 两档难度：基础 / 提高，答案一律为非负整数
 * ============================================================ */
var QGen = (function () {

  function ri(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // 只输出算式本体（如 "12 + 9"），等号与答案框由界面拼接
  function add(a, b) { return { text: a + " + " + b, ans: a + b }; }
  function sub(a, b) { return { text: a + " − " + b, ans: a - b }; }
  function mul(a, b) { return { text: a + " × " + b, ans: a * b }; }
  function div(a, b) { return { text: a + " ÷ " + b, ans: a / b }; }

  /* ============================================================
   * 基础：两位数加减（不进位 / 不退位）、两位数×一位数（不进位）、
   *       除数是一位数的简单除法（整除）
   * ============================================================ */

  /* 两位数 + 两位数，个位与十位都不进位 */
  function addNoCarry() {
    var A = ri(1, 8), C = ri(1, 9 - A);   // 十位
    var B = ri(0, 8), D = ri(0, 8 - B);   // 个位
    return add(A * 10 + B, C * 10 + D);
  }

  /* 两位数 − 两位数，个位与十位都不退位 */
  function subNoBorrow() {
    var A = ri(2, 9), C = ri(1, A);       // 十位（保证 A >= C）
    var B = ri(0, 9), D = ri(0, B);       // 个位（保证 B >= D）
    if (A === C && B === D) return subNoBorrow();   // 结果不能是 0
    return sub(A * 10 + B, C * 10 + D);
  }

  /* 两位数 × 一位数，每一位相乘都不进位 */
  function mulNoCarry() {
    var c = ri(2, 9);
    var m = Math.floor(9 / c);            // 每一位最大能取到几，保证 c×该位 ≤ 9
    var A = ri(1, m), B = ri(0, m);
    return mul(A * 10 + B, c);
  }

  /* 除数是一位数的简单除法（表内除法，整除） */
  function divEasy() {
    var c = ri(2, 9), q = ri(2, 9);
    return div(c * q, c);
  }

  function LB() {
    var t = ri(0, 3);
    if (t === 0) return addNoCarry();
    if (t === 1) return subNoBorrow();
    if (t === 2) return mulNoCarry();
    return divEasy();
  }

  /* ============================================================
   * 提高：两步混合 / 带括号 / 同级按顺序
   * ============================================================ */

  /* ---- 两步混合：先乘除后加减 ---- */
  function mix2Main(t) {
    if (t === 0) {                       // a ÷ b + c
      var b = ri(2, 9), q = ri(3, 12);
      while (b * q > 99) q = ri(3, 12);
      var c = ri(1, 30);
      return { text: (b * q) + " ÷ " + b + " + " + c, ans: q + c };
    }
    if (t === 1) {                       // a ÷ b − c（保证结果为正）
      var b2 = ri(2, 9), q2 = ri(4, 12);
      while (b2 * q2 > 99) q2 = ri(4, 12);
      var c2 = ri(1, q2 - 1);
      return { text: (b2 * q2) + " ÷ " + b2 + " − " + c2, ans: q2 - c2 };
    }
    if (t === 2) {                       // a × b + c
      var a3 = ri(2, 9), b3 = ri(2, 9), c3 = ri(1, 40);
      return { text: a3 + " × " + b3 + " + " + c3, ans: a3 * b3 + c3 };
    }
    if (t === 3) {                       // a × b − c（保证结果为正）
      var a4 = ri(2, 9), b4 = ri(2, 9), c4 = ri(1, a4 * b4 - 1);
      return { text: a4 + " × " + b4 + " − " + c4, ans: a4 * b4 - c4 };
    }
    if (t === 4) {                       // a + b × c
      var a5 = ri(5, 40), b5 = ri(2, 9), c5 = ri(2, 9);
      return { text: a5 + " + " + b5 + " × " + c5, ans: a5 + b5 * c5 };
    }
    /* a − b × c（保证结果为正） */
    var b6 = ri(2, 9), c6 = ri(2, 9), r = ri(1, 40);
    return { text: (b6 * c6 + r) + " − " + b6 + " × " + c6, ans: r };
  }

  /* ---- 带括号 ---- */
  function withParen() {
    var t = ri(0, 3);
    if (t === 0) {                       // (a + b) ÷ c
      var c = ri(2, 9), q = ri(3, 12), s;
      var g = 0;
      do { c = ri(2, 9); q = ri(3, 12); s = c * q; } while ((s < 20 || s > 99) && ++g < 200);
      if (s < 20 || s > 99) return mix2Main(0);
      var a = ri(10, s - 10), b = s - a;
      return { text: "(" + a + " + " + b + ") ÷ " + c, ans: q };
    }
    if (t === 1) {                       // (a − b) ÷ c
      var c2 = ri(2, 9), q2 = ri(3, 12), d;
      var g2 = 0;
      do { c2 = ri(2, 9); q2 = ri(3, 12); d = c2 * q2; } while ((d < 20 || d > 89) && ++g2 < 200);
      if (d < 20 || d > 89) return mix2Main(1);
      var b2 = ri(10, 99 - d), a2 = b2 + d;
      return { text: "(" + a2 + " − " + b2 + ") ÷ " + c2, ans: q2 };
    }
    if (t === 2) {                       // (a + b) × c
      var c3 = ri(2, 4), a3 = ri(10, 30), b3 = ri(10, 30);
      return { text: "(" + a3 + " + " + b3 + ") × " + c3, ans: (a3 + b3) * c3 };
    }
    /* (a − b) × c */
    var c4 = ri(2, 4), d4 = ri(3, 20), b4 = ri(10, 50), a4 = b4 + d4;
    return { text: "(" + a4 + " − " + b4 + ") × " + c4, ans: d4 * c4 };
  }

  /* ---- 同级运算，需按从左到右的顺序算 ---- */
  function sameLevel() {
    var t = ri(0, 2);
    if (t === 0) {                       // a − b + c
      var a = ri(30, 100), b = ri(11, a - 1), c = ri(11, 40);
      return { text: a + " − " + b + " + " + c, ans: a - b + c };
    }
    if (t === 1) {                       // a + b − c
      var a2 = ri(20, 80), b2 = ri(11, 60), c2 = ri(11, a2 + b2 - 1);
      return { text: a2 + " + " + b2 + " − " + c2, ans: a2 + b2 - c2 };
    }
    /* a ÷ b × c */
    var b3 = ri(2, 9), q3 = ri(2, 9), c3 = ri(2, 9);
    return { text: (b3 * q3) + " ÷ " + b3 + " × " + c3, ans: q3 * c3 };
  }

  function LH() {
    var t = ri(0, 2);
    if (t === 0) return mix2Main(ri(0, 5));
    if (t === 1) return withParen();
    return sameLevel();
  }

  var LEVELS = [
    { id: 0, name: "基础", desc: "不进位加减 · 表内乘除", gen: LB, energy: 0.5 },
    { id: 1, name: "提高", desc: "混合 · 括号 · 按顺序", gen: LH, energy: 1 }
  ];

  /* 该难度每答对一题进账几点魔力 */
  function energyPer(levelId) {
    var lv = LEVELS[levelId];
    return lv ? lv.energy : 1;
  }

  var recent = [];
  function seen(t) {
    for (var i = 0; i < recent.length; i++) if (recent[i] === t) return true;
    return false;
  }

  /* 生成一道题（尽量避免近期重复） */
  function next(levelId) {
    var gen = LEVELS[levelId] ? LEVELS[levelId].gen : LB;
    var q = null;
    for (var i = 0; i < 24; i++) {
      q = gen();
      if (!q) continue;
      var ok = typeof q.ans === 'number' && isFinite(q.ans) &&
        q.ans >= 0 && q.ans <= 999 &&
        Math.floor(q.ans) === q.ans &&        // 必须是整数（除法不能除不尽）
        !seen(q.text);
      if (ok) break;
    }
    if (!q) q = { text: "6 ÷ 2", ans: 3 };
    q.ans = Math.round(q.ans);
    recent.push(q.text);
    if (recent.length > 12) recent.shift();
    return q;
  }

  return { LEVELS: LEVELS, next: next, energyPer: energyPer };
})();
