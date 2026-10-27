/* ============================================================
 * scene.js —— 上方动画区（Canvas）
 * 两套场景主题：
 *   tavern  中式酒楼 + 包子（街机三国志吃包子风格）
 *   forest  森林 + 苹果（熊大 / 熊二 / 光头强 / 蹦蹦）
 * 角色状态机：伸手拿食物 → 拿在手上等答题 → 张嘴咬两口 →
 * 咀嚼吞咽；答错摇头冒汗；吃完庆祝冒泡。
 * ============================================================ */

/* IE / 老 Trident 内核没有 canvas ellipse()：补一个等价实现 */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.ellipse) {
  CanvasRenderingContext2D.prototype.ellipse = function (x, y, rx, ry, rot, s, e, ccw) {
    this.save();
    this.translate(x, y);
    if (rot) this.rotate(rot);
    this.scale(rx / (ry || 1), 1);
    this.arc(0, 0, ry || 0, s, e, !!ccw);
    this.restore();
  };
}

var Scene = (function () {

  var W = 1920, H = 720;
  var ctx = null, T = 0;
  var TABLE_Y = 545;
  var chars = [];
  var particles = [], floats = [], confetti = [];
  var themeId = 'forest';

  /* ---------------- 三种玩法模式 ---------------- */
  var mode = 'eat';                 // eat（吃食物） | race（赛道竞速） | team（团队闯关）

  /* 赛道竞速：四条车道 */
  var race = { startX: 250, endX: 1690, lanes: [] };
  (function () { for (var li = 0; li < 4; li++) race.lanes.push({ groundY: 200 + li * 166 }); })();
  var RACE_K = 0.38;                // 赛道上角色的整体缩放

  /* 团队闯关：大魔王 */
  var team = {
    level: 1, hp: 1, info: '', boss: null,
    flash: 0, shake: 0, dying: -1, enter: 1, projs: []
  };
  var BOSSES = [
    { name: '算术大魔王', col: '#7a4bd9', dark: '#55309c', light: '#a985ec' },
    { name: '数字九头怪', col: '#2a9ad9', dark: '#1a6ba8', light: '#7ac6f0' },
    { name: '错题大怪兽', col: '#d94b3d', dark: '#a82f22', light: '#f28573' }
  ];
  function setBoss(lv) {
    team.boss = BOSSES[(lv - 1) % BOSSES.length];
    team.hp = 1; team.flash = 0; team.shake = 0;
    team.dying = -1; team.enter = 0; team.projs = [];
  }

  /* ---------------- 小工具 ---------------- */
  function lerp(a, b, u) { return a + (b - a) * u; }
  function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  function backOut(u) { var s = 1.7; var v = u - 1; return v * v * ((s + 1) * v + s) + 1; }
  function clamp01(u) { return u < 0 ? 0 : (u > 1 ? 1 : u); }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.closePath(); }

  /* ============================================================
   * 主题定义
   * ============================================================ */
  var THEMES = {

    tavern: {
      food: '包子',
      skins: [
        { kind: 'human', name: '红袍壮士', main: '#d94f3d', dark: '#a83226', light: '#f28573', accent: '#f7d84b', scale: 1 },
        { kind: 'human', name: '蓝袍壮士', main: '#3d7fd9', dark: '#2a5aa8', light: '#7aaee8', accent: '#f7d84b', scale: 1 },
        { kind: 'human', name: '绿袍壮士', main: '#3fa35a', dark: '#2a7a3e', light: '#7ccb90', accent: '#f7d84b', scale: 1 },
        { kind: 'human', name: '黄袍壮士', main: '#e0a020', dark: '#b07c10', light: '#f4c95d', accent: '#e05a3a', scale: 1 }
      ],
      drawBg: bgTavern, drawTable: tableTavern, drawTray: trayPlate, drawFood: drawBun
    },

    forest: {
      food: '苹果',
      skins: [
        { kind: 'bear', name: '熊大', main: '#8a4b2a', dark: '#6a3a20', light: '#a86542', accent: '#e8b23a', scale: 1.06, ear: 'big', imgSrc: 'images/xiongda.png', mrow: 0.27, mcx: 0.51, ms: 1.05, hcx: 0.69, hcy: 0.49 },
        { kind: 'bear', name: '熊二', main: '#c68a4c', dark: '#a06c33', light: '#ddaa72', accent: '#f2d06a', scale: 1.12, ear: 'small', imgSrc: 'images/xionger.png', mrow: 0.33, mcx: 0.51, ms: 1.0, hcx: 0.72, hcy: 0.49 },
        { kind: 'human', name: '光头强', main: '#e0a020', dark: '#a87510', light: '#f4c95d', accent: '#e8452a', scale: 0.98, hat: true, beard: true, imgSrc: 'images/guangtouqiang.png', mrow: 0.51, mcx: 0.55, ms: 0.85, hcx: 0.93, hcy: 0.70 },
        { kind: 'squirrel', name: '蹦蹦', main: '#e07b2a', dark: '#b35815', light: '#f2a55c', accent: '#fff0d0', scale: 1.12, imgSrc: 'images/bengbeng.png', mrow: 0.40, mcx: 0.43, ms: 0.75, hcx: 0.62, hcy: 0.56 }
      ],
      drawBg: bgForest, drawTable: tableForest, drawTray: traySlab, drawFood: drawApple
    }
  };

  function theme() { return THEMES[themeId] || THEMES.forest; }

  /* ============================================================
   * 背景一：中式酒楼
   * ============================================================ */
  function bgTavern(c) {
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#35190f'); g.addColorStop(0.55, '#5a2a16'); g.addColorStop(1, '#6e3a1c');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    c.fillStyle = '#7a2015'; c.fillRect(0, 96, W, 46);
    c.fillStyle = '#5d170e'; c.fillRect(0, 134, W, 12);
    c.fillStyle = 'rgba(255,220,150,.15)'; c.fillRect(0, 96, W, 6);

    var colXs = [120, 600, 1080, 1560];
    for (var i = 0; i < colXs.length; i++) {
      var x = colXs[i];
      var cg = c.createLinearGradient(x - 26, 0, x + 26, 0);
      cg.addColorStop(0, '#6e1d12'); cg.addColorStop(0.4, '#a03222'); cg.addColorStop(1, '#5d150c');
      c.fillStyle = cg; c.fillRect(x - 26, 142, 52, TABLE_Y - 142);
      c.fillStyle = '#8c281a'; c.fillRect(x - 34, 142, 68, 16);
    }

    var lx = [330, 810, 1290, 1770];
    for (var j = 0; j < lx.length; j++) drawLantern(c, lx[j], 30 + (j % 2) * 22, 1 + Math.sin(T * 1.1 + j) * 0.05);

    c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(0, TABLE_Y - 26, W, 26);
  }

  function drawLantern(c, x, y, sw) {
    c.save();
    c.translate(x, y); c.rotate(sw * 0.35);
    c.strokeStyle = '#5a3a1a'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(0, -40); c.lineTo(0, 0); c.stroke();
    var g = c.createRadialGradient(-8, 26, 4, 0, 30, 46);
    g.addColorStop(0, '#ff9a4a'); g.addColorStop(0.5, '#e8452a'); g.addColorStop(1, '#a81f12');
    c.fillStyle = g; c.beginPath(); c.ellipse(0, 32, 36, 32, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f0c060'; c.fillRect(-16, -2, 32, 9); c.fillRect(-13, 58, 26, 8);
    c.strokeStyle = 'rgba(120,20,10,.5)'; c.lineWidth = 2;
    for (var i = -2; i <= 2; i++) { c.beginPath(); c.ellipse(0, 32, Math.abs(i) * 9 + 4, 32, 0, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = '#e8b23a'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, 66); c.lineTo(0, 92); c.stroke();
    c.restore();
    var rg = c.createRadialGradient(x, y + 62, 10, x, y + 62, 110);
    rg.addColorStop(0, 'rgba(255,170,80,.22)'); rg.addColorStop(1, 'rgba(255,170,80,0)');
    c.fillStyle = rg; c.beginPath(); c.arc(x, y + 62, 110, 0, Math.PI * 2); c.fill();
  }

  function tableTavern(c) {
    var g = c.createLinearGradient(0, TABLE_Y, 0, H);
    g.addColorStop(0, '#e8c27c'); g.addColorStop(0.18, '#d9ae66'); g.addColorStop(1, '#b8874a');
    c.fillStyle = g; c.fillRect(0, TABLE_Y, W, H - TABLE_Y);
    c.fillStyle = '#8a5a2c'; c.fillRect(0, TABLE_Y, W, 14);
    c.fillStyle = 'rgba(255,240,200,.35)'; c.fillRect(0, TABLE_Y, W, 5);
    c.strokeStyle = 'rgba(140,90,40,.4)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, TABLE_Y + 40); c.lineTo(W, TABLE_Y + 40); c.stroke();
  }

  function trayPlate(c, cx, py) {
    c.fillStyle = '#fdfaf2';
    c.beginPath(); c.ellipse(cx, py, 112, 30, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#cbb896'; c.lineWidth = 3;
    c.beginPath(); c.ellipse(cx, py, 112, 30, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(cx, py, 84, 20, 0, 0, Math.PI * 2); c.stroke();
  }

  /* ============================================================
   * 背景二：森林
   * ============================================================ */
  function bgForest(c) {
    // 天空
    var sky = c.createLinearGradient(0, 0, 0, 470);
    sky.addColorStop(0, '#a9e0f2'); sky.addColorStop(0.55, '#d8f2e4'); sky.addColorStop(1, '#eaf7dd');
    c.fillStyle = sky; c.fillRect(0, 0, W, 480);

    // 阳光光柱
    c.save();
    c.globalAlpha = 0.16;
    c.fillStyle = '#fff6c8';
    c.beginPath();
    c.moveTo(1180, 0); c.lineTo(1420, 0); c.lineTo(980, 470); c.lineTo(760, 470);
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(320, 0); c.lineTo(430, 0); c.lineTo(300, 470); c.lineTo(180, 470);
    c.closePath(); c.fill();
    c.restore();

    // 远景林
    drawTreeRow(c, [90, 300, 520, 760, 1010, 1270, 1520, 1780], 470, '#8fc98a', 0.75);
    drawTreeRow(c, [180, 430, 690, 940, 1190, 1440, 1690, 1890], 430, '#74bd7a', 1);

    // 草地
    var gr = c.createLinearGradient(0, 430, 0, H);
    gr.addColorStop(0, '#8fd07a'); gr.addColorStop(0.5, '#6cc063'); gr.addColorStop(1, '#4fa44e');
    c.fillStyle = gr; c.fillRect(0, 430, W, H - 430);
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 2;
    for (var i = 0; i < 60; i++) {
      var gx = (i * 137) % W, gy = 442 + ((i * 53) % 58);
      c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + 4, gy - 10); c.stroke();
    }

    // 近景大树
    drawBigTree(c, 110, 520, 1.05);
    drawBigTree(c, 720, 512, 0.82);
    drawBigTree(c, 1330, 516, 0.92);
    drawBigTree(c, 1840, 508, 1.1);

    // 灌木 / 蘑菇
    for (var k = 0; k < 10; k++) {
      var bx = 60 + k * 205, by = 500 + (k % 3) * 14;
      c.fillStyle = k % 2 ? '#57b054' : '#46a047';
      c.beginPath(); c.ellipse(bx, by, 52, 26, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(bx + 34, by + 6, 38, 20, 0, 0, Math.PI * 2); c.fill();
    }
    drawMushroom(c, 340, 512, 1);
    drawMushroom(c, 1120, 516, 0.8);
    drawMushroom(c, 1620, 508, 1.1);

    // 飘落的叶子
    for (var n = 0; n < 14; n++) {
      var lx = (n * 233 + T * (18 + (n % 5) * 6)) % (W + 80) - 40;
      var ly = 60 + ((n * 97 + T * (26 + (n % 4) * 10)) % 360);
      c.save();
      c.translate(lx, ly); c.rotate(Math.sin(T * 2 + n) * 0.9);
      c.globalAlpha = 0.75;
      c.fillStyle = n % 3 === 0 ? '#e8b23a' : (n % 3 === 1 ? '#7ac14f' : '#e07b2a');
      c.beginPath(); c.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    c.globalAlpha = 1;

    c.fillStyle = 'rgba(0,60,20,.16)'; c.fillRect(0, TABLE_Y - 24, W, 24);
  }

  function drawTreeRow(c, xs, baseY, col, alpha) {
    c.save(); c.globalAlpha = alpha;
    for (var i = 0; i < xs.length; i++) {
      var x = xs[i], r = 60;
      c.fillStyle = '#6b4a2a';
      c.fillRect(x - 7, baseY - 60, 14, 70);
      c.fillStyle = col;
      c.beginPath(); c.arc(x, baseY - 70, r, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(x - r * 0.8, baseY - 48, r * 0.72, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(x + r * 0.8, baseY - 52, r * 0.7, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  function drawBigTree(c, x, baseY, sc) {
    c.save(); c.translate(x, baseY); c.scale(sc, sc);
    var sway = Math.sin(T * 0.8 + x) * 3;
    c.fillStyle = '#7a5230';
    c.beginPath();
    c.moveTo(-26, 40); c.quadraticCurveTo(-16, -80, -12 + sway, -200);
    c.lineTo(16 + sway, -200); c.quadraticCurveTo(18, -80, 26, 40);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(90,55,25,.5)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-8, 20); c.lineTo(-6, -170); c.stroke();
    c.beginPath(); c.moveTo(8, 0); c.lineTo(6, -140); c.stroke();
    c.fillStyle = '#3f8f3c';
    c.beginPath(); c.arc(sway, -230, 118, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(-88, -190, 80, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(88, -192, 84, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(sway, -300, 72, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,.13)';
    c.beginPath(); c.arc(-38 + sway, -282, 48, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function drawMushroom(c, x, y, s) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = '#f6ead2';
    rr(c, -8, -6, 16, 22, 6); c.fill();
    c.fillStyle = '#e04b3a';
    c.beginPath(); c.ellipse(0, -6, 24, 16, 0, Math.PI, Math.PI * 2); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.75)';
    circle(c, -9, -12, 4); c.fill();
    circle(c, 6, -15, 3.4); c.fill();
    c.restore();
  }

  function tableForest(c) {
    var g = c.createLinearGradient(0, TABLE_Y, 0, H);
    g.addColorStop(0, '#e0b26a'); g.addColorStop(0.16, '#c8934f'); g.addColorStop(1, '#9c6b3a');
    c.fillStyle = g; c.fillRect(0, TABLE_Y, W, H - TABLE_Y);
    c.fillStyle = '#7d5330'; c.fillRect(0, TABLE_Y, W, 12);
    c.fillStyle = 'rgba(255,235,190,.35)'; c.fillRect(0, TABLE_Y, W, 4);
    c.strokeStyle = 'rgba(110,70,30,.25)'; c.lineWidth = 3;
    for (var i = 0; i < 6; i++) {
      var yy = TABLE_Y + 26 + i * 30;
      c.beginPath();
      c.moveTo(0, yy);
      for (var x = 0; x <= W; x += 160) c.quadraticCurveTo(x + 40, yy + Math.sin(x * 0.01 + i) * 5, x + 80, yy);
      c.stroke();
    }
  }

  function traySlab(c, cx, py) {
    c.fillStyle = '#c08d55';
    c.beginPath(); c.ellipse(cx, py, 116, 32, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e0b87c';
    c.beginPath(); c.ellipse(cx, py - 4, 106, 27, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#a8763f'; c.lineWidth = 2.5;
    c.beginPath(); c.ellipse(cx, py - 4, 80, 20, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(cx, py - 4, 52, 13, 0, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#8c5f2e'; c.lineWidth = 3;
    c.beginPath(); c.ellipse(cx, py, 116, 32, 0, 0, Math.PI * 2); c.stroke();
  }

  /* ============================================================
   * 食物：包子 / 苹果
   * ============================================================ */
  function biteMask(c, x, y, r, bites) {
    if (!bites) return;
    var keep = bites === 1 ? 0.62 : 0.3;
    var edge = x - r + 2 * r * keep;
    c.beginPath();
    c.moveTo(x - r - 4, y - r - 4);
    c.lineTo(edge - 4, y - r - 4);
    var steps = 3, hgt = (2 * r + 8) / steps;
    for (var i = 0; i < steps; i++) {
      var y0 = y - r - 4 + hgt * i, y1 = y0 + hgt;
      c.quadraticCurveTo(edge - (i % 2 === 0 ? 16 : 6), y0 + hgt * 0.5, edge - (i % 2 === 0 ? 5 : 15), y1);
    }
    c.lineTo(x - r - 4, y + r + 4);
    c.closePath();
    c.clip();
  }

  function drawBun(c, x, y, r, bites) {
    c.save();
    biteMask(c, x, y, r, bites);
    var g = c.createRadialGradient(x - r * 0.3, y - r * 0.45, r * 0.1, x, y, r);
    g.addColorStop(0, '#fffdf6'); g.addColorStop(1, '#f0ddb8');
    c.fillStyle = g; circle(c, x, y, r); c.fill();
    c.strokeStyle = '#d9c298'; c.lineWidth = Math.max(1.5, r * 0.06); c.stroke();
    c.strokeStyle = '#ddc79c'; c.lineWidth = Math.max(1.2, r * 0.05); c.lineCap = 'round';
    for (var k = 0; k < 5; k++) {
      var a = -Math.PI * 0.92 + k * 0.42;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * r * 0.32, y + Math.sin(a) * r * 0.32);
      c.quadraticCurveTo(
        x + Math.cos(a - 0.14) * r * 0.62, y + Math.sin(a - 0.14) * r * 0.62,
        x + Math.cos(a - 0.05) * r * 0.9, y + Math.sin(a - 0.05) * r * 0.9
      );
      c.stroke();
    }
    c.fillStyle = 'rgba(210,180,130,.55)';
    c.beginPath(); c.ellipse(x, y + r * 0.82, r * 0.7, r * 0.22, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function drawApple(c, x, y, r, bites) {
    c.save();
    biteMask(c, x, y, r, bites);
    // 红色果体
    var g = c.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, '#f2543d'); g.addColorStop(0.75, '#d92f1c'); g.addColorStop(1, '#b32312');
    c.fillStyle = g; circle(c, x, y, r); c.fill();
    // 咬开后露出的白色果肉（贴着咬痕一侧）
    if (bites) {
      var keep = bites === 1 ? 0.62 : 0.3;
      var fw = r * (bites === 1 ? 0.34 : 0.6);
      c.fillStyle = '#fff7e2';
      c.beginPath();
      c.ellipse(x - r + 2 * r * keep, y, fw * 0.8, r * 0.92, 0, 0, Math.PI * 2);
      c.fill();
    }
    // 高光
    c.fillStyle = 'rgba(255,255,255,.5)';
    c.beginPath(); c.ellipse(x - r * 0.36, y - r * 0.32, r * 0.26, r * 0.14, -0.6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(120,20,8,.35)'; c.lineWidth = Math.max(1.5, r * 0.06);
    circle(c, x, y, r * 0.97); c.stroke();
    c.restore();
    // 果柄 + 叶
    c.strokeStyle = '#7a4a20'; c.lineWidth = Math.max(2, r * 0.11); c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y - r * 0.7);
    c.quadraticCurveTo(x + r * 0.08, y - r * 1.02, x + r * 0.16, y - r * 1.18);
    c.stroke();
    c.fillStyle = '#4aa03c';
    c.beginPath(); c.ellipse(x + r * 0.42, y - r * 1.1, r * 0.32, r * 0.15, -0.42, 0, Math.PI * 2); c.fill();
  }

  /* ============================================================
   * 角色
   * ============================================================ */
  var REST = { dx: 92, dy: 552 };
  var PLATE = { dx: 118, dy: 570 };
  var HOLD = { dx: 96, dy: 452 };
  var MOUTH = { dx: 26, dy: 330 };

  function Character(cfg) {
    this.idx = cfg.idx;
    this.cx = 240 + cfg.idx * 480;
    this.name = cfg.name;
    this.skin = cfg.skin;
    this.scale = (cfg.skin && cfg.skin.scale) || 1;
    this.total = cfg.buns || 10;
    this.plate = 0;
    this.onEatDone = cfg.onEatDone || null;
    this.onSwallow = cfg.onSwallow || null;

    this.phase = 'idle'; this.dur = 1; this.t = 0;
    this.holding = false; this.bites = 0; this.bunScale = 1;
    this.mouth = 0; this.headRot = 0; this.headY = 0;
    this.bodyDy = 0;
    this.armL = { x: -REST.dx, y: REST.dy };
    this.armR = { x: REST.dx, y: REST.dy };
    this.blinkT = 1 + Math.random() * 4; this.blink = 1;
    this.seed = Math.random() * 100;
    this.cheering = false; this.gulp = 0;
    this.exp = 'normal';
    this.bubble = null;

    /* 赛道竞速 */
    this.prog = 0; this.progFrom = 0; this.progTo = 0;
    this.wheelRot = 0; this.dustT = 0;
    this.noPlate = false;
  }

  Character.prototype.setPhase = function (p, d) { this.phase = p; this.dur = d; this.t = 0; };

  Character.prototype.giveBun = function (plateLeft) {
    this.plate = plateLeft;
    this.cheering = false; this.exp = 'normal';
    this.holding = false;
    this.setPhase('reach', 0.42);
  };

  Character.prototype.eat = function () {
    if (this.phase === 'reach') { this.holding = true; this.bites = 0; this.bunScale = 1; }
    // 贴图角色从桌沿把手送到嘴边，路程更长，时间放宽一点
    this.setPhase('raise', (this.skin.imgReady && this.skin.img) ? 0.45 : 0.32);
  };

  Character.prototype.wrong = function () {
    this.exp = 'pain';
    this.setPhase('wrong', 0.75);
    var me = this, n = 0;
    var iv = setInterval(function () {
      if (++n > 5 || me.phase !== 'wrong') { clearInterval(iv); return; }
      spawnSweat(me.cx + (Math.random() < 0.5 ? -55 : 55), 262);
    }, 120);
  };

  Character.prototype.cheer = function () {
    this.cheering = true; this.exp = 'happy'; this.phase = 'cheer'; this.holding = false;
    this.plate = 0;   // 全部吃完，托盘清空
    this.say('吃不下了～', 3.2);
  };

  Character.prototype.say = function (text, dur) {
    this.bubble = { text: text, t: 0, life: dur || 2.4, side: this.idx === 3 ? 'left' : 'right' };
  };

  /* ============================================================
   * 模式二：赛道竞速
   * ============================================================ */
  Character.prototype.rush = function (target) {
    this.progFrom = this.prog;
    this.progTo = target;
    this.exp = 'happy';
    this.setPhase('rush', 0.7);
    this.dustT = 0;
  };

  Character.prototype.stumble = function () {
    this.exp = 'pain';
    this.setPhase('stumble', 0.55);
  };

  /* 冲过终点线 */
  Character.prototype.finishRace = function () {
    this.progFrom = this.prog;
    this.progTo = 1.04;
    this.cheering = true;
    this.exp = 'happy';
    this.setPhase('rush', 0.5);
  };

  /* ============================================================
   * 模式三：团队闯关
   * ============================================================ */
  Character.prototype.teamReady = function () {
    this.cheering = false; this.exp = 'normal'; this.mouth = 0;
    this.holding = true; this.bites = 0; this.bunScale = 1;
    this.setPhase('hold', 1);
  };

  Character.prototype.teamScore = function (n) { this.plate = n; };

  /* 把手里的食物当“炮弹”扔向大魔王 */
  Character.prototype.throwFood = function () {
    var hp = this.holdPt();
    var sx = this.cx + hp.x * this.scale;
    var sy = TABLE_Y + (hp.y - TABLE_Y) * this.scale;
    team.projs.push({
      x0: sx, y0: sy - 14, tx: 960 + (Math.random() - 0.5) * 90, ty: 150,
      t: 0, dur: 0.52 + Math.random() * 0.06
    });
    this.mouth = 0.5;
    this.setPhase('throw', 0.5);
  };

  Character.prototype.update = function (dt) {
    this.t += dt;
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkT = 1.5 + Math.random() * 4; this.blink = 0; }
    if (this.blink < 1) this.blink = Math.min(1, this.blink + dt * 8);
    if (this.bubble) {
      this.bubble.t += dt;
      if (this.bubble.t >= this.bubble.life) this.bubble = null;
    }

    var u = this.dur > 0 ? clamp01(this.t / this.dur) : 1;

    switch (this.phase) {
      case 'reach': {
        var e = ease(u);
        this.armR.x = lerp(REST.dx, PLATE.dx, e);
        this.armR.y = lerp(REST.dy, PLATE.dy, e);
        this.armL.x = -REST.dx; this.armL.y = REST.dy;
        if (u >= 1) { this.holding = true; this.bites = 0; this.bunScale = 1; this.setPhase('hold', 1); }
        break;
      }
      case 'hold': {
        var hd = this.holdPt();
        this.armR.x = hd.x; this.armR.y = hd.y + Math.sin(T * 2.2 + this.seed) * 5;
        this.armL.x = -REST.dx; this.armL.y = REST.dy;
        break;
      }
      case 'raise': {
        var e2 = ease(u);
        var mp = this.mouthPt(), hp = this.holdPt();
        this.armR.x = lerp(hp.x, mp.x, e2);
        this.armR.y = lerp(hp.y, mp.y, e2);
        this.mouth = 0.15 + 0.5 * u;
        if (u >= 1) this.setPhase('bite1', 0.24);
        break;
      }
      case 'bite1': {
        var mb = this.mouthPt();
        this.mouth = 1;
        this.armR.x = mb.x - 6 * u; this.armR.y = mb.y + 6 * u;
        if (u >= 1) { this.bites = 1; var c1 = this.mouthAbs(); spawnCrumbs(c1.x + 14, c1.y + 8); this.setPhase('chew1', 0.38); }
        break;
      }
      case 'chew1': {
        var mc = this.mouthPt();
        this.mouth = 0.35 + Math.abs(Math.sin(u * Math.PI * 5)) * 0.35;
        this.headY = Math.sin(u * Math.PI * 5) * 5;
        this.armR.x = mc.x - 8; this.armR.y = mc.y + 10;
        if (u >= 1) { this.headY = 0; this.setPhase('bite2', 0.24); }
        break;
      }
      case 'bite2': {
        this.mouth = 1;
        if (u >= 1) { this.bites = 2; var c2 = this.mouthAbs(); spawnCrumbs(c2.x + 12, c2.y + 8); this.setPhase('chew2', 0.38); }
        break;
      }
      case 'chew2': {
        this.mouth = 0.35 + Math.abs(Math.sin(u * Math.PI * 5)) * 0.3;
        this.headY = Math.sin(u * Math.PI * 5) * 5;
        if (u >= 1) { this.headY = 0; this.setPhase('swallow', 0.38); }
        break;
      }
      case 'swallow': {
        var e3 = ease(u);
        var ms = this.mouthPt();
        this.bunScale = 1 - e3;
        this.mouth = Math.max(0, 0.3 - u * 0.3);
        this.headRot = -0.16 * Math.sin(u * Math.PI);
        this.gulp = u;
        this.armR.x = lerp(ms.x, REST.dx, e3);
        this.armR.y = lerp(ms.y, REST.dy, e3);
        if (u >= 1) {
          this.holding = false; this.headRot = 0; this.gulp = 0; this.exp = 'happy';
          if (this.onSwallow) this.onSwallow(this.idx);
          var sp = this.mouthAbs();
          spawnSparkle(sp.x + 16, sp.y - 20);
          this.setPhase('happy', 0.45);
        }
        break;
      }
      case 'happy': {
        this.armR.x = REST.dx; this.armR.y = REST.dy;
        this.armL.x = -REST.dx; this.armL.y = REST.dy;
        if (u >= 1) { this.exp = 'normal'; if (this.onEatDone) this.onEatDone(this.idx); }
        break;
      }
      case 'wrong': {
        var hw = this.holdPt();
        this.headRot = Math.sin(u * Math.PI * 6) * 0.16;
        this.mouth = 0.55;
        this.armR.x = hw.x; this.armR.y = hw.y;
        this.armL.x = -REST.dx; this.armL.y = REST.dy;
        if (u >= 1) { this.headRot = 0; this.mouth = 0; this.exp = 'normal'; this.setPhase('hold', 1); }
        break;
      }
      /* ---------- 赛道竞速 ---------- */
      case 'ride': {
        this.armR.x = 76; this.armR.y = 464;   // 双手握住方向盘
        this.armL.x = -46; this.armL.y = 470;
        this.bodyDy = Math.sin(T * 2.2 + this.seed) * 2;
        this.mouth = this.exp === 'happy' ? 0.4 : 0;
        break;
      }
      case 'rush': {
        var er = ease(u);
        this.prog = lerp(this.progFrom, this.progTo, er);
        this.bodyDy = Math.sin(T * 30) * 3;
        this.wheelRot += dt * 22;
        this.dustT -= dt;
        if (this.dustT <= 0) {
          this.dustT = 0.045;
          spawnDust(race.startX + this.prog * (race.endX - race.startX) - 68,
            race.lanes[this.idx].groundY - 6);
        }
        if (u >= 1) {
          this.bodyDy = 0;
          if (this.cheering) this.setPhase('finish', 99);
          else { this.exp = 'normal'; this.setPhase('ride', 1); }
        }
        break;
      }
      case 'stumble': {
        this.headRot = Math.sin(u * Math.PI * 5) * 0.2;
        this.mouth = 0.45;
        // 原地打滑：进度小幅回退一点点，惩罚很轻
        if (u < 0.5) this.prog = Math.max(0, this.prog - dt * 0.02);
        if (u >= 1) { this.headRot = 0; this.mouth = 0; this.exp = 'normal'; this.setPhase('ride', 1); }
        break;
      }
      case 'finish': {
        this.bodyDy = Math.abs(Math.sin(T * 7)) * -16;
        this.armR.x = 112; this.armR.y = 384 + Math.sin(T * 7) * 14;
        this.armL.x = -112; this.armL.y = 384 + Math.cos(T * 7) * 14;
        this.mouth = 0.8; this.exp = 'happy';
        break;
      }

      /* ---------- 团队闯关 ---------- */
      case 'throw': {
        var ht = this.holdPt();
        var et = ease(u);
        this.armR.x = lerp(ht.x, ht.x + 74, et);
        this.armR.y = lerp(ht.y, ht.y - 118, et);
        this.armL.x = -REST.dx; this.armL.y = REST.dy;
        this.mouth = 0.5 * (1 - u);
        if (u >= 1) { this.mouth = 0; this.setPhase('hold', 1); }
        break;
      }

      case 'cheer': {
        this.bodyDy = Math.abs(Math.sin(T * 6)) * -26;
        this.armR.x = 120; this.armR.y = 350 + Math.sin(T * 6) * 14;
        this.armL.x = -120; this.armL.y = 350 + Math.cos(T * 6) * 14;
        this.mouth = 0.8;
        if (!this.bubble) this.say('吃不下了～', 3.2);
        break;
      }
      default: {
        this.bodyDy = Math.sin(T * 1.6 + this.seed) * 3;
        this.armR.x = REST.dx; this.armR.y = REST.dy;
        this.armL.x = -REST.dx; this.armL.y = REST.dy;
        this.mouth = 0;
      }
    }
  };

  /* ---------- 贴图：图片摆放到桌面上的位置 ---------- */
  Character.prototype.imgBox = function () {
    var sk = this.skin;
    if (!sk.imgReady || !sk.img) return null;
    var maxH = 330 * this.scale, maxW = 430 * this.scale;
    var h = maxH, w = h * (sk.imgW / sk.imgH);
    if (w > maxW) { w = maxW; h = w * (sk.imgH / sk.imgW); }
    // 贴图角色只让桌沿压住一点点，双手正好搭在桌面上
    var bottom = TABLE_Y + 8 + this.bodyDy + this.headY * 0.4;
    return { x: this.cx - w / 2, y: bottom - h, w: w, h: h };
  };

  /* 贴图模式下嘴巴的高度：返回「手臂坐标系」里的目标 y */
  Character.prototype.mouthTargetY = function () {
    return this.mouthPt().y;
  };

  /* 拿在手里的位置：贴图角色放到抬起的左手上（按图片比例 hcx/hcy），程序角色用原固定点 */
  Character.prototype.holdPt = function () {
    var sk = this.skin;
    if (sk.imgReady && sk.img && sk.hcx != null) {
      var b = this.imgBox();
      var ax = b.x + b.w * sk.hcx;
      var ay = b.y + b.h * sk.hcy;
      return { x: (ax - this.cx) / this.scale, y: TABLE_Y + (ay - TABLE_Y) / this.scale };
    }
    // 注意：HOLD 是 {dx,dy} 形式，这里必须转成 {x,y}
    // （否则调用方读到 undefined → 坐标变 NaN → canvas 报错，整屏冻结）
    return { x: HOLD.dx, y: HOLD.dy };
  };

  /* 嘴巴在「手臂坐标系」里的位置（手臂/食物都以它为目标） */
  Character.prototype.mouthPt = function () {
    var sk = this.skin;
    if (sk.imgReady && sk.img) {
      var b = this.imgBox();
      var ax = b.x + b.w * (sk.mcx != null ? sk.mcx : 0.5);
      var ay = b.y + b.h * (sk.mrow || 0.3);
      return { x: (ax - this.cx) / this.scale, y: TABLE_Y + (ay - TABLE_Y) / this.scale };
    }
    return { x: MOUTH.dx, y: MOUTH.dy };
  };

  /* 嘴巴的屏幕绝对坐标（用于碎屑/星星特效定位） */
  Character.prototype.mouthAbs = function () {
    var p = this.mouthPt();
    return { x: this.cx + p.x * this.scale, y: TABLE_Y + (p.y - TABLE_Y) * this.scale };
  };

  /* 抓 ∗ 贴图角色：图片 + 张嘴覆盖 */
  Character.prototype.drawSprite = function (c) {
    var b = this.imgBox(), sk = this.skin;
    var pivotY = b.y + b.h * 0.45;          // 摇头支点（脖子处）
    c.save();
    c.translate(this.cx, pivotY);
    c.rotate(this.headRot);
    c.translate(-this.cx, -pivotY);
    c.drawImage(sk.img, b.x, b.y, b.w, b.h);
    // 庆祝时不再叠加张嘴遮罩（贴图里本来就是笑脸）
    if (this.mouth > 0.05 && !this.cheering) {
      var mx = b.x + b.w * (sk.mcx != null ? sk.mcx : 0.5);
      var my = b.y + b.h * (sk.mrow || 0.3), m = this.mouth;
      var f = (sk.ms || 1) * Math.max(0.6, Math.min(1.4, b.h / 320));
      c.fillStyle = '#7a2418';
      c.beginPath(); c.ellipse(mx + 2, my, (10 + m * 10) * f, (3 + m * 16) * f, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e07a5a';
      c.beginPath(); c.ellipse(mx + 2, my + (3 + m * 16) * f * 0.35, (6 + m * 6) * f, (3 + m * 16) * f * 0.5, 0, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  };

  /* ---------- 身体（桌子之前绘制） ---------- */
  Character.prototype.drawBody = function (c) {
    var sk = this.skin, s = this.scale;

    // 有贴图：直接画图片
    if (sk.imgReady && sk.img) {
      this.drawSprite(c);
      if (!this.noPlate) drawNamePlate(c, this.cx, this.name, sk.main, 138 + this.bodyDy);
      return;
    }

    c.save();
    c.translate(this.cx, this.bodyDy);
    if (s !== 1) { c.translate(0, TABLE_Y); c.scale(s, s); c.translate(0, -TABLE_Y); }

    // 松鼠的大尾巴（身后）
    if (sk.kind === 'squirrel') {
      c.fillStyle = sk.light;
      c.beginPath();
      c.moveTo(66, 470);
      c.quadraticCurveTo(130, 452, 120, 340);
      c.quadraticCurveTo(114, 268, 72, 256);
      c.quadraticCurveTo(102, 316, 82, 356);
      c.quadraticCurveTo(66, 398, 52, 470);
      c.closePath(); c.fill();
      c.strokeStyle = sk.dark; c.lineWidth = 3; c.stroke();
    }

    // 身体
    c.fillStyle = sk.main;
    c.beginPath();
    c.moveTo(-96, TABLE_Y + 30);
    c.quadraticCurveTo(-88, 392, -62, 372);
    c.lineTo(62, 372);
    c.quadraticCurveTo(88, 392, 96, TABLE_Y + 30);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(0,0,0,.12)';
    c.beginPath();
    c.moveTo(30, 372); c.lineTo(62, 372);
    c.quadraticCurveTo(88, 392, 96, TABLE_Y + 30);
    c.lineTo(40, TABLE_Y + 30);
    c.closePath(); c.fill();

    if (sk.kind === 'human') {
      c.fillStyle = '#f5ead2';
      c.beginPath(); c.moveTo(-34, 380); c.lineTo(0, 428); c.lineTo(34, 380); c.closePath(); c.fill();
      c.strokeStyle = sk.dark; c.lineWidth = 5; c.stroke();
    } else {
      c.fillStyle = sk.light;
      c.beginPath(); c.ellipse(0, 468, 46, 58, 0, 0, Math.PI * 2); c.fill();
    }

    // 腰带
    c.fillStyle = sk.accent; c.fillRect(-88, 470, 176, 26);
    c.fillStyle = sk.dark; rr(c, -14, 466, 28, 34, 6); c.fill();

    this.drawHead(c);
    c.restore();

    if (!this.noPlate) drawNamePlate(c, this.cx, this.name, sk.main, 138 + this.bodyDy);
  };

  function drawNamePlate(c, cx, name, mainCol, top) {
    c.save();
    c.font = 'bold 30px "Microsoft YaHei", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    var nw = Math.max(150, c.measureText(name).width + 56);
    c.fillStyle = mainCol;
    rr(c, cx - nw / 2, top, nw, 48, 24); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 3; c.stroke();
    c.fillStyle = '#fff8e0';
    c.fillText(name, cx, top + 25);
    c.restore();
  }

  /* ---------- 头部 ---------- */
  Character.prototype.drawHead = function (c) {
    var sk = this.skin;
    c.save();
    c.translate(0, 300 + this.headY);
    c.rotate(this.headRot);

    if (sk.kind !== 'squirrel') {
      c.fillStyle = '#f0c290';
      c.fillRect(-16, 36, 32, 30);
    }

    var faceCol = sk.kind === 'squirrel' ? '#f7bd76' : (sk.kind === 'bear' ? sk.light : '#ffd9a8');
    c.fillStyle = faceCol;
    c.beginPath(); c.ellipse(0, 0, 56, 60, 0, 0, Math.PI * 2); c.fill();
    // 耳朵
    if (sk.kind !== 'bear') {
      c.fillStyle = faceCol;
      c.beginPath(); c.ellipse(-56, 6, 10, 14, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(56, 6, 10, 14, 0, 0, Math.PI * 2); c.fill();
    }

    if (sk.kind === 'bear') this.headBear(c, sk);
    else if (sk.kind === 'squirrel') this.headSquirrel(c, sk);
    else this.headHuman(c, sk);

    c.restore();
  };

  Character.prototype.headBear = function (c, sk) {
    var er = sk.ear === 'big' ? 22 : 17;
    c.fillStyle = sk.dark;
    circle(c, -44, -44, er); c.fill();
    circle(c, 44, -44, er); c.fill();
    c.fillStyle = sk.main;
    circle(c, -44, -44, er * 0.55); c.fill();
    circle(c, 44, -44, er * 0.55); c.fill();

    this.drawEyes(c, -26, 4, 26, 4);
    // 口鼻
    c.fillStyle = '#f6dcae';
    c.beginPath(); c.ellipse(0, 28, 27, 21, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3a2410';
    c.beginPath(); c.ellipse(0, 15, 11, 8, 0, 0, Math.PI * 2); c.fill();
    this.drawMouth(c, 30);
  };

  Character.prototype.headSquirrel = function (c, sk) {
    c.fillStyle = sk.dark;
    c.beginPath(); c.moveTo(-46, -34); c.lineTo(-58, -78); c.lineTo(-20, -52); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(46, -34); c.lineTo(58, -78); c.lineTo(20, -52); c.closePath(); c.fill();

    this.drawEyes(c, -25, 6, 25, 6);
    c.fillStyle = 'rgba(255,240,210,.65)';
    c.beginPath(); c.ellipse(0, 22, 26, 17, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3a2410';
    c.beginPath(); c.ellipse(0, 10, 8, 6, 0, 0, Math.PI * 2); c.fill();
    this.drawMouth(c, 26);
    // 大门牙
    if (this.mouth > 0.12) {
      c.fillStyle = '#fffdf4';
      c.fillRect(-11, 38, 9, 16);
      c.fillRect(2, 38, 9, 16);
      c.strokeStyle = '#d8c7a0'; c.lineWidth = 2;
      c.strokeRect(-11, 38, 9, 16); c.strokeRect(2, 38, 9, 16);
    }
  };

  Character.prototype.headHuman = function (c, sk) {
    if (sk.hat) {
      // 光头强的安全帽
      c.fillStyle = '#f0c040';
      c.beginPath(); c.arc(0, -12, 56, Math.PI, Math.PI * 2); c.closePath(); c.fill();
      rr(c, -66, -16, 132, 12, 6); c.fill();
      c.strokeStyle = '#b8801a'; c.lineWidth = 3;
      c.beginPath(); c.arc(0, -12, 56, Math.PI, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(0, -68); c.lineTo(0, -12); c.stroke();
      c.fillStyle = '#4a2c11';
      c.beginPath(); c.ellipse(-50, 6, 10, 18, 0.2, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(50, 6, 10, 18, -0.2, 0, Math.PI * 2); c.fill();
    } else {
      // 古代武士束发
      c.fillStyle = sk.dark;
      c.beginPath(); c.ellipse(0, -18, 57, 48, 0, Math.PI, Math.PI * 2); c.closePath(); c.fill();
      c.beginPath(); c.arc(0, -62, 15, 0, Math.PI * 2); c.fill();
      c.fillStyle = sk.accent;
      rr(c, -57, -26, 114, 13, 6); c.fill();
      c.strokeStyle = sk.accent; c.lineWidth = 7; c.lineCap = 'round';
      c.beginPath(); c.moveTo(48, -20);
      c.quadraticCurveTo(76, -34 + Math.sin(T * 3 + this.seed) * 5, 88, -16);
      c.stroke();
    }

    this.drawEyes(c, -27, 3, 27, 3);
    this.drawMouth(c, 34);

    if (sk.beard) {
      c.strokeStyle = '#4a2c11'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-16, 46); c.quadraticCurveTo(-30, 52, -36, 62); c.stroke();
      c.beginPath(); c.moveTo(16, 46); c.quadraticCurveTo(30, 52, 36, 62); c.stroke();
    }
  };

  Character.prototype.drawEyes = function (c, lx, ly, rx, ry) {
    c.strokeStyle = '#3a2410'; c.lineWidth = 5; c.lineCap = 'round';
    if (this.exp === 'pain') {
      c.beginPath();
      c.moveTo(lx - 7, ly - 5); c.lineTo(lx + 7, ly + 5);
      c.moveTo(lx - 7, ly + 5); c.lineTo(lx + 7, ly - 5);
      c.moveTo(rx - 7, ry - 5); c.lineTo(rx + 7, ry + 5);
      c.moveTo(rx - 7, ry + 5); c.lineTo(rx + 7, ry - 5);
      c.stroke();
      return;
    }
    if (this.exp === 'happy') {
      c.beginPath(); c.arc(lx, ly + 2, 11, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
      c.beginPath(); c.arc(rx, ry + 2, 11, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
      return;
    }
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(lx, ly, 13, 15 * this.blink + 0.5, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(rx, ry, 13, 15 * this.blink + 0.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3a2410';
    c.beginPath(); c.ellipse(lx + 2, ly + 2, 6.5, 8.5 * this.blink + 0.3, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(rx + 2, ry + 2, 6.5, 8.5 * this.blink + 0.3, 0, 0, Math.PI * 2); c.fill();
  };

  Character.prototype.drawMouth = function (c, my) {
    var m = this.mouth;
    if (m > 0.04) {
      c.fillStyle = '#8a2f1c';
      c.beginPath(); c.ellipse(2, my, 13 + m * 10, 4 + m * 20, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e0705a';
      c.beginPath(); c.ellipse(2, my + (4 + m * 20) * 0.35, 8 + m * 6, (4 + m * 20) * 0.5, 0, 0, Math.PI * 2); c.fill();
    } else {
      c.strokeStyle = '#8a4a2a'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.arc(2, my - 6, 12, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
    }
    if (this.gulp > 0 && this.gulp < 1) {
      c.fillStyle = 'rgba(240,180,120,.9)';
      c.beginPath(); c.ellipse(6, 44 + this.gulp * 66, 11, 9, 0, 0, Math.PI * 2); c.fill();
    }
  };

  /* ---------- 手臂 + 手上的食物（桌子之后绘制） ---------- */
  Character.prototype.drawFront = function (c) {
    var s = this.scale, sk = this.skin;
    c.save();
    c.translate(this.cx, 0);
    if (s !== 1) { c.translate(0, TABLE_Y); c.scale(s, s); c.translate(0, -TABLE_Y); }

    var flying = (this.phase === 'throw');   // 扔出去之后手里就没有食物了

    if (sk.imgReady && sk.img) {
      // 贴图模式：图片自带手臂，食物直接放在抬起的左手上
      if (this.holding && this.bunScale > 0.02 && !flying) {
        theme().drawFood(c, this.armR.x + 4, this.armR.y - 14, 30 * this.bunScale, this.bites);
      }
      c.restore();
      return;
    }

    drawArm(c, -58, 396, this.armL.x, this.armL.y, 26, sk);
    drawArm(c, 58, 396, this.armR.x, this.armR.y, -30, sk);

    if (this.holding && this.bunScale > 0.02 && !flying) {
      theme().drawFood(c, this.armR.x + 4, this.armR.y - 14, 30 * this.bunScale, this.bites);
    }
    c.restore();
  };

  /* 贴图角色的手臂画得细一些、贴近角色主色，减少“多出来的手”的突兀感 */
  function drawArm(c, sx, sy, hx, hy, bend, sk, slim) {
    var mx = (sx + hx) / 2, my = (sy + hy) / 2;
    var dx = hx - sx, dy = hy - sy, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var ex = mx + nx * bend, ey = my + ny * bend;
    if (slim) {
      c.strokeStyle = sk.main; c.lineWidth = 26; c.lineCap = 'round';
      c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(ex, ey, hx, hy); c.stroke();
      c.fillStyle = sk.light || '#ffd9a8';
      circle(c, hx, hy, 15); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.15)'; c.lineWidth = 2.5; c.stroke();
      return;
    }
    c.strokeStyle = sk.main; c.lineWidth = 34; c.lineCap = 'round';
    c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(ex, ey, hx, hy); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 10;
    c.beginPath(); c.moveTo(sx + 8, sy + 4); c.quadraticCurveTo(ex + 6, ey + 6, hx + 4, hy + 4); c.stroke();
    c.fillStyle = sk.kind === 'squirrel' ? sk.light : '#ffd9a8';
    circle(c, hx, hy, 17); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.15)'; c.lineWidth = 2.5; c.stroke();
  }

  /* ============================================================
   * 托盘上的食物堆
   * ============================================================ */
  function drawTrayAndStack(c, ch) {
    var cx = ch.cx, py = 606, th = theme();
    th.drawTray(c, cx, py);

    var n = Math.min(ch.plate, 20);
    var fr = 18, row = 0, placed = 0, k = 0;
    while (placed < n && row < 6) {
      var cnt = Math.min(row % 2 === 0 ? 5 : 4, n - placed);
      for (var i = 0; i < cnt; i++) {
        var wob = ((k * 41) % 9) - 4;
        var x = cx + (i - (cnt - 1) / 2) * (fr * 2 + 3) + wob * 0.35;
        var y = py - 14 - row * (fr * 1.66) - Math.abs(wob) * 0.4;
        th.drawFood(c, x, y, fr, 0);
        placed++; k++;
      }
      row++;
    }
  }

  /* ============================================================
   * 模式二：赛道竞速 —— 路面 / 卡丁车 / 尘土
   * ============================================================ */
  function spawnDust(x, y) {
    particles.push({
      x: x, y: y,
      vx: -110 - Math.random() * 90, vy: -20 - Math.random() * 60,
      g: 150, life: 0.55, t: 0,
      r: 5 + Math.random() * 9, col: 'rgba(216,188,146,0.9)', type: 'dot'
    });
  }

  function checkers(c, x, y, w, h, cols) {
    var rows = 20, ch = h / rows, cw = w / cols;
    for (var r = 0; r < rows; r++) {
      for (var k = 0; k < cols; k++) {
        c.fillStyle = (r + k) % 2 ? '#3c3c3c' : '#f6f2e8';
        c.fillRect(x + k * cw, y + r * ch, cw + 1, ch + 1);
      }
    }
  }

  function drawFlag(c, x, y) {
    c.save();
    c.strokeStyle = '#6b4a2a'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(x, y + 48); c.lineTo(x, y - 6); c.stroke();
    var r, k;
    for (r = 0; r < 3; r++) {
      for (k = 0; k < 4; k++) {
        c.fillStyle = (r + k) % 2 ? '#3c3c3c' : '#f6f2e8';
        c.fillRect(x + k * 12, y - 6 + r * 12, 12, 12);
      }
    }
    c.strokeStyle = 'rgba(60,40,15,.35)'; c.lineWidth = 2;
    c.strokeRect(x, y - 6, 48, 36);
    c.restore();
  }

  function wheel(c, x, y, r, rot) {
    c.save();
    c.translate(x, y); c.rotate(rot || 0);
    c.fillStyle = '#33261a'; circle(c, 0, 0, r); c.fill();
    c.fillStyle = '#7a5a38'; circle(c, 0, 0, r * 0.52); c.fill();
    c.strokeStyle = '#211710'; c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(-r * 0.45, 0); c.lineTo(r * 0.45, 0);
    c.moveTo(0, -r * 0.45); c.lineTo(0, r * 0.45);
    c.stroke();
    c.restore();
  }

  function drawKart(c, ch, x, gy, rot, tilt) {
    var sk = ch.skin;
    c.save();
    c.translate(x, gy);
    c.rotate(tilt || 0);
    wheel(c, -46, -16, 16, rot);
    wheel(c, 46, -16, 16, rot);
    c.fillStyle = sk.main;
    rr(c, -74, -56, 148, 42, 14); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 3.5; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.22)';
    rr(c, -74, -56, 148, 12, 6); c.fill();
    c.fillStyle = sk.light; circle(c, 62, -35, 7); c.fill();

    // 车身上写名字
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 24px "Microsoft YaHei", sans-serif';
    var tw = c.measureText(ch.name).width;
    var fs = tw > 118 ? Math.max(14, 24 * 118 / tw) : 24;
    c.font = 'bold ' + fs + 'px "Microsoft YaHei", sans-serif';
    c.lineWidth = 4; c.strokeStyle = 'rgba(60,30,5,.55)';
    c.strokeText(ch.name, 0, -33);
    c.fillStyle = '#fff8e0';
    c.fillText(ch.name, 0, -33);
    c.restore();
  }

  /* 卡丁车里的角色（贴图直接缩放；程序角色套用原绘制流程） */
  function drawRider(c, ch, x, seatY) {
    var sk = ch.skin;
    var bounce = ch.phase === 'rush' ? Math.sin(T * 28 + ch.seed) * 3.5 : Math.sin(T * 2.2 + ch.seed) * 2;
    var sy = seatY + bounce;

    if (sk.imgReady && sk.img) {
      var h = 300 * ch.scale * RACE_K, w = h * (sk.imgW / sk.imgH);
      var maxW = 430 * ch.scale * RACE_K;
      if (w > maxW) { w = maxW; h = w * (sk.imgH / sk.imgW); }
      c.save();
      c.translate(x, sy);
      if (ch.headRot) { c.translate(0, -h * 0.45); c.rotate(ch.headRot); c.translate(0, h * 0.45); }
      c.drawImage(sk.img, -w / 2, -h, w, h);
      c.restore();
    } else {
      var k2 = RACE_K * ch.scale;
      c.save();
      c.translate(x - ch.cx * k2, sy - 575 * k2);
      c.scale(k2, k2);
      ch.noPlate = true;
      ch.drawBody(c);
      ch.drawFront(c);
      ch.noPlate = false;
      c.restore();
    }
  }

  function drawRaceRoad(c) {
    var top = 26, bot = 706;
    var isF = (themeId === 'forest');
    c.fillStyle = isF ? '#d8b078' : '#cdb99c';
    rr(c, 56, top, W - 112, bot - top, 34); c.fill();
    c.strokeStyle = isF ? '#a87f47' : '#8f7a5c';
    c.lineWidth = 8;
    rr(c, 56, top, W - 112, bot - top, 34); c.stroke();

    for (var i = 0; i < 4; i++) {
      var gy = race.lanes[i].groundY;
      c.fillStyle = i % 2 ? 'rgba(255,255,255,.07)' : 'rgba(95,55,15,.06)';
      c.fillRect(64, gy - 166, W - 128, 176);
      c.strokeStyle = isF ? 'rgba(130,88,40,.45)' : 'rgba(110,90,60,.45)';
      c.lineWidth = 5;
      c.beginPath(); c.moveTo(74, gy); c.lineTo(W - 74, gy); c.stroke();
      // 车道里的“里程碑”刻度，方便学生看出领先多少
      c.fillStyle = 'rgba(255,255,255,.5)';
      for (var m = 1; m <= 3; m++) {
        var mx = race.startX + (race.endX - race.startX) * m / 4;
        c.fillRect(mx, gy - 88, 4, 24);
      }
    }

    c.strokeStyle = 'rgba(160,110,50,.35)';
    c.lineWidth = 4;
    if (c.setLineDash) c.setLineDash([28, 24]);
    for (i = 0; i < 3; i++) {
      var dy = (race.lanes[i].groundY + race.lanes[i + 1].groundY) / 2 - 6;
      c.beginPath(); c.moveTo(84, dy); c.lineTo(W - 84, dy); c.stroke();
    }
    if (c.setLineDash) c.setLineDash([]);

    checkers(c, race.startX - 88, top + 6, 26, bot - top - 12, 2);
    checkers(c, race.endX - 26, top + 6, 26, bot - top - 12, 2);
    drawFlag(c, race.endX + 66, 92);
  }

  function drawRacer(c, ch) {
    var gy = race.lanes[ch.idx].groundY;
    var x = race.startX + ch.prog * (race.endX - race.startX);
    ch.cx = x;
    c.fillStyle = 'rgba(55,32,8,.2)';
    c.beginPath(); c.ellipse(x, gy + 5, 84, 13, 0, 0, Math.PI * 2); c.fill();
    drawRider(c, ch, x, gy - 44);
    drawKart(c, ch, x, gy, ch.wheelRot, ch.phase === 'rush' ? -0.05 : 0);
  }

  /* ============================================================
   * 模式三：团队闯关 —— 大魔王 / 投掷物
   * ============================================================ */
  function drawBoss(c) {
    var B = team.boss;
    if (!B) return;
    var dead = (team.dying >= 0);
    var du = dead ? clamp01(team.dying / 0.7) : 0;
    if (dead && du >= 1) return;

    var bx = 960, by = 170;
    var shakeX = team.shake > 0 ? Math.sin(T * 55) * 9 * team.shake : 0;
    var bob = Math.sin(T * 1.7) * 7;
    var sc = backOut(clamp01(team.enter));
    var hurt = team.flash > 0.02;

    c.save();
    c.globalAlpha = 1 - du * 0.95;
    c.translate(bx + shakeX, by + bob + du * 150);
    c.scale(sc * (1 + du * 0.3), sc * (1 - du * 0.55));

    // 角
    c.fillStyle = hurt ? '#ffffff' : B.dark;
    c.beginPath(); c.moveTo(-70, -56); c.lineTo(-98, -130); c.lineTo(-32, -72); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(70, -56); c.lineTo(98, -130); c.lineTo(32, -72); c.closePath(); c.fill();

    // 身体
    c.fillStyle = hurt ? '#ffffff' : B.col;
    c.beginPath(); c.ellipse(0, 22, 112, 96, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 5; c.stroke();

    // 肚皮
    c.fillStyle = hurt ? '#ffffff' : B.light;
    c.beginPath(); c.ellipse(0, 64, 66, 46, 0, 0, Math.PI * 2); c.fill();

    // 手
    c.fillStyle = hurt ? '#ffffff' : B.col;
    circle(c, -114, 44 + Math.sin(T * 2.4) * 8, 23); c.fill();
    circle(c, 114, 44 + Math.cos(T * 2.4) * 8, 23); c.fill();

    // 眼睛
    var look = Math.sin(T * 0.9) * 5;
    c.fillStyle = '#fffdf6';
    c.beginPath(); c.ellipse(-34, -16, 23, 27, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(34, -16, 23, 27, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2a1030';
    circle(c, -34 + look, -12, 10); c.fill();
    circle(c, 34 + look, -12, 10); c.fill();
    // 怒眉
    c.strokeStyle = hurt ? '#cccccc' : B.dark;
    c.lineWidth = 9; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-58, -48); c.lineTo(-16, -32);
    c.moveTo(58, -48); c.lineTo(16, -32);
    c.stroke();

    // 嘴 + 獠牙
    var mo = 11 + Math.abs(Math.sin(T * 2.2)) * 5 + team.flash * 13;
    c.fillStyle = '#5a1830';
    c.beginPath(); c.ellipse(0, 30, 40, mo, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fffdf4';
    c.beginPath();
    c.moveTo(-26, 30 - mo + 3); c.lineTo(-16, 30 - mo + 16); c.lineTo(-6, 30 - mo + 3);
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(6, 30 - mo + 3); c.lineTo(16, 30 - mo + 16); c.lineTo(26, 30 - mo + 3);
    c.closePath(); c.fill();

    c.restore();

    if (!dead) drawBossHp(c);
  }

  function drawBossHp(c) {
    var x = 540, y = 8, w = 780, h = 28;
    c.fillStyle = 'rgba(30,15,5,.55)';
    rr(c, x - 7, y - 7, w + 14, h + 14, 15); c.fill();
    c.fillStyle = '#2c1a10';
    rr(c, x, y, w, h, 11); c.fill();

    var f = clamp01(team.hp);
    if (f > 0.004) {
      var fw = Math.max(12, w * f);
      c.fillStyle = f > 0.5 ? '#58c46a' : (f > 0.25 ? '#f0b23a' : '#e84a3a');
      rr(c, x, y, fw, h, 11); c.fill();
      c.fillStyle = 'rgba(255,255,255,.28)';
      rr(c, x + 3, y + 3, Math.max(6, fw - 6), 10, 5); c.fill();
    }
    c.font = 'bold 21px "Microsoft YaHei", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 4; c.strokeStyle = 'rgba(30,15,5,.85)';
    c.strokeText(team.info, x + w / 2, y + h / 2 + 1);
    c.fillStyle = '#ffe9c0';
    c.fillText(team.info, x + w / 2, y + h / 2 + 1);
  }

  function updateTeam(dt) {
    if (team.flash > 0) team.flash = Math.max(0, team.flash - dt * 3.2);
    if (team.shake > 0) team.shake = Math.max(0, team.shake - dt * 3.2);
    if (team.enter < 1) team.enter = Math.min(1, team.enter + dt * 2.4);
    if (team.dying >= 0) team.dying += dt;

    for (var i = team.projs.length - 1; i >= 0; i--) {
      var p = team.projs[i];
      p.t += dt;
      if (p.t >= p.dur) {
        team.projs.splice(i, 1);
        if (team.dying < 0) {
          team.flash = 1; team.shake = 1;
          if (p.hp != null) team.hp = p.hp;
          if (p.info != null) team.info = p.info;
          spawnSparkle(p.tx + (Math.random() - 0.5) * 60, p.ty + 20);
          spawnCrumbs(p.tx, p.ty + 40);
        }
      }
    }
  }

  function drawProjectiles(c) {
    for (var i = 0; i < team.projs.length; i++) {
      var p = team.projs[i];
      var u = ease(clamp01(p.t / p.dur));
      var mx = (p.x0 + p.tx) / 2, my = Math.min(p.y0, p.ty) - 190;
      var a = (1 - u) * (1 - u), bb = 2 * (1 - u) * u, cc = u * u;
      var x = a * p.x0 + bb * mx + cc * p.tx;
      var y = a * p.y0 + bb * my + cc * p.ty;
      c.save();
      c.translate(x, y); c.rotate(p.t * 9);
      theme().drawFood(c, 0, 0, 24, 0);
      c.restore();
    }
  }

  /* ============================================================
   * 粒子 / 飘字 / 气泡
   * ============================================================ */
  function spawnCrumbs(x, y) {
    for (var i = 0; i < 7; i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * 26, y: y,
        vx: (Math.random() - 0.5) * 90, vy: -40 - Math.random() * 70,
        g: 420, life: 0.7, t: 0, r: 3 + Math.random() * 3, col: '#ffe9b8', type: 'dot'
      });
    }
  }
  function spawnSweat(x, y) {
    particles.push({
      x: x, y: y, vx: (Math.random() - 0.5) * 60, vy: -130 - Math.random() * 60,
      g: 480, life: 0.8, t: 0, r: 7, col: '#9fd8f2', type: 'drop'
    });
  }
  function spawnSparkle(x, y) {
    for (var i = 0; i < 10; i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
      particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        g: 220, life: 0.6, t: 0, r: 4 + Math.random() * 4, col: '#ffd84b', type: 'star'
      });
    }
  }
  function spawnConfetti() {
    var cols = ['#e84a3a', '#f7c23a', '#4aa0e8', '#54c46a', '#f28ab0'];
    for (var i = 0; i < 130; i++) {
      confetti.push({
        x: Math.random() * W, y: -30 - Math.random() * 300,
        vy: 130 + Math.random() * 190, vx: (Math.random() - 0.5) * 70,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 6,
        w: 10 + Math.random() * 10, h: 6 + Math.random() * 6,
        col: cols[i % cols.length], t: 0, life: 5
      });
    }
  }
  function addFloat(idx, text, col) {
    floats.push({ x: 240 + idx * 480, y: 210, text: text, col: col || '#ffe14b', t: 0, life: 1.1 });
  }

  function updateParticles(dt) {
    var i;
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (i = floats.length - 1; i >= 0; i--) {
      var f = floats[i];
      f.t += dt;
      if (f.t >= f.life) { floats.splice(i, 1); continue; }
      f.y -= 46 * dt;
    }
    for (i = confetti.length - 1; i >= 0; i--) {
      var cf = confetti[i];
      cf.t += dt;
      if (cf.t >= cf.life || cf.y > H + 40) { confetti.splice(i, 1); continue; }
      cf.x += cf.vx * dt + Math.sin(cf.t * 5 + cf.rot) * 30 * dt;
      cf.y += cf.vy * dt; cf.rot += cf.vr * dt;
    }
  }

  function drawParticles(c) {
    var i, p;
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      c.globalAlpha = 1 - p.t / p.life;
      c.fillStyle = p.col;
      if (p.type === 'drop') {
        c.beginPath(); c.ellipse(p.x, p.y, p.r * 0.7, p.r, 0, 0, Math.PI * 2); c.fill();
      } else if (p.type === 'star') {
        c.save(); c.translate(p.x, p.y); c.rotate(p.t * 6);
        c.fillRect(-p.r, -p.r * 0.35, p.r * 2, p.r * 0.7);
        c.fillRect(-p.r * 0.35, -p.r, p.r * 0.7, p.r * 2);
        c.restore();
      } else {
        circle(c, p.x, p.y, p.r); c.fill();
      }
    }
    c.globalAlpha = 1;
    for (i = 0; i < floats.length; i++) {
      var f = floats[i];
      c.globalAlpha = 1 - f.t / f.life;
      c.font = 'bold ' + (f.big ? 86 : 52) + 'px "Microsoft YaHei", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = f.big ? 12 : 8;
      c.strokeStyle = 'rgba(90,40,10,.8)';
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.col;
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;
  }

  function drawConfetti(c) {
    for (var i = 0; i < confetti.length; i++) {
      var cf = confetti[i];
      c.save(); c.translate(cf.x, cf.y); c.rotate(cf.rot);
      c.globalAlpha = Math.min(1, (cf.life - cf.t) * 2);
      c.fillStyle = cf.col;
      c.fillRect(-cf.w / 2, -cf.h / 2, cf.w, cf.h);
      c.restore();
    }
    c.globalAlpha = 1;
  }

  function drawBubble(c, ch) {
    var b = ch.bubble;
    if (!b) return;
    var u = b.t / b.life;
    var pop = Math.min(1, b.t / 0.2);
    var fade = u > 0.82 ? (1 - u) / 0.18 : 1;
    var ay = 268;
    var ax = b.side === 'right' ? ch.cx + 96 : ch.cx - 96;
    var h = 66;

    c.save();
    c.font = 'bold 32px "Microsoft YaHei", sans-serif';
    var w = c.measureText(b.text).width + 44;
    var bx = b.side === 'right' ? ax : ax - w;
    var by = ay - h / 2;

    c.globalAlpha = fade;
    c.translate(ax, ay); c.scale(pop, pop); c.translate(-ax, -ay);

    c.fillStyle = 'rgba(255,252,242,.97)';
    c.strokeStyle = '#7a3b12'; c.lineWidth = 4;
    rr(c, bx, by, w, h, 20); c.fill(); c.stroke();
    c.beginPath();
    if (b.side === 'right') {
      c.moveTo(bx + 20, by + h - 2); c.lineTo(bx + 6, by + h + 30); c.lineTo(bx + 52, by + h - 2);
    } else {
      c.moveTo(bx + w - 20, by + h - 2); c.lineTo(bx + w - 6, by + h + 30); c.lineTo(bx + w - 52, by + h - 2);
    }
    c.closePath(); c.fill();
    c.strokeStyle = '#7a3b12'; c.lineWidth = 4;
    c.beginPath();
    if (b.side === 'right') {
      c.moveTo(bx + 6, by + h + 30); c.lineTo(bx + 52, by + h - 2);
      c.moveTo(bx + 6, by + h + 30); c.lineTo(bx + 20, by + h - 2);
    } else {
      c.moveTo(bx + w - 6, by + h + 30); c.lineTo(bx + w - 52, by + h - 2);
      c.moveTo(bx + w - 6, by + h + 30); c.lineTo(bx + w - 20, by + h - 2);
    }
    c.stroke();

    c.fillStyle = '#5a2f10';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(b.text, bx + w / 2, by + h / 2);
    c.restore();
    c.globalAlpha = 1;
  }

  /* ============================================================
   * 主循环
   * ============================================================ */
  function tick(dt) {
    T += dt;
    updateParticles(dt);
    if (mode === 'team') updateTeam(dt);

    var th = theme();
    var i;
    for (i = 0; i < chars.length; i++) chars[i].update(dt);

    var c = ctx;
    // 每帧先把画布状态复位：万一上一帧中途出错留下了 NaN 变换 /
    // 未配对的 save()，也不会污染这一帧
    if (c.setTransform) c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, W, H);

    if (mode === 'race') {
      th.drawBg(c);
      drawRaceRoad(c);
      for (i = 0; i < chars.length; i++) drawRacer(c, chars[i]);
      drawParticles(c);
      drawConfetti(c);
      return;
    }

    if (mode === 'team') {
      th.drawBg(c);
      drawBoss(c);
      for (i = 0; i < chars.length; i++) chars[i].drawBody(c);
      th.drawTable(c);
      for (i = 0; i < chars.length; i++) drawTrayAndStack(c, chars[i]);
      for (i = 0; i < chars.length; i++) chars[i].drawFront(c);
      drawProjectiles(c);
      drawParticles(c);
      drawConfetti(c);
      return;
    }

    /* 默认：吃食物大赛 */
    th.drawBg(c);
    for (i = 0; i < chars.length; i++) chars[i].drawBody(c);
    th.drawTable(c);
    for (i = 0; i < chars.length; i++) drawTrayAndStack(c, chars[i]);
    for (i = 0; i < chars.length; i++) chars[i].drawFront(c);
    for (i = 0; i < chars.length; i++) drawBubble(c, chars[i]);
    drawParticles(c);
    drawConfetti(c);
  }

  /* 切换模式后给所有角色套上对应初始状态 */
  function applyMode() {
    team.projs = [];
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      ch.prog = 0; ch.progFrom = 0; ch.progTo = 0;
      ch.wheelRot = 0; ch.dustT = 0;
      ch.cheering = false; ch.exp = 'normal';
      ch.mouth = 0; ch.headRot = 0; ch.bodyDy = 0;
      ch.holding = false; ch.bubble = null;
      if (mode === 'race') ch.setPhase('ride', 1);
      else if (mode === 'team') { ch.holding = true; ch.setPhase('hold', 1); }
      else ch.setPhase('idle', 1);
    }
    if (mode === 'team') setBoss(team.level);
  }

  /* ============================================================
   * 对外接口
   * ============================================================ */
  return {
    W: W, H: H,
    THEMES: THEMES,
    init: function (canvas) { ctx = canvas.getContext('2d'); ctx.textBaseline = 'middle'; },
    setTheme: function (id) { if (THEMES[id]) themeId = id; },
    themeId: function () { return themeId; },
    skins: function () { return theme().skins; },
    food: function () { return theme().food; },
    setPlayers: function (list) {
      chars = [];
      var sk = theme().skins;
      for (var i = 0; i < list.length; i++) {
        var cfg = list[i];
        if (!cfg.skin) cfg.skin = sk[i % sk.length];
        chars.push(new Character(cfg));
      }
      particles = []; floats = []; confetti = [];
      applyMode();
    },
    char: function (i) { return chars[i]; },
    addFloat: addFloat,
    sparkleAt: function (i) {
      var ch = chars[i]; if (!ch) return;
      var p = ch.mouthAbs();
      spawnSparkle(p.x + 10, p.y - 14);
    },
    confetti: spawnConfetti,

    /* ---------- 玩法模式 ---------- */
    setMode: function (m) {
      mode = (m === 'race' || m === 'team') ? m : 'eat';
      applyMode();
    },
    mode: function () { return mode; },

    /* 赛道竞速：答对后向前冲一段 */
    rush: function (i, frac) { if (chars[i]) chars[i].rush(frac); },
    stumble: function (i) { if (chars[i]) chars[i].stumble(); },
    finishRace: function (i) { if (chars[i]) chars[i].finishRace(); },

    /* 团队闯关 */
    teamLevel: function (lv, info) {
      team.level = lv || 1;
      team.info = info || '';
      setBoss(team.level);
    },
    teamInfo: function (info) { if (info != null) team.info = info; },
    teamHp: function () { return team.hp; },
    teamLv: function () { return team.level; },
    teamProg: function (i) { return chars[i] ? chars[i].prog : 0; },
    bossName: function () { return team.boss ? team.boss.name : ''; },
    bossHit: function (i, newHp, info) {
      var ch = chars[i];
      if (!ch) return;
      ch.throwFood();
      var last = team.projs[team.projs.length - 1];
      if (last) { last.hp = newHp; last.info = info; }
    },
    bossDefeat: function () { team.dying = 0; team.hp = 0; team.flash = 1; team.shake = 1; },
    banner: function (text, col) {
      floats.push({ x: 960, y: 300, text: text, col: col || '#ffe14b', t: 0, life: 1.6, big: true });
    },

    /* 自动加载 images/ 目录下的角色图片（文件名由 skin.imgSrc 指定） */
    loadDefaultImages: function (cb) {
      var sk = theme().skins, pending = 0, loaded = 0;
      for (var i = 0; i < sk.length; i++) {
        if (sk[i].imgSrc) {
          pending++;
          (function (idx, src) {
            var im = new Image();
            var done = function (ok) {
              if (ok) loaded++;
              pending--;
              if (pending === 0 && cb) cb(loaded);
            };
            im.onload = function () {
              sk[idx].img = im; sk[idx].imgReady = true;
              sk[idx].imgW = im.width; sk[idx].imgH = im.height;
              done(true);
            };
            im.onerror = function () { done(false); };
            im.src = src;
          })(i, sk[i].imgSrc);
        }
      }
      if (pending === 0 && cb) cb(0);
    },
    tick: tick
  };
})();
