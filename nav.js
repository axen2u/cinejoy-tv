/*
 * Cinejoy TV remote navigation.
 * Injected into https://cinejoy.pk by TizenBrew on Samsung (Tizen) TVs.
 * Arrow keys move a green focus box, OK clicks, Back goes back,
 * media keys control <video>. Written in ES5 so older Tizen (2017+) runs it.
 */
(function () {
  if (window.__cinejoyTvNav) return;
  window.__cinejoyTvNav = true;

  var SEL = 'a[href],button,input,select,textarea,summary,iframe,video,' +
    '[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],' +
    '[tabindex]:not([tabindex="-1"]),[onclick]';

  var K = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27,
    PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412
  };
  var DIRS = {}; DIRS[K.LEFT] = 'left'; DIRS[K.RIGHT] = 'right'; DIRS[K.UP] = 'up'; DIRS[K.DOWN] = 'down';

  var current = null;

  // Register remote keys (TizenBrew also does this from package.json "keys").
  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind']
      .forEach(function (k) { window.tizen.tvinputdevice.registerKey(k); });
  } catch (e) {}

  // ---- focus ring (an overlay, so it is never clipped by overflow:hidden) ----
  var ring = document.createElement('div');
  ring.id = 'cj-tv-ring';
  ring.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;display:none;' +
    'border:4px solid #95ff50;border-radius:10px;' +
    'box-shadow:0 0 0 3px rgba(0,0,0,.65),0 0 28px rgba(149,255,80,.75);' +
    'transition:left .1s,top .1s,width .1s,height .1s;';

  function updateRing() {
    if (!ring.parentNode && document.body) document.body.appendChild(ring);
    if (!current || !document.contains(current) || playerVideo()) { ring.style.display = 'none'; return; }
    var r = current.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.left = (r.left - 6) + 'px';
    ring.style.top = (r.top - 6) + 'px';
    ring.style.width = (r.width + 4) + 'px';
    ring.style.height = (r.height + 4) + 'px';
  }
  (function loop() { updateRing(); window.requestAnimationFrame(loop); })();

  // ---- candidates ----
  function inScroller(el) {
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  }

  function usable(el) {
    if (el === ring || el.disabled) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    // Off to the side (e.g. a closed slide-out menu) unless it sits in a scrollable row.
    if ((r.right <= 0 || r.left >= window.innerWidth) && !inScroller(el)) return false;
    return true;
  }

  // Floating UI (the bottom menu bar, "scroll to top" button) is position:fixed.
  function isFixed(el) {
    for (var p = el; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).position === 'fixed') return true;
    }
    return false;
  }

  function candidates() {
    var all = document.querySelectorAll(SEL), out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // Skip things nested inside a real link/button (e.g. an icon inside a movie card).
      if (el.parentElement && el.parentElement.closest('a[href],button')) continue;
      // Skip generic clickable wrappers (e.g. the hero banner) that hold their own
      // buttons, so the inner Play / + / info buttons are reachable instead.
      if (!/^(A|BUTTON|INPUT|SELECT|TEXTAREA|IFRAME|VIDEO)$/.test(el.tagName) && el.querySelector(SEL)) continue;
      if (usable(el)) { el.__cjFixed = isFixed(el); out.push(el); }
    }
    return out;
  }

  function sameLayer(list, fixed) {
    return list.filter(function (el) { return el.__cjFixed === fixed; });
  }

  function firstInView(list) {
    var best = null, bestY = Infinity, bestX = Infinity;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue;
      if (r.top < bestY - 5 || (Math.abs(r.top - bestY) <= 5 && r.left < bestX)) {
        best = list[i]; bestY = r.top; bestX = r.left;
      }
    }
    return best || list[0] || null;
  }

  // First item of the lowest floating row (the bottom menu bar's "Home").
  function menuStart(list) {
    var best = null, bestY = -Infinity, bestX = Infinity;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.top > bestY + 5 || (Math.abs(r.top - bestY) <= 5 && r.left < bestX)) {
        best = list[i]; bestY = r.top; bestX = r.left;
      }
    }
    return best;
  }

  // ---- spatial navigation ----
  function gap(a1, a2, b1, b2) { return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2)); }

  function findNext(dir, list) {
    var c = current.getBoundingClientRect();
    var cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === current || el.contains(current) || current.contains(el)) continue;
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var primary, ortho, drift;
      if (dir === 'right') { if (x <= cx + 2) continue; primary = r.left - c.right; ortho = gap(r.top, r.bottom, c.top, c.bottom); drift = Math.abs(y - cy); }
      else if (dir === 'left') { if (x >= cx - 2) continue; primary = c.left - r.right; ortho = gap(r.top, r.bottom, c.top, c.bottom); drift = Math.abs(y - cy); }
      else if (dir === 'down') { if (y <= cy + 2) continue; primary = r.top - c.bottom; ortho = gap(r.left, r.right, c.left, c.right); drift = Math.abs(x - cx); }
      else { if (y >= cy - 2) continue; primary = c.top - r.bottom; ortho = gap(r.left, r.right, c.left, c.right); drift = Math.abs(x - cx); }
      var score = Math.max(0, primary) + ortho * 3 + drift * 0.15;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function fire(el, type) {
    try {
      var r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: type !== 'mouseenter' && type !== 'mouseleave', cancelable: true, view: window,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
      }));
    } catch (e) {}
  }

  function isField(el) {
    return el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }

  function focusEl(el) {
    if (!el) return;
    if (current && current !== el) { fire(current, 'mouseout'); fire(current, 'mouseleave'); }
    if (isField(document.activeElement)) document.activeElement.blur();
    current = el;
    // Don't focus text fields until OK is pressed, so the TV keyboard doesn't pop up.
    if (!isField(el)) { try { el.focus({ preventScroll: true }); } catch (e) {} }
    fire(el, 'mouseover'); fire(el, 'mouseenter');
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
    catch (e) { el.scrollIntoView(false); }
  }

  function move(dir) {
    var list = candidates();
    if (!current || !document.contains(current) || !usable(current)) {
      focusEl(firstInView(sameLayer(list, false)) || firstInView(list));
      return;
    }
    // Prefer page content over floating buttons (menu bar, "scroll to top").
    // Left/right inside the menu bar stay in the menu bar.
    var stayInMenu = isFixed(current) && (dir === 'left' || dir === 'right');
    var next = findNext(dir, sameLayer(list, stayInMenu));
    if (!next) next = findNext(dir, list);
    if (next) focusEl(next);
    else if (dir === 'down' || dir === 'up') window.scrollBy(0, (dir === 'down' ? 1 : -1) * window.innerHeight * 0.6);
  }

  // ---- actions ----
  function activate() {
    if (!current) { move('down'); return; }
    if (isField(current)) { current.focus(); return; }
    if (current.tagName === 'IFRAME') {
      // Video players are usually in another site's iframe: hand the remote to it.
      try { current.focus(); } catch (e) {}
      var fs = current.requestFullscreen || current.webkitRequestFullscreen;
      if (fs) { try { fs.call(current); } catch (e) {} }
      return;
    }
    if (current.tagName === 'VIDEO') { togglePlay(current); return; }
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (t) { fire(current, t); });
    current.click();
  }

  function fullscreenEl() { return document.fullscreenElement || document.webkitFullscreenElement; }

  function back() {
    if (isField(document.activeElement)) { document.activeElement.blur(); return; }
    if (fullscreenEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (location.pathname !== '/' || location.search || location.hash) { history.back(); return; }
    // On the home page: first Back jumps to the floating menu bar, second Back exits.
    if (!current || !isFixed(current)) {
      var menu = menuStart(sameLayer(candidates(), true));
      if (menu) { focusEl(menu); return; }
    }
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }

  function video() {
    if (current && current.tagName === 'VIDEO') return current;
    var v = document.querySelectorAll('video');
    for (var i = 0; i < v.length; i++) if (usable(v[i])) return v[i];
    return v[0] || null;
  }
  function togglePlay(v) { if (v) { if (v.paused) v.play(); else v.pause(); osd(v); } }

  // ---- player mode (watch page: a big <video> fills the screen) ----
  // cinejoy's own player only draws its buttons on mouse movement, so the
  // remote drives the <video> directly and we show our own small status bar.
  function playerVideo() {
    var v = document.querySelectorAll('video');
    for (var i = 0; i < v.length; i++) {
      var r = v[i].getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.6 && r.height >= window.innerHeight * 0.5) return v[i];
    }
    return null;
  }

  var osdBox = document.createElement('div');
  osdBox.style.cssText = 'position:fixed;left:50%;bottom:24%;transform:translateX(-50%);z-index:2147483647;' +
    'pointer-events:none;padding:14px 28px;border-radius:14px;background:rgba(0,0,0,.75);color:#fff;' +
    'font:600 28px/1.2 system-ui,sans-serif;white-space:nowrap;transition:opacity .3s;opacity:0;';
  var osdTimer = null;
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function osd(v) {
    if (!osdBox.parentNode && document.body) document.body.appendChild(osdBox);
    osdBox.textContent = (v.paused ? '❚❚  ' : '▶  ') + fmt(v.currentTime) +
      (isFinite(v.duration) ? ' / ' + fmt(v.duration) : '') + '     ◀ ▶ skip 10s';
    osdBox.style.opacity = '1';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osdBox.style.opacity = '0'; }, v.paused ? 60000 : 2500);
  }
  function seek(v, s) { v.currentTime = Math.max(0, v.currentTime + s); osd(v); }

  function playerKey(k, v) {
    if (k === K.ENTER || k === K.PLAYPAUSE) togglePlay(v);
    else if (k === K.LEFT || k === K.RW) seek(v, -10);
    else if (k === K.RIGHT || k === K.FF) seek(v, 10);
    else if (k === K.UP || k === K.DOWN) osd(v);
    else if (k === K.PLAY) { v.play(); osd(v); }
    else if (k === K.PAUSE || k === K.STOP) { v.pause(); osd(v); }
    else if (k === K.BACK || k === K.ESC) back();
    else return false;
    return true;
  }

  // ---- key handling ----
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, handled = true, active = document.activeElement;
    var typing = active && /^(INPUT|TEXTAREA)$/.test(active.tagName);
    var pv = !typing && playerVideo();

    if (pv) {
      handled = playerKey(k, pv);
    } else if (DIRS[k]) {
      // While typing, left/right move the cursor inside the text box.
      if (typing && (k === K.LEFT || k === K.RIGHT)) return;
      if (typing) active.blur();
      move(DIRS[k]);
    } else if (k === K.ENTER) {
      if (typing || (active && active.tagName === 'SELECT')) return; // let the field handle it
      activate();
    } else if (k === K.BACK || k === K.ESC) {
      back();
    } else if (k === K.PLAYPAUSE) { togglePlay(video()); }
    else if (k === K.PLAY) { var v1 = video(); if (v1) v1.play(); }
    else if (k === K.PAUSE || k === K.STOP) { var v2 = video(); if (v2) v2.pause(); }
    else if (k === K.FF) { var v3 = video(); if (v3) v3.currentTime += 10; }
    else if (k === K.RW) { var v4 = video(); if (v4) v4.currentTime -= 10; }
    else handled = false;

    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---- keep focus valid when the page changes (single-page app navigation) ----
  var timer = null;
  new MutationObserver(function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!current || !document.contains(current) || !usable(current)) {
        current = null;
        var list = candidates();
        focusEl(firstInView(sameLayer(list, false)) || firstInView(list));
      }
    }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // The green ring replaces the browser's own focus outline.
  var st = document.createElement('style');
  st.textContent = '*:focus{outline:none !important}';
  (document.head || document.documentElement).appendChild(st);
})();
