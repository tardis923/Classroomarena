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

  var state = 'setup';           // setup | count | play | pause | over
  var cfg = { buns: 10, level: 0, theme: 'forest', mode: 'eat', names: [] };
  var players = [];
  var startMs = 0, pausedMs = 0, elapsed = 0;

  /* 团队闯关：3 关，每关需要全队答对 buns × 4 题
   * 用「本关已答对题数」计数，血量只是它的显示形式，
   * 这样过场动画期间打出的伤害也不会丢。 */
  var TEAM_MAX_LEVEL = 3;
  var teamDone = 0, teamLevel = 1, teamWon = false, teamBusy = false;
  function teamNeed() { return cfg.buns * 4; }
  function teamInfoText() {
    return '第 ' + teamLevel + ' 关 · ' + Scene.bossName() +
      ' · 还差 ' + Math.max(0, teamNeed() - teamDone) + ' 题';
  }
  /* 赛道竞速：是否已有人冲线 */
  var raceFirst = false;

  /* ---------------- 三种玩法 ---------------- */
  var MODES = [
    { id: 'eat', name: '吃食物大赛', desc: '答对就开吃，先吃完者获胜' },
    { id: 'race', name: '赛道竞速', desc: '答对向前冲，先到终点者获胜' },
    { id: 'team', name: '团队闯关', desc: '四人合力打倒大魔王，共 ' + TEAM_MAX_LEVEL + ' 关 · 唯一能攒班级魔力的模式' }
  ];

  var TIPS = {
    eat: '提示：答错不会失去食物，但会换新题并浪费时间 —— 抢答要准！',
    race: '提示：答对立刻冲出一段，答错原地打滑 —— 又快又准才能夺冠！',
    team: '提示：四个人的题目全班都能看到，可以一起算！答对一题扣魔王一点血。' +
      '只有本模式攒魔力：基础题 0.5 点/题，提高题 1 点/题；攒够 30 点才能去打进阶版。'
  };

  var BUN_LABEL = {
    eat: '食物数量（每人题数）',
    race: '赛道长度（每人题数）',
    team: '关卡血量（每人每关题数）'
  };

  /* 标题统一为「四人争霸赛」：不含学科词，以后加语文知识竞赛也不用改 */
  var GAME_TITLE = '四人争霸赛';
  var ROSTER = {
    forest: '熊大、熊二、光头强、蹦蹦',
    tavern: '四位壮士'
  };
  /* 副标题按 主题（角色 + 食物）× 模式 自动生成，同样不含学科词 */
  var SUBS = {
    eat: function (f, r) { return r + '同场竞技：答对题目，角色吃掉一个' + f + '。先吃完全部' + f + '者获胜！'; },
    race: function (f, r) { return r + '各驾一辆卡丁车：答对一题就向前冲一段，先冲过终点线者获胜！'; },
    team: function (f, r) { return r + '并肩作战：答对的题目变成' + f + '炮弹砸向大魔王，打完 ' + TEAM_MAX_LEVEL + ' 关即团队胜利！'; }
  };

  /* 刷新设置页标题与副标题 */
  function applyTitle() {
    var h1 = document.querySelector('#setup h1');
    var sub = document.querySelector('#setup .sub');
    if (h1) h1.textContent = GAME_TITLE;
    if (sub) sub.textContent = (SUBS[cfg.mode] || SUBS.eat)(Scene.food(), ROSTER[cfg.theme] || ROSTER.forest);
  }

  /* ================= 魔力池（与 boss-battle.html 共享） =================
     pool = 班级攒的魔力；need = 挑战大魔王要几张点；on = 门槛开关
     本游戏只负责「产出魔力」，消耗由 boss-battle.html 开战时扣。      */
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
  /* 魔力点数可能是 0.5 的小数：3 显示成「3」，3.5 显示成「3.5」 */
  function eNum(x) {
    var v = Math.round(x * 10) / 10;
    return (v === Math.floor(v)) ? String(Math.floor(v)) : v.toFixed(1);
  }
  /* earned: 本局是否产魔力（只有团队闯关产）  poolAfter: 清零前算出来的池子  cleared: 是否已清零 */
  function renderEnergyResult(totalRight, gain, ed, earned, poolAfter, cleared) {
    var eb = $('energyBox');
    if (eb) {
      var per = QGen.energyPer(cfg.level);
      var html = '';
      if (!earned) {
        html += '<div class="eGain">本局四人共答对 ' + totalRight + ' 题 · <b>本模式不产魔力</b></div>';
        html += '<div class="ePool eTip2">只有「<b>团队闯关</b>」能攒魔力，想挑战大魔王请切到该模式再玩一局。</div>';
      } else {
        html += '<div class="eGain">本局四人共答对 ' + totalRight + ' 题（' +
          QGen.LEVELS[cfg.level].name + '题 ' + eNum(per) + ' 点/题）　→　获得 <b>+' + eNum(gain) + '</b> 点魔力</div>';
        if (!ed.on) {
          html += '<div class="ePool">魔力门槛已由老师关闭，可随时挑战大魔王</div>';
        } else if (cleared) {
          html += '<div class="ePool">本局攒到 <b>' + eNum(poolAfter) + '</b> / ' + ed.need +
            ' 点，<span class="eNo">没攒够 ' + ed.need + ' 点，魔力已清零</span></div>';
          html += '<div class="ePool" style="font-size:19px">换下一批学生上台，从 0 点重新开始攒。</div>';
        } else {
          html += '<div class="ePool">班级魔力池：<b>' + eNum(ed.pool) + '</b> / ' + ed.need + ' 点' +
            '<span class="eOk">魔力充足，可以去挑战大魔王！</span></div>';
        }
      }
      eb.innerHTML = html;
    }
    var bb = $('btnBoss');
    if (bb) {
      var can = !ed.on || ed.pool >= ed.need;
      if (can) { bb.classList.remove('locked'); bb.textContent = '挑 战 大 魔 王 →'; }
      else { bb.classList.add('locked'); bb.textContent = '魔 力 不 足 ' + eNum(ed.pool) + '/' + ed.need; }
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
  window.addEventListener('resize', fit);

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
  function buildSetup() {
    // 游戏模式
    var mdBox = $('optMode');
    MODES.forEach(function (md) {
      var b = document.createElement('button');
      b.className = 'opt optCard' + (md.id === cfg.mode ? ' on' : '');
      b.innerHTML = md.name + '<span class="small">' + md.desc + '</span>';
      bindTap(b, function (e) {
        e.preventDefault(); cfg.mode = md.id; Sound.click();
        var bs = mdBox.querySelectorAll('.opt');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('on');
        b.classList.add('on');
        applyMode();
      });
      mdBox.appendChild(b);
    });

    var bunBox = $('optBuns');
    var bunOpts = [5, 10, 15, 20];
    bunOpts.forEach(function (n) {
      var b = document.createElement('button');
      b.className = 'opt' + (n === cfg.buns ? ' on' : '');
      b.innerHTML = n + ' 个';
      bindTap(b, function (e) {
        e.preventDefault(); cfg.buns = n; Sound.click();
        var bs = bunBox.querySelectorAll('.opt');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('on');
        b.classList.add('on');
      });
      bunBox.appendChild(b);
    });

    var lvBox = $('optLevel');
    QGen.LEVELS.forEach(function (lv) {
      var b = document.createElement('button');
      b.className = 'opt' + (lv.id === cfg.level ? ' on' : '');
      b.innerHTML = lv.name + '<span class="small">' + lv.desc + '</span>';
      bindTap(b, function (e) {
        e.preventDefault(); cfg.level = lv.id; Sound.click();
        var bs = lvBox.querySelectorAll('.opt');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('on');
        b.classList.add('on');
      });
      lvBox.appendChild(b);
    });

    // 场景 / 角色主题
    var thBox = $('optTheme');
    var TH_LIST = [
      { id: 'forest', name: '森林大赛', desc: '苹果 · 树桩长桌', roles: '熊大 / 熊二 / 光头强 / 蹦蹦' },
      { id: 'tavern', name: '包子擂台', desc: '包子 · 中式酒楼', roles: '红袍 / 蓝袍 / 绿袍 / 黄袍壮士' }
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


  /* 切换玩法：更新提示文案、数量标签、背景预览 */
  function applyMode() {
    var tipEl = document.querySelector('#setup .tip');
    if (tipEl && state === 'setup') tipEl.textContent = TIPS[cfg.mode] || TIPS.eat;
    var lb = $('lbBun');
    if (lb) {
      lb.innerHTML = (BUN_LABEL[cfg.mode] || BUN_LABEL.eat)
        .replace('食物', '<span id="lbFood">' + Scene.food() + '</span>');
    }
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
    if (cfg.mode === 'team') Scene.teamLevel(1, '第 1 关 · ' + Scene.bossName());
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
    for (var i = 0; i < 4; i++) {
      var col = Scene.skins()[i];
      var d = document.createElement('div');
      d.className = 'pcol';
      d.dataset.i = i;
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
        '<span class="qeq" style="color:' + col.dark + '">=</span>' +
        '<span class="qbox" id="qb' + i + '" style="border-color:' + col.main + ';color:' + col.dark + '"></span>' +
        '</div>' +
        '<div class="pkeys">' + KEY_HTML + '</div>';
      box.appendChild(d);
    }
  }

  /* 多点触控：事件委托只绑一次
   * （如果放在 buildPanels 里，每开一局就会多一层监听，
   *   一次点击会触发两遍，输入变成 11、55…… 永远答错） */
  function bindPanels() {
    var box = $('panels');
    bindTap(box, function (e) {
      var btn = e.target;
      while (btn && btn !== box && !(btn.classList && btn.classList.contains('kbtn'))) btn = btn.parentNode;
      if (!btn || btn === box) return;
      e.preventDefault();
      var colEl = btn.closest ? btn.closest('.pcol') : null;
      var idx = colEl ? +colEl.dataset.i : +btn.getAttribute('data-i');
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
    $('btnPause').textContent = '⏸';
    elapsed = 0;

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

  /* 算式较长时自动缩小字号，保证答案框不溢出 */
  function setQuestion(i, text) {
    var el = $('qt' + i);
    el.textContent = text;
    var len = text.length;
    el.style.fontSize = len > 13 ? '30px' : (len > 10 ? '35px' : '43px');
  }

  function newQuestion(i) {
    var p = players[i];
    p.q = QGen.next(cfg.level);
    p.input = '';
    p.busy = false;
    p.qStart = elapsed;
    setQuestion(i, p.q.text);
    $('qb' + i).textContent = '';
    $('pq' + i).classList.remove('done');
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
    var p = players[i];
    if (p.done || p.busy || !p.q) return;

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
        /* 团队闯关：把手里的食物当炮弹扔向大魔王 */
        p.eaten++;
        if (Scene.char(i)) Scene.char(i).teamScore(p.eaten);
        teamDone++;
        Scene.bossHit(i, Math.max(0, 1 - teamDone / teamNeed()), teamInfoText());
        updateProgress(i);
        checkTeamHp();                         // 本关打空：过关 / 通关
        if (state === 'play') newQuestion(i); // 节奏不断，马上出新题
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

    // 换一题（食物/进度不丢，只是浪费了时间）
    p.q = QGen.next(cfg.level);
    setQuestion(i, p.q.text);
    p.input = '';

    setTimeout(function () {
      var e3 = $('qb' + i);
      e3.classList.remove('bad'); e3.classList.remove('hint');
      if (players[i] && players[i].input === '') e3.textContent = '';
    }, 950);

    updateProgress(i);
  }

  /* 血量已被打空 —— 保证一定触发过关（过场动画结束后会再查一次） */
  function checkTeamHp() {
    if (teamDone < teamNeed() || teamBusy) return;
    teamLevelClear();
  }

  /* 过关：撒彩带 + 横幅 + 换下一关魔王 */
  function teamLevelClear() {
    if (teamBusy) return;
    teamBusy = true;
    Scene.bossDefeat();
    Sound.win();
    Scene.confetti();

    if (teamLevel >= TEAM_MAX_LEVEL) {
      teamWon = true;
      Scene.banner('全部通关 · 团队胜利！', '#7ce07c');
      setTimeout(endGame, 2200);
      return;
    }
    Scene.banner('第 ' + teamLevel + ' 关 · 通关！', '#ffe14b');
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
        '<div class="sc">' + p.eaten + ' ' + Scene.food() + ' · ' + stat +
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
        '<div class="st">' + Scene.food() + ' ' + p.eaten +
        (cfg.mode === 'team' ? ' 题' : '/' + cfg.buns) +
        ' · 答错 ' + p.wrong + ' 次 · 正确率 ' + acc +
        (cfg.mode === 'team' ? '' : (p.done ? ' · 用时 ' + fmt(p.finishMs) : ' · 未完成')) +
        extra + '</div>';
      rl.appendChild(row);
    }

    var topNames = [];
    for (i = 0; i < tops.length; i++) topNames.push(tops[i].name);

    if (cfg.mode === 'team') {
      if (teamWon) $('resultTitle').textContent = '团结就是力量 · ' + TEAM_MAX_LEVEL + ' 关全通！';
      else if (nobody) $('resultTitle').textContent = '本局无人作答 · 再接再厉！';
      else if (tied) $('resultTitle').textContent = topNames.join('、') + ' 贡献并列第一！';
      else $('resultTitle').textContent = '第 ' + teamLevel + ' 关 · ' + ranked[0].name + ' 贡献最多！';
    } else {
      var verb = cfg.mode === 'race' ? '抢先冲线' : '大获全胜';
      if (nobody) $('resultTitle').textContent = '本局无人作答 · 再来一局吧！';
      else if (tied) $('resultTitle').textContent = topNames.join('、') + ' 并列第一！';
      else $('resultTitle').textContent = ranked[0].name + ' ' + verb + '！';
    }
    /* ---- 魔力结算 ----
       ① 只有「团队闯关」产魔力（进阶版同样是团队合力打魔王）
       ② 基础题 0.5 点/题，提高题 1 点/题，不设单局上限；开局就点「提前结算」只能拿 0 点
       ③ 本局结束后仍不满 30 点 → 清零，换下一批学生从 0 开始攒               */
    var totalRight = 0;
    for (var k = 0; k < players.length; k++) totalRight += (players[k].eaten || 0);
    var ed = loadEnergy();
    var earned = (cfg.mode === 'team');
    var gain = earned ? totalRight * QGen.energyPer(cfg.level) : 0;
    if (gain > 0) ed.pool = Math.round((ed.pool + gain) * 10) / 10;
    var poolAfter = ed.pool;
    var cleared = false;
    if (earned && ed.on && ed.pool < ed.need) { ed.pool = 0; cleared = true; }
    saveEnergy(ed);
    renderEnergyResult(totalRight, gain, ed, earned, poolAfter, cleared);

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
        $('hudTime').textContent = fmt(elapsed).replace('秒', 's').replace('分', 'm');
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
    bindTap($('btnFinish'), function (e) {
      e.preventDefault();
      if (state === 'play' || state === 'pause') endGame();
    });
    bindTap($('btnHome'), function (e) {
      e.preventDefault();
      location.reload();
    });
    bindTap($('btnAgain'), function (e) {
      e.preventDefault(); Sound.ok(); startGame();
    });
    bindTap($('btnBack'), function (e) {
      e.preventDefault();
      $('result').classList.add('hidden');
      $('setup').classList.remove('hidden');
      state = 'setup';
    });
    /* 去进阶版闯关：魔力在 boss-battle.html 开战时才扣除 */
    bindTap($('btnBoss'), function (e) {
      e.preventDefault();
      var ed = loadEnergy();
      if (ed.on && ed.pool < ed.need) { Sound.bad(); return; }
      Sound.ok();
      location.href = 'boss-battle.html';
    });

    // 桌面测试用：物理键盘映射到 1 号玩家
    window.addEventListener('keydown', function (ev) {
      if (state !== 'play') return;
      var k = ev.key;
      if (k >= '0' && k <= '9') onKey(0, k);
      else if (k === 'Backspace') onKey(0, 'del');
      else if (k === 'Enter') onKey(0, 'ok');
      else if (k === 'Escape') onKey(0, 'clr');
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
