/* ============================================================
 * game.js —— 主逻辑：设置、倒计时、答题判定、音效、结算
 * ============================================================ */
(function () {

  /* ================= 触摸事件绑定（兼容老内核浏览器） =================
   * 现代浏览器：Pointer Events（天然支持四人同时多点）
   * 老 / IE 系内核：自动降级为 touchstart + mousedown
   * ================================================================= */
  var HAS_POINTER = typeof window.PointerEvent === 'function';
  var lastTouchMs = 0;

  function bindTap(el, fn) {
    function wrap(e) {
      if (e.preventDefault) e.preventDefault();
      fn(e);
    }
    if (HAS_POINTER) {
      el.addEventListener('pointerdown', wrap, false);
    } else {
      el.addEventListener('touchstart', function (e) {
        lastTouchMs = Date.now();
        wrap(e);
      }, false);
      el.addEventListener('mousedown', function (e) {
        if (e.button && e.button !== 0) return;
        if (Date.now() - lastTouchMs < 700) return;   // 去掉触摸后合成的鼠标事件
        wrap(e);
      }, false);
    }
  }

  var $ = function (id) { return document.getElementById(id); };
  var W = 1920, H = 1080;

  /* 题库洗牌（js/banks.js 约定各页面自己调）：源数据正确答案固定在 o[0]，
     调用后打散到 A/B/C/D 随机位置。shuffleBank 自带随机数，不依赖本页面的 ri()。 */
  try { shuffleBank(SAFE_BANK); } catch (e) { }   /* 热身赛只用安全知识题库 */

  var state = 'setup';           // setup | count | play | pause | over
  var cfg = { buns: 10, level: 0, theme: 'star', mode: 'team', names: [] };
  var players = [];
  var startMs = 0, pausedMs = 0, elapsed = 0;

  /* 团队闯关：星门充能到 100% 即胜利
   * 答对 +2.5%（约 40 题充满）、答错 −2%（缓慢漏掉），限时 60 秒。
   * 每人基准 10 题（四人共 40 题）；答错后要多答几题补回来。 */
  var TEAM_MAX_LEVEL = 1;
  var TEAM_BUNS = 10;
  var TEAM_TIME = 60;
  var CHARGE_ADD = 0.025;
  var CHARGE_SUB = 0.02;
  var CHARGE_IDLE = 0.015;      /* 5 秒没答题：扣 1.5%，防止有人挂机等队友答 */
  var IDLE_MS = 5000;
  var teamDone = 0, teamLevel = 1, teamWon = false, teamBusy = false;
  function teamNeed() { return cfg.buns * 4; }
  function teamInfoText() {
    return '已答对 ' + teamDone + ' 题';
  }
  /* 赛道竞速：是否已有人冲线 */
  var raceFirst = false;

  /* ---------------- 玩法已固定为「团队闯关」 ----------------
   * 热身赛 = 关卡制的门票流水线：四人合力把星门充到 100%，通关奖 30 星尘，
   * 失败不产星尘。吃食物 / 赛道竞速的代码保留但不进设置页。 */
  var MODES = [
    { id: 'team', name: '团队闯关（推荐！）', desc: '四人合力点亮星门，攒星尘去追回散落各界的星核碎片！' }
  ];

  /* ================= 热身赛出题（两类） =================
   * ① 乘法口诀 ± 一个数（数字键盘输答案）50%
   * ② 安全知识（ABCD 四选一，即点即判）50%
   * 不再出语文 / 英语题；安全题库来自 js/banks.js（与关卡挑战共享）。 */
  function bankQuestion(bank) {
    var it = bank[Math.floor(Math.random() * bank.length)];
    /* 每次抽题把选项顺序打乱（正确答案源数据固定在 o[0]） */
    var idx = [0, 1, 2, 3], o = [], a = 0;
    for (var i = 3; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    for (var k = 0; k < 4; k++) { o.push(it.o[idx[k]]); if (idx[k] === it.a) a = k; }
    return { type: 'opt', text: it.q, opts: o, ans: a };
  }
  function mixedQuestion() {
    if (Math.random() < 0.5) {
      var mq = QGen.table();                       // 乘法口诀 ± 一个数
      return { type: 'key', text: mq.text, ans: mq.ans };
    }
    return bankQuestion(SAFE_BANK);                // 安全知识四选一
  }

  /* 标题统一为「热身赛」：不含学科词，以后加语文知识竞赛也不用改 */
  var GAME_TITLE = '学院晨练 · 热身赛';
  var ROSTER = {
    star: '四位星图学员',
    forest: '熊大、熊二、光头强、蹦蹦',
    tavern: '四位壮士'
  };
  /* 副标题按主题自动生成，同样不含学科词 */
  var SUBS = {
    team: function (r) { return r + '侧身骑发电单车：答对 +2.5%、答错 −2%、5 秒不答题 −1.5% —— 60 秒内把星门充到 100% 就赢！'; }
  };

  /* 刷新设置页标题与副标题 */
  function applyTitle() {
    var h1 = document.querySelector('#setup h1');
    var sub = document.querySelector('#setup .sub');
    if (h1) h1.textContent = GAME_TITLE;
    if (sub) sub.textContent = (SUBS[cfg.mode] || SUBS.team)(ROSTER[cfg.theme] || ROSTER.forest);
  }

  /* ================= 星尘池（与 boss-battle.html 共享） =================
     pool = 班级攒的星尘；need = 点亮关卡星门要几张点；on = 门槛开关
     本游戏只负责「产出星尘」，消耗由 boss-battle.html 开战时扣。      */
  var ENERGY_KEY = 'arena_energy_v1';
  function loadEnergy() {
    var d = { pool: 0, need: 30, on: 1 };
    try {
      var s = window.localStorage.getItem(ENERGY_KEY);
      if (s) {
        var o = JSON.parse(s);
        if (o && typeof o === 'object') {
          /* pool 允许小数：基础难度一题 0.5 点 */
          if (typeof o.pool === 'number' && isFinite(o.pool) && o.pool >= 0) d.pool = Math.round(o.pool * 10) / 10;
          if (typeof o.need === 'number' && isFinite(o.need) && o.need >= 1) d.need = Math.floor(o.need);
          d.on = o.on ? 1 : 0;
        }
      }
    } catch (e) { }
    return d;
  }
  function saveEnergy(d) {
    try { window.localStorage.setItem(ENERGY_KEY, JSON.stringify(d)); return true; }
    catch (e) { return false; }
  }
  /* 星尘点数可能是 0.5 的小数：3 显示成「3」，3.5 显示成「3.5」 */
  function eNum(x) {
    var v = Math.round(x * 10) / 10;
    return (v === Math.floor(v)) ? String(Math.floor(v)) : v.toFixed(1);
  }
  /* 结算星尘：加进池子 → 团队模式且不满门槛则清零。返回最终状态 */
  function addEnergy(gain, earned) {
    var ed = loadEnergy();
    if (gain > 0) ed.pool = Math.round((ed.pool + gain) * 10) / 10;
    var poolAfter = ed.pool, cleared = false;
    if (earned && ed.on && ed.pool < ed.need) { ed.pool = 0; cleared = true; }
    saveEnergy(ed);
    return { ed: ed, poolAfter: poolAfter, cleared: cleared };
  }

  /* earned: 本局是否产星尘（只有通关才产）  poolAfter: 清零前算出来的池子  cleared: 是否已清零 */
  function renderEnergyResult(totalRight, gain, ed, earned, poolAfter, cleared) {
    var eb = $('energyBox');
    if (eb) {
      var html = '';
      if (!earned) {
        html += '<div class="eGain">本局四人共答对 ' + totalRight + ' 题 · 未通关，<b>本局不产星尘</b></div>';
        html += '<div class="ePool eTip2">热身赛<b>通关</b>（60 秒内星门充能到 100%）才能拿到 <b>30</b> 点星尘 —— 再来一局吧！</div>';
      } else {
        html += '<div class="eGain">热身赛通关！　→　获得 <b>+' + eNum(gain) + '</b> 点星尘</div>';
        if (!ed.on) {
          html += '<div class="ePool">星尘门槛已由老师关闭，可随时挑战第一关</div>';
        } else if (cleared) {
          html += '<div class="ePool">本局攒到 <b>' + eNum(poolAfter) + '</b> / ' + ed.need +
            ' 点，<span class="eNo">没攒够 ' + ed.need + ' 点，星尘已清零</span></div>';
          html += '<div class="ePool" style="font-size:19px">换下一批学生上台，从 0 点重新开始攒。</div>';
        } else {
          html += '<div class="ePool">班级星尘池：<b>' + eNum(ed.pool) + '</b> / ' + ed.need + ' 点' +
            '<span class="eOk">星尘充足，可以去挑战第一关！</span></div>';
        }
      }
      eb.innerHTML = html;
    }
    var bb = $('btnBoss');
    if (bb) {
      var can = !ed.on || ed.pool >= ed.need;
      if (can) { bb.classList.remove('locked'); bb.textContent = '挑 战 第 一 关 →'; }
      else { bb.classList.add('locked'); bb.textContent = '星 尘 不 足 ' + eNum(ed.pool) + '/' + ed.need; }
    }
  }

  /* ================= 缩放适配 ================= */
  function fit() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    var st = $('stage');
    st.style.transform = 'scale(' + s + ')';
    st.style.left = Math.max(0, (window.innerWidth - W * s) / 2) + 'px';
    st.style.top = Math.max(0, (window.innerHeight - H * s) / 2) + 'px';
  }
  function refit() { fit(); setTimeout(fit, 120); }
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  window.addEventListener('fullscreenchange', refit);
  window.addEventListener('webkitfullscreenchange', refit);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refit(); });
  if (window.visualViewport && window.visualViewport.addEventListener) window.visualViewport.addEventListener('resize', refit);

  /* ================= 音效 ================= */
  var Sound = (function () {
    var ac = null, muted = false;
    function A() {
      if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
      if (ac && ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(f, d, type, v, delay, slide) {
      var a = A(); if (!a || muted) return;
      var t0 = a.currentTime + (delay || 0);
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(f, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + d);
      g.gain.setValueAtTime(v || 0.06, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + d + 0.03);
    }
    return {
      click: function () { tone(760, 0.05, 'square', 0.035); },
      ok: function () { tone(660, 0.09, 'square', 0.06); tone(990, 0.14, 'square', 0.06, 0.09); },
      bad: function () { tone(320, 0.16, 'sawtooth', 0.05); tone(210, 0.22, 'sawtooth', 0.05, 0.15); },
      eat: function () { tone(150, 0.07, 'square', 0.09, 0, 70); tone(120, 0.07, 'square', 0.09, 0.09, 60); },
      count: function () { tone(520, 0.1, 'square', 0.06); },
      go: function () { tone(780, 0.16, 'square', 0.08); tone(1040, 0.22, 'square', 0.08, 0.14); },
      win: function () {
        var seq = [523, 659, 784, 1046];
        for (var i = 0; i < seq.length; i++) tone(seq[i], 0.16, 'square', 0.07, i * 0.14);
        tone(1318, 0.4, 'square', 0.07, 0.56);
      },
      toggleMute: function () { muted = !muted; return muted; }
    };
  })();

  /* ================= 设置面板 ================= */
  var syncBuns = function () { };   // 由 buildSetup 赋值：同步「数量」按钮的选中态
  function buildSetup() {
    /* 玩法固定为团队闯关：题型为乘法口诀±一个数 + 安全知识，模式/难度选择已移除 */

    var bunBox = $('optBuns');
    var bunOpts = [5, 10, 15, 20];
    syncBuns = function () {
      var bs = bunBox.querySelectorAll('.opt');
      for (var i = 0; i < bs.length; i++) {
        bs[i].classList.toggle('on', parseInt(bs[i].getAttribute('data-n'), 10) === cfg.buns);
      }
    };
    bunOpts.forEach(function (n) {
      var b = document.createElement('button');
      b.className = 'opt' + (n === cfg.buns ? ' on' : '');
      b.setAttribute('data-n', n);
      b.innerHTML = n + ' 个';
      bindTap(b, function (e) {
        e.preventDefault(); cfg.buns = n; Sound.click(); syncBuns();
      });
      bunBox.appendChild(b);
    });

    /* 题目难度已移除：热身赛固定「乘法口诀±一个数 + 安全知识」（难度档移到进阶版老师设置页） */

    // 场景 / 角色主题
    var thBox = $('optTheme');
    var TH_LIST = [
      { id: 'star', name: '星空学院', desc: '星尘 · 星门充能', roles: '四位星图学员 · 答对即汇入星门' }
    ];
    TH_LIST.forEach(function (th) {
      var b = document.createElement('button');
      b.className = 'opt optCard' + (th.id === cfg.theme ? ' on' : '');
      b.innerHTML = th.name + '<span class="small">' + th.desc + '</span>' +
        '<span class="roles">' + th.roles + '</span>';
      bindTap(b, function (e) {
        e.preventDefault(); Sound.click(); applyTheme(th.id);
        var bs = thBox.querySelectorAll('.opt');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('on');
        b.classList.add('on');
      });
      thBox.appendChild(b);
    });

    for (var i = 0; i < 4; i++) $('nm' + i).value = cfg.names[i];

    bindTap($('btnStart'), function (e) {
      e.preventDefault(); Sound.ok(); startGame();
    });
  }


  /* 刷新题量说明（玩法固定团队闯关，题量固定）：更新背景预览 */
  function applyMode() {
    cfg.buns = TEAM_BUNS;
    var ob = $('optBuns'), fb = $('bunsFixed');
    if (ob) ob.classList.add('gone');
    if (fb) fb.classList.remove('gone');
    syncBuns();
    applyTitle();
    showDemo();
  }

  /* 切换主题：更新场景、默认角色名、食物数量文案 */
  function applyTheme(id) {
    cfg.theme = id;
    Scene.setTheme(id);
    var sk = Scene.skins();
    cfg.names = [];
    for (var i = 0; i < 4; i++) {
      cfg.names.push(sk[i].name);
      $('nm' + i).value = sk[i].name;
    }
    applyMode();   // 内部会调用 applyTitle()，标题与副标题自动跟着主题、模式走
  }

  /* 背景预览：设置页 / 未开局时展示当前主题的角色 */
  function showDemo() {
    Scene.setMode(cfg.mode);
    var list = [], sk = Scene.skins();
    for (var i = 0; i < 4; i++) {
      list.push({ idx: i, name: sk[i].name, buns: cfg.buns, skin: sk[i], onSwallow: null, onEatDone: null });
    }
    Scene.setPlayers(list);
    if (cfg.mode === 'team') Scene.teamLevel(1, '星门充能 · 答对 +2.5% · 答错 −2%');
    for (i = 0; i < 4; i++) Scene.char(i).plate = cfg.buns;
  }

  /* ================= 四人操作面板 ================= */
  // 数字键盘：不再需要正负号（答案都是非负整数）
  var KEY_HTML =
    '<button class="kbtn" data-k="7">7</button><button class="kbtn" data-k="8">8</button>' +
    '<button class="kbtn" data-k="9">9</button><button class="kbtn act" data-k="del">⌫</button>' +
    '<button class="kbtn" data-k="4">4</button><button class="kbtn" data-k="5">5</button>' +
    '<button class="kbtn" data-k="6">6</button><button class="kbtn act" data-k="clr">清空</button>' +
    '<button class="kbtn" data-k="1">1</button><button class="kbtn" data-k="2">2</button>' +
    '<button class="kbtn" data-k="3">3</button>' +
    '<button class="kbtn wide" data-k="0">0</button>' +
    '<button class="kbtn wide go" data-k="ok">✔ 确定</button>';

  function buildPanels() {
    var box = $('panels');
    box.innerHTML = '';
    var OPT_LETTERS = ['A', 'B', 'C', 'D'];
    for (var i = 0; i < 4; i++) {
      var col = Scene.skins()[i];
      var d = document.createElement('div');
      d.className = 'pcol';
      d.id = 'pcol' + i;
      d.dataset.i = i;
      var optsHtml = '';
      for (var k = 0; k < 4; k++) {
        optsHtml += '<button class="popt" data-o="' + k + '"><i>' + OPT_LETTERS[k] + '</i>' +
          '<span id="pt' + i + '_' + k + '">—</span></button>';
      }
      d.innerHTML =
        '<div class="phead">' +
        '<span class="pdot" style="background:' + col.main + '"></span>' +
        '<span class="pname" id="pn' + i + '">' + (cfg.names[i] || ('玩家' + (i + 1))) + '</span>' +
        '<span class="pbadge" id="pb' + i + '"></span>' +
        '<span class="pprog" id="pp' + i + '">' + (cfg.mode === 'team' ? '0 题' : '0/' + cfg.buns) + '</span>' +
        '</div>' +
        '<div class="pbar"><div class="pbarIn" id="pbar' + i + '" style="background:' + col.main + '"></div></div>' +
        '<div class="pq" id="pq' + i + '">' +
        '<span class="qt" id="qt' + i + '">—</span>' +
        '<span class="qeq" id="qe' + i + '" style="color:' + col.dark + '">=</span>' +
        '<span class="qbox" id="qb' + i + '" style="border-color:' + col.main + ';color:' + col.dark + '"></span>' +
        '</div>' +
        '<div class="pkeys">' + KEY_HTML + '</div>' +
        '<div class="popts">' + optsHtml + '</div>';
      box.appendChild(d);
    }
  }

  /* 多点触控：事件委托只绑一次
   * （如果放在 buildPanels 里，每开一局就会多一层监听，
   *   一次点击会触发两遍，输入变成 11、55…… 永远答错） */

/* ---------- 触摸命中：按舞台原始坐标找按键，不依赖浏览器对 transform 的命中测试 ----------
   一体机在非 1920×1080 分辨率 / 系统缩放 / 老内核下，e.target 可能指向相邻按键
   （表现为「按 1 却输入了别的数字」）。这里把触点换算回 1920×1080 舞台坐标，
   直接对按钮矩形做命中，并给边缘留 18px 容差。 */
  function hitPanelButton(clientX, clientY, box) {
  var stage = document.getElementById('stage');
  if (!box || !stage || clientX == null || clientY == null) return null;
  var sr = stage.getBoundingClientRect();
  if (!sr.width) return null;
  var sc = sr.width / W;
  var sx = (clientX - sr.left) / sc, sy = (clientY - sr.top) / sc;
  var nodes = box.querySelectorAll('[data-k],[data-o]');
  var best = null, bd = Infinity;
  for (var n = 0; n < nodes.length; n++) {
    var r = nodes[n].getBoundingClientRect();
    if (!r.width || !r.height) continue;
    var x0 = (r.left - sr.left) / sc, x1 = (r.right - sr.left) / sc;
    var y0 = (r.top - sr.top) / sc, y1 = (r.bottom - sr.top) / sc;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return nodes[n];
    var dx = Math.max(x0 - sx, 0, sx - x1), dy = Math.max(y0 - sy, 0, sy - y1);
    var d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = nodes[n]; }
  }
  return bd <= 324 ? best : null;      /* 18px（舞台坐标）容差 */
}
  /* 老内核走 touchstart 时没有 clientX，从 touches 里取 */
  function pointOf(e) {
    if (e.clientX != null) return { x: e.clientX, y: e.clientY };
    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    return t ? { x: t.clientX, y: t.clientY } : null;
  }
  var _lastTap = { t: 0, x: -999, y: -999 };
  function tapGuard(x, y) {
    var now = Date.now();
    if (now - _lastTap.t < 60 && Math.abs(x - _lastTap.x) < 10 && Math.abs(y - _lastTap.y) < 10) return false;
    _lastTap = { t: now, x: x, y: y };
    return true;
  }
  function bindFitEvents(fit) {
  function refit() { fit(); setTimeout(fit, 120); }
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  window.addEventListener('fullscreenchange', refit);
  window.addEventListener('webkitfullscreenchange', refit);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refit(); });
  if (window.visualViewport && window.visualViewport.addEventListener) window.visualViewport.addEventListener('resize', refit);
}

  function bindPanels() {
    var box = $('panels');
    bindTap(box, function (e) {
      var pt = pointOf(e);
      if (pt && !tapGuard(pt.x, pt.y)) return;
      var btn = pt ? hitPanelButton(pt.x, pt.y, box) : null;
      if (!btn || btn === box) {
        btn = e.target;
        while (btn && btn !== box && !(btn.classList && (btn.classList.contains('kbtn') || btn.classList.contains('popt')))) btn = btn.parentNode;
      }
      if (!btn || btn === box) return;
      e.preventDefault();
      var colEl = btn.closest ? btn.closest('.pcol') : null;
      var idx = colEl ? +colEl.dataset.i : +btn.getAttribute('data-i');
      if (btn.classList.contains('popt')) { submitOpt(idx, +btn.getAttribute('data-o')); return; }
      onKey(idx, btn.getAttribute('data-k'));
    });
  }

  /* ================= 游戏流程 ================= */
  function startGame() {
    for (var i = 0; i < 4; i++) {
      var nm = $('nm' + i).value.trim() || ('玩家' + (i + 1));
      cfg.names[i] = nm;
    }
    buildPanels();

    players = [];
    var list = [];
    var sk = Scene.skins();
    for (i = 0; i < 4; i++) {
      list.push({
        idx: i, name: cfg.names[i], buns: cfg.buns, skin: sk[i],
        onSwallow: onSwallow, onEatDone: onEatDone
      });
      players.push({
        idx: i, name: cfg.names[i], input: '', q: null,
        eaten: 0, wrong: 0, done: false, finishMs: 0, busy: false,
        combo: 0, bestCombo: 0, fastest: 0, qStart: 0, hint: false
      });
    }
    Scene.setTheme(cfg.theme);
    Scene.setMode(cfg.mode);

    // 团队闯关：重置关卡
    teamDone = 0; teamLevel = 1; teamWon = false; teamBusy = false;
    raceFirst = false;
    if (cfg.mode === 'team') {
      Scene.teamLevel(1, teamInfoText());
    }

    Scene.setPlayers(list);

    $('overlay').classList.add('hidden');
    var tEl = $('timeout'); if (tEl) tEl.classList.remove('show');
    var vEl = $('victory'); if (vEl) vEl.classList.remove('show');
    var hudEl = $('hudTime'); if (hudEl) hudEl.classList.remove('warn');
    $('btnPause').textContent = '⏸';
    elapsed = 0;
    if (cfg.mode === 'team' && hudEl) hudEl.textContent = '剩 ' + TEAM_TIME + 's';

    // 倒计时 3 2 1 GO
    state = 'count';
    var cd = $('countdown');
    cd.classList.add('show');
    var seq = ['3', '2', '1', 'GO!'];
    var k = 0;
    (function step() {
      if (state !== 'count') { cd.classList.remove('show'); return; }
      cd.textContent = seq[k];
      if (seq[k] === 'GO!') { Sound.go(); } else { Sound.count(); }
      k++;
      if (k < seq.length) { setTimeout(step, 850); }
      else {
        setTimeout(function () {
          cd.classList.remove('show');
          state = 'play';
          startMs = performance.now();
          for (var j = 0; j < 4; j++) newQuestion(j);
        }, 550);
      }
    })();
  }

  /* 题目文本按长度自动缩小字号，保证不溢出 */
  function setQuestion(i, text) {
    var el = $('qt' + i);
    el.textContent = text;
    var len = text.length;
    el.style.fontSize = len > 22 ? '22px' : (len > 14 ? '28px' : (len > 10 ? '35px' : '43px'));
  }

  function newQuestion(i) {
    var p = players[i];
    p.q = mixedQuestion();
    p.input = '';
    p.busy = false;
    p.qStart = elapsed;
    p.idleNext = elapsed + IDLE_MS;      /* 5 秒内不作答 → 扣 1.5% */
    setQuestion(i, p.q.text);

    var col = $('pcol' + i);
    var qb = $('qb' + i), qe = $('qe' + i);
    /* 数学题：显示「= 答案框 + 数字键盘」；选择题：隐藏答案框，亮出 ABCD */
    var isOpt = (p.q.type === 'opt');
    qb.style.display = isOpt ? 'none' : '';
    qe.style.display = isOpt ? 'none' : '';
    qb.textContent = '';
    qb.classList.remove('bad', 'hint', 'ok');
    if (col) {
      col.classList.toggle('optMode', isOpt);
      /* 清掉上一题的答错/亮答案高亮，避免颜色残留到新题上 */
      var pb = col.querySelectorAll('.popt');
      for (var b2 = 0; b2 < pb.length; b2++) pb[b2].classList.remove('showAns', 'badSel');
    }
    $('pq' + i).classList.toggle('optQ', isOpt);
    if (isOpt) {
      for (var k = 0; k < 4; k++) {
        var sp = $('pt' + i + '_' + k);
        if (sp) sp.textContent = p.q.opts[k];
      }
    }
    $('pq' + i).classList.remove('done');
    $('pq' + i).classList.remove('idleWarn');
    // 吃食物模式：盘中数量 = 还没吃掉的总数（含正在答的这一个），开局即与设置数量一致
    if (cfg.mode === 'eat') Scene.char(i).giveBun(cfg.buns - p.eaten);
  }

  function onSwallow(i) {
    var p = players[i];
    p.eaten++;
    Sound.eat();
    Scene.addFloat(i, '真香!');
    Scene.char(i).say('好吃，再来一个！');
    updateProgress(i);
  }

  function onEatDone(i) {
    var p = players[i];
    if (p.eaten >= cfg.buns) {
      p.done = true;
      p.finishMs = elapsed;
      $('qt' + i).textContent = '全部吃完！';
      $('qb' + i).textContent = '';
      $('pq' + i).classList.add('done');
      Scene.char(i).cheer();
      checkAllDone();
    } else {
      newQuestion(i);
    }
  }

  function checkAllDone() {
    for (var i = 0; i < 4; i++) if (!players[i].done) return;
    endGame();
  }

  function onKey(i, k) {
    if (state !== 'play') return;
    /* 星门已点亮、正在播过关过场：不再收题，保证答对题数正好是 teamNeed() */
    if (cfg.mode === 'team' && teamBusy) return;
    var p = players[i];
    if (p.done || p.busy || !p.q) return;
    /* 选择题面板不收数字输入（键盘已隐藏，防误触） */
    if (p.q.type === 'opt' && k !== 'ok') return;

    if (k >= '0' && k <= '9') {
      if (p.input.length >= 4) return;
      if (p.input === '0') p.input = '';
      p.input += k;
      Sound.click();
    } else if (k === 'del') {
      p.input = p.input.slice(0, -1);
      Sound.click();
    } else if (k === 'clr') {
      p.input = '';
      Sound.click();
    } else if (k === 'ok') {
      submit(i);
      return;      // 判断结果的显示（含正确答案提示）交给 submit 自己管
    }
    // 学生一敲数字，就把“正确答案”提示收掉
    var el = $('qb' + i);
    if (p.hint) { p.hint = false; el.classList.remove('hint'); }
    el.textContent = p.input === '' ? '' : p.input;
  }

  var COMBO_WORDS = { 2: '二连击', 3: '三连击', 4: '四连击', 5: '五连击', 8: '八连击', 10: '十连击!' };

  /* 团队答对公共流程：数字题与选择题共用 */
  function teamRight(i) {
    Sound.ok();
    var p = players[i];
    p.combo++;
    if (p.combo > p.bestCombo) p.bestCombo = p.combo;

    // 速度奖励（8 秒内作答）
    var used = elapsed - p.qStart;
    if (used > 0 && (!p.fastest || used < p.fastest)) p.fastest = used;

    // 连击 / 神速播报
    if (COMBO_WORDS[p.combo]) {
      Scene.addFloat(i, COMBO_WORDS[p.combo] + ' x' + p.combo, '#ffb03a');
      Scene.sparkleAt(i);
    }
    if (used > 0 && used < 8000) Scene.addFloat(i, '神速!', '#7ce07c');

    p.eaten++;
    if (Scene.char(i)) Scene.char(i).teamScore(p.eaten);
    teamDone++;
    Scene.bossHit(i, CHARGE_ADD, teamInfoText());   /* 答对：充能 +2.5% */
    updateProgress(i);
    checkTeamHp();                                  /* 充满 100% 即胜利 */
    if (state === 'play') newQuestion(i); // 节奏不断，马上出新题
  }

  /* 选择题判定：即点即判 */
  function submitOpt(i, c) {
    if (state !== 'play') return;
    if (cfg.mode === 'team' && teamBusy) return;
    var p = players[i];
    if (p.done || p.busy || !p.q || p.q.type !== 'opt') return;

    if (c === p.q.ans) {
      var el = $('qb' + i);
      el.classList.remove('bad'); void el.offsetWidth;
      el.classList.add('ok');
      teamRight(i);
      return;
    }

    /* ---- 答错：只标红选错的那个选项，不揭示正确答案，1 秒后换题 ---- */
    Sound.bad();
    p.wrong++;
    p.combo = 0;
    p.busy = true;                       // 换题前不收二次点击
    var col = $('pcol' + i);
    if (col) {
      var btns = col.querySelectorAll('.popt');
      for (var k = 0; k < btns.length; k++) {
        var v = +btns[k].getAttribute('data-o');
        if (v === c) btns[k].classList.add('badSel');
      }
    }
    Scene.char(i).wrong();
    Scene.chargeLoss(CHARGE_SUB);        // 答错 → 星门缓慢漏掉 2%
    updateProgress(i);
    setTimeout(function () { if (players[i]) newQuestion(i); }, 950);
  }

  function submit(i) {
    var p = players[i];
    if (p.input === '' || p.input === '-') return;
    var v = parseInt(p.input, 10);

    if (v === p.q.ans) {
      /* ===================== ✔ 答对 ===================== */
      Sound.ok();
      var el = $('qb' + i);
      el.classList.remove('bad'); void el.offsetWidth;
      el.classList.add('ok');

      // 连击统计
      p.combo++;
      if (p.combo > p.bestCombo) p.bestCombo = p.combo;

      // 速度奖励（8 秒内作答）
      var used = elapsed - p.qStart;
      if (used > 0 && (!p.fastest || used < p.fastest)) p.fastest = used;

      // 连击 / 神速播报
      if (COMBO_WORDS[p.combo]) {
        Scene.addFloat(i, COMBO_WORDS[p.combo] + ' x' + p.combo, '#ffb03a');
        Scene.sparkleAt(i);
      }
      if (used > 0 && used < 8000) Scene.addFloat(i, '神速!', '#7ce07c');

      if (cfg.mode === 'eat') {
        p.busy = true;
        Scene.char(i).eat();
      } else if (cfg.mode === 'race') {
        p.eaten++;
        updateProgress(i);
        if (p.eaten >= cfg.buns) {
          p.done = true; p.finishMs = elapsed;
          Scene.finishRace(i);
          $('qt' + i).textContent = '到达终点！';
          $('qb' + i).textContent = '';
          $('pq' + i).classList.add('done');
          Scene.addFloat(i, '冲线！', '#ffe14b');
          if (!raceFirst) { raceFirst = true; Scene.confetti(); }
          checkAllDone();
        } else {
          Scene.rush(i, p.eaten / cfg.buns);
          newQuestion(i);
        }
      } else {
        /* 团队闯关：把手里的星尘投向中央星门 */
        teamRight(i);
      }
      return;
    }

    /* ===================== ✘ 答错 ===================== */
    Sound.bad();
    p.wrong++;
    p.combo = 0;
    var el2 = $('qb' + i);
    el2.classList.remove('bad'); void el2.offsetWidth;
    el2.classList.add('bad');
    el2.classList.add('hint');
    p.hint = true;                      // 提示中
    el2.textContent = p.q.ans;          // 亮出正确答案，学生马上知道错在哪

    if (cfg.mode === 'race') Scene.stumble(i); else Scene.char(i).wrong();
    Scene.chargeLoss(CHARGE_SUB);        // 答错 → 星门缓慢漏掉 2%

    // 换一题（食物/进度不丢，只是浪费了时间）
    p.input = '';
    newQuestion(i);

    setTimeout(function () {
      var e3 = $('qb' + i);
      e3.classList.remove('bad'); e3.classList.remove('hint');
      if (players[i] && players[i].input === '') e3.textContent = '';
    }, 950);

    updateProgress(i);
  }

  /* 星门充能到 100%（并显示已满）才通关 */
  function checkTeamHp() {
    if (teamBusy) return;
    if (Scene.charge().disp >= 1) teamLevelClear();
  }

  /* 过关：撒彩带 + 横幅 + 星门点亮 */
  function teamLevelClear() {
    if (teamBusy) return;
    teamBusy = true;
    Scene.bossDefeat();
    Sound.win();
    Scene.confetti();

    if (teamLevel >= TEAM_MAX_LEVEL) {
      teamWon = true;
      Scene.banner('星门点亮 · 团队胜利！', '#ffe14b');
      /* 四块面板统一提示「已打倒」，并停止收题（见 onKey 的 teamBusy 判断） */
      for (var k = 0; k < 4; k++) {
        var qt = $('qt' + k); if (qt) qt.textContent = '星门已点亮！';
        var qb = $('qb' + k); if (qb) qb.textContent = '';
        if (players[k]) players[k].input = '';
      }
      setTimeout(teamWinScreen, 2200);
      return;
    }
    Scene.banner('星门充能完成！', '#ffe14b');
    var next = teamLevel + 1;
    setTimeout(function () {
      teamBusy = false;
      if (state !== 'play') return;
      teamLevel = next;
      // 过场期间多打的伤害结转到下一关，不白打
      if (teamDone >= teamNeed()) teamDone -= teamNeed(); else teamDone = 0;
      Scene.teamLevel(teamLevel, teamInfoText());
      Scene.banner('第 ' + teamLevel + ' 关 · ' + Scene.bossName() + ' 来了！', '#ff9a5a');
      checkTeamHp();                         // 过场期间又被打空，马上接着过
    }, 1900);
  }

  /* ============ 团队闯关胜利：黑屏庆祝 + 一键进进阶版 ============ */
  function teamWinScreen() {
    if (state === 'over' || state === 'timeout') return;   // 已结算过就不再重复加星尘
    state = 'over';
    Sound.win();

    var i, totalRight = 0, totalWrong = 0, per = [];
    for (i = 0; i < 4; i++) {
      totalRight += players[i].eaten || 0;
      totalWrong += players[i].wrong || 0;
      per.push(players[i].name + ' <b>' + (players[i].eaten || 0) + '</b>');
    }

    /* 星尘结算：热身赛通关固定奖励 30 点，正好够换一张第一关门票 */
    var gain = 30;
    var st = addEnergy(gain, true);
    var ed = st.ed;
    var enough = !ed.on || ed.pool >= ed.need;

    var used = elapsed / 1000;
    var left = Math.max(0, Math.ceil(TEAM_TIME - used));

    var vs = $('vicStats');
    if (vs) {
      vs.innerHTML = '⏱ 用时 <b>' + used.toFixed(1) + '</b> 秒（限时 ' + TEAM_TIME + ' 秒，还剩 <b>' + left + '</b> 秒）' +
        '　·　四人共答对 <b>' + totalRight + '</b> 题　·　答错 <b>' + totalWrong + '</b> 次' +
        '<br>答对题数：' + per.join('　·　');
    }

    var ve = $('vicEnergy');
    if (ve) {
      if (!ed.on) {
        ve.innerHTML = '通关奖励 <b>+' + eNum(gain) + '</b> 点星尘（老师已关闭星尘门槛，随时都能挑战第一关）';
      } else if (st.cleared) {
        ve.innerHTML = '本局奖励 <b>+' + eNum(gain) + '</b> 点星尘，但还没到 <b>' + ed.need +
          '</b> 点门槛，<span class="vNo">已清零</span>　→　再通一次关就能解锁第一关';
      } else {
        ve.innerHTML = '✨ 通关奖励 <b>+' + eNum(gain) + '</b> 点星尘　·　星尘池 <b>' +
          eNum(ed.pool) + ' / ' + ed.need + '</b>　→　' +
          (enough ? '已攒够门票，去挑战第一关！' : '<span class="vNo">还差 ' + eNum(ed.need - ed.pool) + ' 点</span>');
      }
    }

    var bg = $('btnVicGo');
    if (bg) {
      if (enough) { bg.classList.remove('locked'); bg.textContent = '挑 战 第 一 关 · 魔 法 师 大 战 魔 王 →'; }
      else { bg.classList.add('locked'); bg.textContent = '星 尘 不 足 · 再 打 一 局 热 身 赛 →'; }
    }

    var v = $('victory'); if (v) v.classList.add('show');
  }

  /* ================= 挂机惩罚：5 秒不答题扣 1.5% =================
     四人各算各的：谁的题目 5 秒没动，谁就往外漏能；答了（对/错）会换新题并重计时。
     防止有学生干坐着，等另外三位把星门充满。 */
  function checkIdle() {
    if (cfg.mode !== 'team' || teamBusy || teamWon) return;
    if (Scene.charge().target >= 1) return;   /* 已充满：等胜利过场，不再挂机扣能 */
    for (var i = 0; i < 4; i++) {
      var p = players[i];
      if (!p || !p.q || p.done || p.busy) continue;
      if (p.idleNext == null) { p.idleNext = elapsed + IDLE_MS; continue; }
      var n = 0;
      while (elapsed >= p.idleNext && n < 3) {
        Scene.chargeLoss(CHARGE_IDLE);
        Scene.addFloat(i, '−1.5%', '#ff8a7a', true);
        var box = $('pq' + i); if (box) box.classList.add('idleWarn');
        p.idleNext += IDLE_MS;
        n++;
      }
      if (n >= 3) p.idleNext = elapsed + IDLE_MS;   /* 页面卡顿后不一次性猛扣 */
    }
  }

  /* ================= 团队闯关：60 秒到点，星门熄灭 ================= */
  function teamTimeout() {
    if (state !== 'play') return;
    state = 'timeout';
    teamBusy = true;                 // 停收题
    var hud = $('hudTime'); if (hud) hud.textContent = '0s';
    Sound.bad();
    var el = $('timeout'); if (el) el.classList.add('show');
  }

  function updateProgress(i) {
    var p = players[i];
    var badge = p.combo >= 2 ? ('🔥x' + p.combo) : (p.wrong > 0 ? ('✗' + p.wrong) : '');
    $('pb' + i).textContent = badge;

    if (cfg.mode === 'team') {
      $('pp' + i).textContent = p.eaten + ' 题';
      var mx = 1;
      for (var j = 0; j < players.length; j++) if (players[j].eaten > mx) mx = players[j].eaten;
      $('pbar' + i).style.width = (p.eaten / mx * 100) + '%';
    } else {
      $('pp' + i).textContent = p.eaten + '/' + cfg.buns;
      $('pbar' + i).style.width = (p.eaten / cfg.buns * 100) + '%';
    }
  }

  /* ================= 结算 ================= */
  function fmt(ms) {
    var s = ms / 1000;
    var m = Math.floor(s / 60);
    s = s - m * 60;
    return (m > 0 ? m + '分' : '') + s.toFixed(1) + '秒';
  }

  /* 排名比较：完成者在前 → 用时短者在前 → 吃得多者在前 → 答错少者在前
   * 返回 0 表示「成绩完全相同」，调用方据此判定并列。 */
  function cmpPlayers(a, b) {
    if (cfg.mode === 'team') {
      if (b.eaten !== a.eaten) return b.eaten - a.eaten;
      return a.wrong - b.wrong;
    }
    if (a.done !== b.done) return a.done ? -1 : 1;
    if (a.done) return a.finishMs - b.finishMs;
    if (b.eaten !== a.eaten) return b.eaten - a.eaten;
    return a.wrong - b.wrong;
  }

  function endGame() {
    if (state === 'over') return;
    state = 'over';
    Sound.win();
    Scene.confetti();

    var ranked = players.slice().sort(cmpPlayers);
    var i;

    /* 并列：找出和第一名成绩完全一样的人（没人答题时就是四人全并列） */
    var tops = [ranked[0]];
    for (i = 1; i < ranked.length; i++) {
      if (cmpPlayers(ranked[0], ranked[i]) === 0) tops.push(ranked[i]);
      else break;
    }
    var tied = tops.length > 1;

    /* 是否全场无人作答（既没答对也没答错） */
    var nobody = true;
    for (i = 0; i < players.length; i++) {
      if (players[i].eaten > 0 || players[i].wrong > 0) { nobody = false; break; }
    }

    var medals = ['🥇', '🥈', '🥉', '🏅'];
    var podCls = ['gold', 'silver', 'bronze', 'rest'];
    /* 名次（并列同名次）：按排序结果分档 */
    var rank = [0];
    for (i = 1; i < ranked.length; i++) {
      rank.push(cmpPlayers(ranked[i - 1], ranked[i]) === 0 ? rank[i - 1] : i);
    }

    var pod = $('podium');
    pod.innerHTML = '';
    pod.style.alignItems = '';
    pod.style.justifyContent = '';

    if (nobody) {
      // 全员 0 提交：不排领奖台，避免“躺着拿第一”
      pod.style.alignItems = 'center';
      pod.style.justifyContent = 'center';
      pod.innerHTML = '<div class="noAns">本局四位选手都没有提交答案 🫥<br>' +
        '<span>点「再来一局」重新开始吧！</span></div>';
    }

    for (i = 0; i < ranked.length && !nobody; i++) {
      var p = ranked[i];
      var d = document.createElement('div');
      d.className = 'pod ' + podCls[rank[i]];
      var stat;
      if (cfg.mode === 'race') stat = p.done ? ('用时 ' + fmt(p.finishMs)) : ('跑完 ' + p.eaten + '/' + cfg.buns);
      else if (cfg.mode === 'team') stat = '答对 ' + p.eaten + ' 题';
      else stat = p.done ? fmt(p.finishMs) : ('吃了 ' + p.eaten + ' 个');
      d.innerHTML =
        (rank[i] === 0 ? '<div class="crown">👑</div>' : '') +
        '<div class="rk">' + medals[rank[i]] + '</div>' +
        '<div class="who">' + p.name + '</div>' +
        '<div class="sc">' + (cfg.mode === 'team' ? stat : (p.eaten + ' ' + Scene.food() + ' · ' + stat)) +
        (p.bestCombo >= 2 ? ' · 最高连击 x' + p.bestCombo : '') + '</div>';
      pod.appendChild(d);
    }

    var rl = $('rankList');
    rl.innerHTML = '';
    for (i = 0; i < ranked.length; i++) {
      p = ranked[i];
      var row = document.createElement('div');
      row.className = 'rankRow';
      if (nobody) row.classList.add('dim');
      var acc = p.eaten + p.wrong > 0
        ? Math.round(p.eaten / (p.eaten + p.wrong) * 100) + '%'
        : '—';
      var extra = (p.bestCombo >= 2 ? ' · 最高连击 x' + p.bestCombo : '') +
        (p.fastest ? ' · 最快 ' + (p.fastest / 1000).toFixed(1) + ' 秒' : '');
      row.innerHTML =
        '<div class="no">No.' + (rank[i] + 1) + '</div>' +
        '<div class="nm">' + p.name + '</div>' +
        '<div class="st">' + (cfg.mode === 'team' ? '答对 ' + p.eaten + ' 题' : (Scene.food() + ' ' + p.eaten + '/' + cfg.buns)) +
        ' · 答错 ' + p.wrong + ' 次 · 正确率 ' + acc +
        (cfg.mode === 'team' ? '' : (p.done ? ' · 用时 ' + fmt(p.finishMs) : ' · 未完成')) +
        extra + '</div>';
      rl.appendChild(row);
    }

    var topNames = [];
    for (i = 0; i < tops.length; i++) topNames.push(tops[i].name);

    if (cfg.mode === 'team') {
      if (teamWon) $('resultTitle').textContent = '团结就是力量 · 星门已点亮！';
      else if (nobody) $('resultTitle').textContent = '本局无人作答 · 再接再厉！';
      else if (tied) $('resultTitle').textContent = topNames.join('、') + ' 贡献并列第一！';
      else $('resultTitle').textContent = ranked[0].name + ' 贡献最多！';
    } else {
      var verb = cfg.mode === 'race' ? '抢先冲线' : '大获全胜';
      if (nobody) $('resultTitle').textContent = '本局无人作答 · 再来一局吧！';
      else if (tied) $('resultTitle').textContent = topNames.join('、') + ' 并列第一！';
      else $('resultTitle').textContent = ranked[0].name + ' ' + verb + '！';
    }
    /* ---- 星尘结算 ----
       ① 热身赛通关（60 秒内星门充能到 100%）固定奖励 30 点星尘
       ② 失败（超时）不产星尘
       ③ 本局结束后仍不满 30 点 → 清零，换下一批学生从 0 开始攒               */
    var totalRight = 0;
    for (var k = 0; k < players.length; k++) totalRight += (players[k].eaten || 0);
    var earned = teamWon;
    var gain = earned ? 30 : 0;
    var st = addEnergy(gain, earned);
    renderEnergyResult(totalRight, gain, st.ed, earned, st.poolAfter, st.cleared);

    $('setup').classList.add('hidden');
    $('result').classList.remove('hidden');
    $('overlay').classList.remove('hidden');
  }

  /* ================= 主循环 ================= */
  var lastT = performance.now();
  var tickErr = 0;
  function loop(now) {
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1;

    try {
      // setup 也要画：设置页背后是当前模式/主题的实时预览
      if (state === 'play' || state === 'count' || state === 'over' || state === 'setup') {
        Scene.tick(Math.min(dt, 0.05));
      }
      if (state === 'play') {
        elapsed += dt * 1000;
        checkIdle();                       /* 谁 5 秒没答题，就漏 1.5% */
        if (cfg.mode === 'team' && !teamBusy && !teamWon && Scene.charge().disp >= 1) {
          checkTeamHp();                   /* 充能条真的满 100% 才判定胜利 */
        }
        if (cfg.mode === 'team') {
          /* 团队闯关：显示剩余秒数，到点星门熄灭 */
          var left = TEAM_TIME - elapsed / 1000;
          if (left < 0) left = 0;
          var ht = $('hudTime');
          ht.textContent = '剩 ' + Math.ceil(left) + 's';
          if (left <= 15) ht.classList.add('warn'); else ht.classList.remove('warn');
          if (left <= 0 && !teamBusy && !teamWon) teamTimeout();
        } else {
          $('hudTime').classList.remove('warn');
          $('hudTime').textContent = fmt(elapsed).replace('秒', 's').replace('分', 'm');
        }
      }
    } catch (err) {
      // 单帧异常不能把整场动画打死（否则画面冻结、血条再也不动）
      if (tickErr++ < 3 && window.console) console.error('Scene.tick 出错:', err);
    }
    requestAnimationFrame(loop);
  }

  /* ================= HUD 按钮 ================= */
  function bindHud() {
    bindTap($('btnSound'), function (e) {
      e.preventDefault();
      var m = Sound.toggleMute();
      $('btnSound').textContent = m ? '🔇' : '🔊';
    });
    bindTap($('btnPause'), function (e) {
      e.preventDefault();
      if (state === 'play') { state = 'pause'; $('btnPause').textContent = '▶'; }
      else if (state === 'pause') { state = 'play'; $('btnPause').textContent = '⏸'; }
    });
    bindTap($('btnHome'), function (e) {
      e.preventDefault();
      if (window.FS) FS.keepOnNav(); location.reload();
    });
    /* 星门熄灭的「重来一次」：直接刷新页面，方便下一批学生重新晨练 */
    var rt = $('btnRetry');
    if (rt) bindTap(rt, function (e) { e.preventDefault(); if (window.FS) FS.keepOnNav(); location.reload(); });
    /* 胜利黑屏的按钮：星尘够 → 进进阶版；不够 → 刷新重来 */
    var vg = $('btnVicGo');
    if (vg) bindTap(vg, function (e) {
      e.preventDefault();
      var ed = loadEnergy();
      if (ed.on && ed.pool < ed.need) { Sound.bad(); if (window.FS) FS.keepOnNav(); location.reload(); return; }
      Sound.ok();
      if (window.FS) FS.keepOnNav(); location.href = 'boss-battle.html';
    });
    bindTap($('btnAgain'), function (e) {
      e.preventDefault(); Sound.ok(); startGame();
    });
    /* 胜利黑屏：再玩一次 / 回星图首页 */
    if ($('btnVicAgain')) bindTap($('btnVicAgain'), function (e) {
      e.preventDefault(); Sound.ok(); startGame();
    });
    if ($('btnVicHome')) bindTap($('btnVicHome'), function (e) {
      e.preventDefault(); Sound.ok(); if (window.FS) FS.keepOnNav(); location.href = 'index.html';
    });
    /* 超时黑屏：回星图首页 */
    if ($('btnToHome')) bindTap($('btnToHome'), function (e) {
      e.preventDefault(); Sound.ok(); if (window.FS) FS.keepOnNav(); location.href = 'index.html';
    });
    bindTap($('btnBack'), function (e) {
      e.preventDefault();
      $('result').classList.add('hidden');
      $('setup').classList.remove('hidden');
      state = 'setup';
    });
    /* 去进阶版闯关：星尘在 boss-battle.html 开战时才扣除 */
    bindTap($('btnBoss'), function (e) {
      e.preventDefault();
      var ed = loadEnergy();
      if (ed.on && ed.pool < ed.need) { Sound.bad(); return; }
      Sound.ok();
      if (window.FS) FS.keepOnNav(); location.href = 'boss-battle.html';
    });

    // 桌面测试用：物理键盘映射到 1 号玩家
    window.addEventListener('keydown', function (ev) {
      if (state !== 'play') return;
      var k = ev.key;
      if (k >= '0' && k <= '9') onKey(0, k);
      else if (k === 'Backspace') onKey(0, 'del');
      else if (k === 'Enter') onKey(0, 'ok');
      else if (k === 'Escape') onKey(0, 'clr');
      else if (k === 'a' || k === 'A') submitOpt(0, 0);
      else if (k === 'b' || k === 'B') submitOpt(0, 1);
      else if (k === 'c' || k === 'C') submitOpt(0, 2);
      else if (k === 'd' || k === 'D') submitOpt(0, 3);
    });

    // 首次交互解锁音频
    bindTap(document, function unlock() {
      Sound.click();
      document.removeEventListener('pointerdown', unlock);
    });

    // 课堂加固：禁用右键菜单 / 长按选择 / 拖拽选中 / 意外拖拽
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('selectstart', function (e) {
      if (e.target && e.target.tagName !== 'INPUT') e.preventDefault();
    });
    document.addEventListener('dragstart', function (e) { e.preventDefault(); });
  }

  /* ================= 启动 ================= */
  Scene.init($('scene'));
  buildSetup();
  bindPanels();
  bindHud();
  fit();

  // 兼容性提示：老内核（无 Pointer Events）会走降级方案，多点可能受限
  if (!HAS_POINTER) {
    var tipEl = document.querySelector('#setup .tip');
    if (tipEl) {
      tipEl.innerHTML = '⚠ 当前浏览器内核较老，已自动切换兼容模式（多点触控可能受影响）。' +
        '建议改用 Chrome / Edge 或把 360 浏览器切到「极速模式」。';
      tipEl.style.color = '#a3340f';
    }
  }

  // 初始主题（默认：森林 + 熊出没四人组）
  Scene.setTheme(cfg.theme);
  applyTheme(cfg.theme);

  // 加载 images/ 目录下的角色贴图
  Scene.loadDefaultImages(function () {
    showDemo();
  });

  requestAnimationFrame(loop);
})();
