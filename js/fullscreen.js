/* ============================================================
 * fullscreen.js —— 全屏按钮 + 跨页面续接
 *
 * 浏览器的 requestFullscreen() 绑定在当前 document 上，跨文档导航
 * （location.href 跳转）时会自动退出全屏，而且新页面不能直接
 * 自动请求全屏（没有用户手势）。所以：
 *   1) 跳转前若正处于全屏，写 localStorage 标记；
 *   2) 新页面加载后，等用户第一次点击（手势）时自动请求全屏，
 *      然后清掉标记。
 * 这样首页全屏 → 点进热身赛 / 关卡挑战，点一下就又是全屏。
 * 首页内嵌的管理帧没有导航，首页全屏时它自然仍是全屏。
 * ============================================================ */
(function () {
  var KEY = 'arena_fs_keep_v1';

  function fsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
           document.webkitCurrentFullScreenElement || document.msFullscreenElement || null;
  }
  function isOn() { return !!fsEl(); }

  function enter() {
    try {
      var el = document.documentElement;
      var r = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (!r) return false;
      var p = r.call(el);
      if (p && p.catch) p.catch(function () { });
      return true;
    } catch (e) { return false; }
  }
  function exit() {
    try {
      var x = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (!x) return;
      var p = x.call(document);
      /* exitFullscreen 返回 Promise，非活动文档会 reject，必须接住 */
      if (p && p.catch) p.catch(function () { });
    } catch (e) { }
  }
  function toggle() { if (isOn()) exit(); else enter(); }

  /* 跳转前调用：当前全屏才写标记，避免非全屏跳转后被强行拉进全屏 */
  function keepOnNav() {
    try {
      if (isOn()) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch (e) { }
  }

  /* 新页面：等第一次用户手势再进入全屏 */
  function resume() {
    var flag = null;
    try { flag = localStorage.getItem(KEY); } catch (e) { }
    if (flag !== '1') return;
    var done = false;
    function once(e) {
      /* 点全屏/退出按钮时不要自动续接，否则会「刚进入又被按钮退出」 */
      var t = e && e.target;
      if (t && t.closest && t.closest('#fsExitBtn,#btnFsHome,#btnFs')) return;
      if (done) return;
      done = true;
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('keydown', once, true);
      try { localStorage.removeItem(KEY); } catch (e) { }
      if (!isOn()) enter();
    }
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('keydown', once, true);
  }

  /* ------------------------------------------------------------
     常驻「退出全屏」按钮：一体机没有键盘，按不了 Esc。
     - 全屏时才出现（醒目橙色，右下角悬浮），点一下就退出
     - 首页内嵌的管理帧里，全屏元素是父文档、自己的 isOn() 为假，
       所以帧内也常驻显示，点击通过 postMessage 让父页面退出
     ------------------------------------------------------------ */
  function syncExitBtn() {
    var b = document.getElementById('fsExitBtn');
    if (!b || !document.body) return;
    /* 管理帧里全屏元素是父文档，自己的 isOn() 为假，按「全屏中」处理 */
    var full = isOn() || window.parent !== window;
    /* 已有自带全屏按钮的页面（首页 / 关卡挑战）：只在全屏时显示退出入口；
       没有的（热身赛）：常驻显示，兼顾进入与退出，完全不依赖键盘 */
    var hasOwn = !!(document.getElementById('btnFsHome') || document.getElementById('btnFs'));
    b.style.display = (full || !hasOwn) ? 'block' : 'none';
    b.textContent = full ? '✕ 退 出 全 屏' : '⛶ 全 屏';
    b.classList.toggle('enter', !full);
  }
  function buildExitBtn() {
    if (!document.body || document.getElementById('fsExitBtn')) return;
    var css = document.createElement('style'); css.id = 'fsExitCss';
    css.textContent = [
      '#fsExitBtn{position:fixed;right:24px;bottom:70px;z-index:10000;display:none;',
      'font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:21px;font-weight:700;',
      'letter-spacing:2px;color:#fff;padding:14px 26px;border-radius:16px;cursor:pointer;',
      'background:linear-gradient(#ff9a63,#d9482a);border:2px solid rgba(255,225,195,.8);',
      'box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 0 4px rgba(255,120,80,.2);}',
      '#fsExitBtn.enter{font-size:19px;padding:11px 22px;color:#cfc2f5;',
      'background:rgba(40,30,80,.8);border-color:rgba(190,170,255,.4);',
      'box-shadow:0 6px 22px rgba(0,0,0,.35);}',
      '#fsExitBtn:active{transform:translateY(2px);}'
    ].join('');
    document.head.appendChild(css);

    var b = document.createElement('button');
    b.id = 'fsExitBtn'; b.type = 'button'; b.textContent = '✕ 退 出 全 屏';
    b.title = '一体机触屏切换全屏（无需键盘 Esc）';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isOn() || window.parent !== window) {
        if (isOn() && window.FS) window.FS.exit();
        /* 在管理帧内：父文档才是全屏元素，请父页面代为退出 */
        if (window.parent !== window) {
          try { window.parent.postMessage({ type: 'fsExit' }, '*'); } catch (err) { }
        }
      } else if (window.FS) {
        window.FS.enter();
      }
    });
    document.body.appendChild(b);
    syncExitBtn();
  }
  document.addEventListener('fullscreenchange', syncExitBtn);
  document.addEventListener('webkitfullscreenchange', syncExitBtn);
  if (window.parent === window) {
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'fsExit' && window.FS) window.FS.exit();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildExitBtn);
  else buildExitBtn();

  window.FS = { isOn: isOn, enter: enter, exit: exit, toggle: toggle, keepOnNav: keepOnNav };
  resume();
})();
