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
      if (x) x.call(document);
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
    function once() {
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

  window.FS = { isOn: isOn, enter: enter, exit: exit, toggle: toggle, keepOnNav: keepOnNav };
  resume();
})();
