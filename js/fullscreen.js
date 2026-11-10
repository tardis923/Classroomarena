/* ============================================================
 * fullscreen.js —— 全屏切换 + 跨页面续接
 *
 * 一体机上只用页面顶部的同一个按钮切换「进入全屏 / 退出全屏」，
 * 不再额外弹出右下角悬浮按钮。
 *
 * 浏览器的 requestFullscreen() 绑定在当前 document 上，跨文档导航
 * （location.href 跳转）时会自动退出全屏，新页面也不能直接自动请求
 * 全屏（缺少用户手势）。所以：
 *   1) 跳转前若正处于全屏，写 localStorage 标记；
 *   2) 新页面加载后，等用户第一次点击（手势）时自动请求全屏，然后清标记。
 * 首页内嵌的管理帧没有导航，首页全屏时帧内按钮通过 postMessage
 * 让父文档代为切换。
 * ============================================================ */
(function () {
  var KEY = 'arena_fs_keep_v1';

  function fsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
           document.webkitCurrentFullScreenElement || document.msFullscreenElement || null;
  }
  function isOn() { return !!fsEl(); }
  /* 管理帧在 iframe 内，全屏元素属于父文档；父全屏时帧内按「全屏中」显示 */
  function showAsFull() { return isOn() || window.parent !== window; }

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
      if (p && p.catch) p.catch(function () { });
    } catch (e) { }
  }
  function toggleLocal() { if (isOn()) exit(); else enter(); }

  /* 在 iframe（管理帧）内点按钮时，请父文档代为切换 */
  function toggle() {
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'fsToggle' }, '*'); } catch (e) { }
      return;
    }
    toggleLocal();
  }

  /* 跳转前调用：当前全屏才写标记，避免非全屏跳转后被强行拉进全屏 */
  function keepOnNav() {
    try {
      if (isOn()) localStorage.setItem(KEY, String(Date.now()));
      else localStorage.removeItem(KEY);
    } catch (e) { }
  }

  /* 绑定页面顶部的全屏按钮：一个按钮兼顾进入与退出，文字随状态变化 */
  function bindButton(id, fullText, normalText) {
    var b = document.getElementById(id);
    if (!b) return;
    function sync() { b.textContent = showAsFull() ? fullText : normalText; }
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (window.FS && window.FS.toggle) window.FS.toggle(); else toggle();
      sync();
    });
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
  }

  /* 新页面：等第一次用户手势再进入全屏 */
  function resume() {
    var flag = null;
    try { flag = localStorage.getItem(KEY); } catch (e) { }
    /* 标记带时间戳，30 秒后自动作废：跳转后没点就离开页面，
       下次打开不该在第一次点击时突然被拉进全屏 */
    var stamp = parseInt(flag, 10);
    if (!stamp || Date.now() - stamp > 30000) {
      try { localStorage.removeItem(KEY); } catch (e) { }
      return;
    }
    var done = false;
    function once(e) {
      /* 点全屏按钮时不要自动续接，否则会「刚进入又被按钮退出」 */
      var t = e && e.target;
      if (t && t.closest && t.closest('#btnFsHome,#btnFs,#btnFsWarm')) return;
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

  /* 父文档响应管理帧的切换请求 */
  if (window.parent === window) {
    window.addEventListener('message', function (e) {
      if (!e.data || !window.FS) return;
      if (e.data.type === 'fsToggle') toggleLocal();
      else if (e.data.type === 'fsExit') exit();   /* 兼容旧消息 */
    });
  }

  window.FS = {
    isOn: isOn, enter: enter, exit: exit, toggle: toggle,
    keepOnNav: keepOnNav, bindButton: bindButton
  };
  resume();
})();
