/*
 * Cinejoy TV remote navigation.
 * Injected into https://cinejoy.pk by TizenBrew on Samsung (Tizen) TVs.
 * Arrow keys move a green focus box, OK clicks, Back goes back,
 * the remote drives the video player. ES5 so older Tizen runs it.
 *
 * Built for slow TV processors: on each key press it measures element
 * positions once, scores them, and only checks styles of the best few.
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

  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind']
      .forEach(function (k) { window.tizen.tvinputdevice.registerKey(k); });
  } catch (e) {}

  // ---- lighter page: blur effects and animations are very slow on TV GPUs ----
  var st = document.createElement('style');
  st.textContent =
    '*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;' +
    'transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}' +
    '[class*="blur"]{filter:none!important}' +
    '*:focus{outline:none!important}';
  (document.head || document.documentElement).appendChild(st);

  // ---- focus ring (an overlay, so it is never clipped by overflow:hidden) ----
  var ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;display:none;' +
    'border:4px solid #95ff50;border-radius:10px;box-shadow:0 0 0 3px rgba(0,0,0,.65);';

  var ringQueued = false;
  function updateRing() {
    ringQueued = false;
    if (!ring.parentNode && document.body) document.body.appendChild(ring);
    if (!current || !document.documentElement.contains(current) || playerVideo()) { ring.style.display = 'none'; return; }
    var r = current.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.transform = 'translate(' + (r.left - 6) + 'px,' + (r.top - 6) + 'px)';
    ring.style.left = '0'; ring.style.top = '0';
    ring.style.width = (r.width + 4) + 'px';
    ring.style.height = (r.height + 4) + 'px';
  }
  function queueRing() {
    if (!ringQueued) { ringQueued = true; window.requestAnimationFrame(updateRing); }
  }
  window.addEventListener('scroll', queueRing, { capture: true, passive: true });
  window.addEventListener('resize', queueRing);
  setInterval(function () { if (current) updateRing(); }, 700); // auto-moving carousels

  // ---- cheap checks, cached per element ----
  var fixedCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  // Floating UI (bottom menu bar, "scroll to top") is position:fixed.
  // Walking offsetParent is short; a fixed element's chain ends at itself.
  function isFixed(el) {
    if (fixedCache && fixedCache.has(el)) return fixedCache.get(el);
    var fixed = false;
    for (var p = el; p; p = p.offsetParent) {
      if (getComputedStyle(p).position === 'fixed') { fixed = true; break; }
      if (!p.offsetParent) break;
    }
    if (fixedCache) fixedCache.set(el, fixed);
    return fixed;
  }

  function structurallyOk(el) {
    if (el === ring || el.disabled) return false;
    // Inside a real link/button (an icon inside a movie card): use the outer one.
    if (el.parentElement && el.parentElement.closest('a[href],button')) return false;
    // Generic clickable wrapper holding its own buttons (hero banner): use the inner ones.
    if (!/^(A|BUTTON|INPUT|SELECT|TEXTAREA|IFRAME|VIDEO)$/.test(el.tagName) && el.querySelector(SEL)) return false;
    return true;
  }

  function inScroller(el) {
    for (var p = el.parentElement, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) {
      var o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  }

  function visibleEnough(el, r) {
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.opacity === '0') return false;
    if ((r.right <= 0 || r.left >= window.innerWidth) && !inScroller(el)) return false;
    return true;
  }

  // ---- spatial navigation ----
  function gap(a1, a2, b1, b2) { return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2)); }

  // Scores every element by position only (one layout pass, no style reads).
  function scored(dir) {
    var all = document.querySelectorAll(SEL), out = [];
    var c = current.getBoundingClientRect();
    var cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === current) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      var x = r.left + r.width / 2, y = r.top + r.height / 2, primary, ortho, drift;
      if (dir === 'right') { if (x <= cx + 2) continue; primary = r.left - c.right; ortho = gap(r.top, r.bottom, c.top, c.bottom); drift = Math.abs(y - cy); }
      else if (dir === 'left') { if (x >= cx - 2) continue; primary = c.left - r.right; ortho = gap(r.top, r.bottom, c.top, c.bottom); drift = Math.abs(y - cy); }
      else if (dir === 'down') { if (y <= cy + 2) continue; primary = r.top - c.bottom; ortho = gap(r.left, r.right, c.left, c.right); drift = Math.abs(x - cx); }
      else { if (y >= cy - 2) continue; primary = c.top - r.bottom; ortho = gap(r.left, r.right, c.left, c.right); drift = Math.abs(x - cx); }
      out.push({ el: el, r: r, s: Math.max(0, primary) + ortho * 3 + drift * 0.15 });
    }
    out.sort(function (a, b) { return a.s - b.s; });
    return out;
  }

  // Best-scored element that passes the (slower) checks, preferring one layer.
  function pick(list, wantFixed) {
    var fallback = null;
    for (var i = 0; i < list.length && i < 60; i++) {
      var it = list[i];
      if (it.el.contains(current) || current.contains(it.el)) continue;
      if (!structurallyOk(it.el) || !visibleEnough(it.el, it.r)) continue;
      if (isFixed(it.el) === wantFixed) return it.el;
      if (!fallback) fallback = it.el;
    }
    return fallback;
  }

  // Top-left-most usable element on screen (optionally lowest row, for the menu bar).
  function firstOnScreen(wantFixed, lowest) {
    var all = document.querySelectorAll(SEL), best = null, bestY = 0, bestX = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i], r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue;
      var better = !best ||
        (lowest ? (r.top > bestY + 5 || (Math.abs(r.top - bestY) <= 5 && r.left < bestX))
                : (r.top < bestY - 5 || (Math.abs(r.top - bestY) <= 5 && r.left < bestX)));
      if (!better) continue;
      if (!structurallyOk(el) || isFixed(el) !== wantFixed || !visibleEnough(el, r)) continue;
      best = el; bestY = r.top; bestX = r.left;
    }
    return best;
  }

  function isField(el) { return el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName); }

  function focusEl(el) {
    if (!el) return;
    if (isField(document.activeElement)) document.activeElement.blur();
    current = el;
    // Don't focus text fields until OK is pressed, so the TV keyboard doesn't pop up.
    if (!isField(el)) { try { el.focus({ preventScroll: true }); } catch (e) {} }
    var r = el.getBoundingClientRect();
    var margin = window.innerHeight * 0.15;
    if (!isFixed(el) && (r.top < margin || r.bottom > window.innerHeight - margin * 1.5 ||
        r.left < 0 || r.right > window.innerWidth)) {
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { el.scrollIntoView(false); }
    }
    updateRing();
  }

  function valid(el) {
    if (!el || !document.documentElement.contains(el)) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }

  function move(dir) {
    if (!valid(current)) { focusEl(firstOnScreen(false) || firstOnScreen(true)); return; }
    // Left/right inside the menu bar stay in it; otherwise prefer page content.
    var stayInMenu = isFixed(current) && (dir === 'left' || dir === 'right');
    var next = pick(scored(dir), stayInMenu);
    if (next) focusEl(next);
    else if (dir === 'down' || dir === 'up') window.scrollBy(0, (dir === 'down' ? 1 : -1) * window.innerHeight * 0.6);
  }

  // ---- actions ----
  function fire(el, type) {
    try {
      var r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
      }));
    } catch (e) {}
  }

  function activate() {
    if (!valid(current)) { move('down'); return; }
    if (isField(current)) { current.focus(); return; }
    if (current.tagName === 'IFRAME') { try { current.focus(); } catch (e) {} return; }
    fire(current, 'mousedown'); fire(current, 'mouseup');
    current.click();
  }

  function back() {
    if (isField(document.activeElement)) { document.activeElement.blur(); return; }
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (location.pathname !== '/' || location.search || location.hash) { history.back(); return; }
    // Home page: first Back jumps to the bottom menu bar, second Back exits.
    if (!current || !isFixed(current)) {
      var menu = firstOnScreen(true, true);
      if (menu) { focusEl(menu); return; }
    }
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }

  // ---- player mode (watch page: a big <video> fills the screen) ----
  function playerVideo() {
    var v = document.getElementsByTagName('video');
    for (var i = 0; i < v.length; i++) {
      var r = v[i].getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.6 && r.height >= window.innerHeight * 0.5) return v[i];
    }
    return null;
  }

  var osdBox = document.createElement('div');
  osdBox.style.cssText = 'position:fixed;left:50%;bottom:24%;transform:translateX(-50%);z-index:2147483647;' +
    'pointer-events:none;padding:14px 28px;border-radius:14px;background:rgba(0,0,0,.75);color:#fff;' +
    'font:600 28px/1.2 sans-serif;white-space:nowrap;display:none;';
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
    osdBox.style.display = 'block';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osdBox.style.display = 'none'; }, v.paused ? 60000 : 2500);
  }
  function togglePlay(v) { if (v.paused) v.play(); else v.pause(); osd(v); }
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
  var lastMove = 0;
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, handled = true, active = document.activeElement;
    var typing = active && /^(INPUT|TEXTAREA)$/.test(active.tagName);
    var pv = !typing && playerVideo();

    if (pv) {
      handled = playerKey(k, pv);
    } else if (DIRS[k]) {
      // While typing, left/right move the cursor inside the text box.
      if (typing && (k === K.LEFT || k === K.RIGHT)) return;
      e.preventDefault(); e.stopPropagation();
      // Holding a key repeats very fast; skip repeats the TV can't keep up with.
      var now = Date.now();
      if (e.repeat && now - lastMove < 120) return;
      lastMove = now;
      if (typing) active.blur();
      move(DIRS[k]);
      return;
    } else if (k === K.ENTER) {
      if (typing || (active && active.tagName === 'SELECT')) return; // let the field handle it
      activate();
    } else if (k === K.BACK || k === K.ESC) {
      back();
    } else handled = false;

    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---- keep focus valid when the page changes (single-page app navigation) ----
  var timer = null;
  new MutationObserver(function () {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      if (!valid(current)) { current = null; focusEl(firstOnScreen(false) || firstOnScreen(true)); }
    }, 500);
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
