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
    '*:focus{outline:none!important}' +
    // Focused item grows slightly, TV-style.
    '.cj-tv-focus{transform:scale(1.06)!important;z-index:40!important;position:relative}';
  (document.head || document.documentElement).appendChild(st);

  // ---- small on-screen note ----
  var toastBox = document.createElement('div');
  toastBox.style.cssText = 'position:fixed;right:3%;top:4%;z-index:2147483647;pointer-events:none;' +
    'padding:10px 20px;border-radius:12px;background:rgba(0,0,0,.8);color:#fff;' +
    'font:600 20px/1.2 sans-serif;display:none;';
  var toastTimer = null;
  function toast(text) {
    if (!toastBox.parentNode && document.body) document.body.appendChild(toastBox);
    toastBox.textContent = text;
    toastBox.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastBox.style.display = 'none'; }, 1800);
  }

  // ---- pop-up / ad-link blocking: never leave cinejoy.pk ----
  function sameSite(url) {
    try {
      var h = new URL(url, location.href).hostname;
      return h === location.hostname || /(^|\.)cinejoy\.pk$/.test(h);
    } catch (e) { return false; }
  }
  var fakeWindow = {
    closed: true, opener: null, location: { href: '' },
    close: function () {}, focus: function () {}, blur: function () {}, postMessage: function () {},
    document: { write: function () {}, writeln: function () {}, open: function () {}, close: function () {} }
  };
  window.open = function (url) {
    if (url && sameSite(url)) { location.href = new URL(url, location.href).href; return window; }
    toast('Blocked a pop-up');
    return fakeWindow;
  };
  // Links to other sites (ads) do nothing; same-site "new tab" links open in place.
  window.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    if (!sameSite(a.href)) {
      e.preventDefault(); e.stopImmediatePropagation();
      toast('Blocked a link to another site');
    } else if (a.target && a.target !== '_self') {
      a.target = '_self';
    }
  }, true);

  // ---- focus ring (an overlay, so it is never clipped by overflow:hidden) ----
  var ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;display:none;' +
    'border:5px solid #95ff50;border-radius:10px;' +
    'box-shadow:0 0 0 3px rgba(0,0,0,.7),0 0 18px rgba(149,255,80,.45);';

  var ringQueued = false;
  function updateRing() {
    ringQueued = false;
    if (!ring.parentNode && document.body) document.body.appendChild(ring);
    if (!current || !document.documentElement.contains(current) || playerVideo()) { ring.style.display = 'none'; return; }
    var r = current.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.transform = 'translate(' + (r.left - 7) + 'px,' + (r.top - 7) + 'px)';
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

  // The horizontally scrolling row an element sits in (a movie row), if any.
  var rowCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function rowOf(el) {
    if (rowCache && rowCache.has(el)) return rowCache.get(el);
    var row = null;
    for (var p = el.parentElement, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) {
      var o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') { row = p; break; }
    }
    if (rowCache) rowCache.set(el, row);
    return row;
  }

  function visibleEnough(el, r) {
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.opacity === '0') return false;
    if ((r.right <= 0 || r.left >= window.innerWidth) && !rowOf(el)) return false;
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

  // ---- TV-style scrolling: the focused row sits at a steady height, and the
  //      row slides so the focused card keeps a margin from the screen edge ----
  var scrollAnim = 0;
  function scrollToFocus(el, animate) {
    var r = el.getBoundingClientRect();
    var row = rowOf(el), dx = 0, dy = 0;

    if (row) {
      var cr = row.getBoundingClientRect();
      var pad = Math.min(cr.width * 0.08, 140);
      if (r.left < cr.left + pad) dx = r.left - (cr.left + pad);
      else if (r.right > cr.right - pad) dx = r.right - (cr.right - pad);
    } else if (r.left < 0 || r.right > window.innerWidth) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
      r = el.getBoundingClientRect();
    }

    // Tall things (hero banner) go near the top; rows sit about a quarter down.
    var vh = window.innerHeight;
    var target = r.height > vh * 0.5 ? vh * 0.06 : vh * 0.26;
    dy = r.top - target;
    var maxY = document.documentElement.scrollHeight - vh;
    var sy = window.pageYOffset;
    dy = Math.max(-sy, Math.min(maxY - sy, dy));

    var sx = row ? row.scrollLeft : 0;
    var token = ++scrollAnim;
    if (!animate || (Math.abs(dx) < 2 && Math.abs(dy) < 2)) {
      if (row) row.scrollLeft = sx + dx;
      window.scrollTo(window.pageXOffset, sy + dy);
      return;
    }
    var start = Date.now(), dur = 160;
    (function step() {
      if (token !== scrollAnim) return; // a newer key press took over
      var k = Math.min(1, (Date.now() - start) / dur), e = 1 - Math.pow(1 - k, 3);
      if (row) row.scrollLeft = sx + dx * e;
      window.scrollTo(window.pageXOffset, sy + dy * e);
      if (k < 1) window.requestAnimationFrame(step);
    })();
  }

  // Remembers the last card focused in each row, so coming back to a row
  // lands where you left off.
  var rowMemory = typeof WeakMap === 'function' ? new WeakMap() : null;

  function focusEl(el, animate) {
    if (!el) return;
    if (isField(document.activeElement)) document.activeElement.blur();
    if (current && current.classList) current.classList.remove('cj-tv-focus');
    current = el;
    // Don't focus text fields until OK is pressed, so the TV keyboard doesn't pop up.
    if (!isField(el)) { try { el.focus({ preventScroll: true }); } catch (e) {} }
    var row = rowOf(el);
    if (row) {
      el.classList.add('cj-tv-focus');
      if (rowMemory) rowMemory.set(row, el);
    }
    var radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 6;
    ring.style.borderRadius = Math.min(radius + 5, 40) + 'px';
    if (!isFixed(el)) scrollToFocus(el, animate);
    updateRing();
  }

  function valid(el) {
    if (!el || !document.documentElement.contains(el)) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }

  function move(dir, animate) {
    if (!valid(current)) { focusEl(firstOnScreen(false) || firstOnScreen(true), false); return; }
    // Left/right inside the menu bar stay in it; otherwise prefer page content.
    var stayInMenu = isFixed(current) && (dir === 'left' || dir === 'right');
    var next = pick(scored(dir), stayInMenu);
    // Moving up/down into another row: return to the card last used there.
    if (next && (dir === 'up' || dir === 'down') && rowMemory) {
      var row = rowOf(next);
      if (row && row !== rowOf(current)) {
        var mem = rowMemory.get(row);
        if (mem && mem !== next && valid(mem) && row.contains(mem)) next = mem;
      }
    }
    if (next) focusEl(next, animate);
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
    try { window.CinejoyTV.exit(); } catch (e) {} // Android TV app
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
      move(DIRS[k], !e.repeat); // glide on single presses, jump while a key is held
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

  // ---- hooks for the Android TV app (its Back and media keys never reach the page) ----
  window.__cinejoyTv = {
    back: function () {
      var pv = playerVideo();
      if (pv) playerKey(K.BACK, pv); else back();
      return 'ok';
    },
    key: function (k) {
      var v = playerVideo() || video();
      if (v) playerKey(k, v);
      return 'ok';
    }
  };
  function video() {
    var v = document.getElementsByTagName('video');
    return v.length ? v[0] : null;
  }
})();
