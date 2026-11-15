/*
 * Bundle × Options sync (Kaching Bundles -> YMQ Product Options)
 *
 * Shows or hides YMQ fields depending on which Kaching bundle is selected.
 * Runs only on product templates that have the "Bundle field rules" block
 * (sections/main-product.liquid -> snippets/kaching-ymq-rules.liquid).
 *
 * Bundle number: either the number of items in the selected offer
 * ("4 Key Chains" = 4) or its position in the offer list (3rd offer = 3),
 * chosen per template with "Count bundles by".
 *
 * Priority, highest first:
 *  1. Custom rules (one per line: Field label = bundle numbers)
 *       Gift Note = 2+   |  Engraving = 2,4  |  Name 3 = 3-4
 *       Photo* = all     |  Wrapping = none
 *  2. "Bundle N shows" lists: a field listed under any bundle shows only
 *     for the bundles it is listed under.
 *  3. Numbering rule: a field whose label ends in a number ("Custom Photo 2")
 *     shows only when the bundle number is at least that number.
 * Fields matched by none of these are never touched.
 * A label ending in * matches every field starting with that text.
 */
(function () {
  if (window.__kachingYmqSync) return;
  window.__kachingYmqSync = true;

  var HIDE = 'ymq-option-condition-hide'; // YMQ's own "hidden by condition" class

  // Settings come only from the "Bundle field rules" block on the template.
  // No block (or block disabled) = nothing is hidden.
  function readConfig() {
    var el = document.querySelector('script[data-kys-product-config]');
    if (!el) return { enabled: false };
    try {
      var p = JSON.parse(el.textContent || '{}');
      return {
        enabled: true,
        countBy: p.countBy === 'position' ? 'position' : 'items',
        numberRule: p.numberRule !== false,
        lists: (p.lists || []).map(parseList),
        rules: parseRules(p.rules)
      };
    } catch (e) {
      return { enabled: false };
    }
  }

  function matcher(label) {
    label = label.trim().toLowerCase();
    var prefix = /\*$/.test(label);
    label = label.replace(/\*$/, '').trim();
    return function (l) { return prefix ? l.indexOf(label) === 0 : l === label; };
  }

  function parseList(text) {
    return String(text || '').split(/[\r\n,]+/).map(function (s) { return s.trim(); })
      .filter(Boolean).map(matcher);
  }

  function parseRules(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var i = line.lastIndexOf('=');
      if (i < 1) return;
      var label = line.slice(0, i).trim();
      var spec = line.slice(i + 1).trim().toLowerCase();
      if (!label || !spec) return;
      out.push({ match: matcher(label), test: parseSpec(spec) });
    });
    return out;
  }

  function parseSpec(spec) {
    if (spec === 'all' || spec === 'always') return function () { return true; };
    if (spec === 'none' || spec === 'hide' || spec === 'never') return function () { return false; };
    var parts = spec.split(/[,;\s]+/).filter(Boolean);
    return function (n) {
      return parts.some(function (p) {
        var m;
        if ((m = p.match(/^(\d+)\+$/))) return n >= Number(m[1]);
        if ((m = p.match(/^(\d+)-(\d+)$/))) return n >= Number(m[1]) && n <= Number(m[2]);
        return /^\d+$/.test(p) && n === Number(p);
      });
    };
  }

  function anyMatch(list, label) {
    for (var i = 0; i < list.length; i++) if (list[i](label)) return true;
    return false;
  }

  function dealBars(block) {
    try { return JSON.parse(block.getAttribute('deal-block') || '{}').dealBars || []; }
    catch (e) { return []; }
  }

  function selectedBundleNumber(countBy) {
    var block = document.querySelector('kaching-bundles-block');
    if (!block) return null;
    var bar = block.querySelector('.kaching-bundles__bar--selected');
    if (!bar) return null;
    var id = bar.getAttribute('data-deal-bar-id');
    var bars = dealBars(block);

    if (countBy === 'position') {
      for (var i = 0; i < bars.length; i++) if (bars[i].id === id) return i + 1;
      var all = Array.prototype.slice.call(block.querySelectorAll('.kaching-bundles__bar'));
      var pos = all.indexOf(bar);
      return pos >= 0 ? pos + 1 : null;
    }

    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      if (b.id !== id) continue;
      var q = b.dealBarType === 'bxgy'
        ? (Number(b.buyQuantity) || 0) + (Number(b.getQuantity) || 0)
        : Number(b.quantity) || 0;
      if (q) return q;
    }
    // Fallback: first number in the offer title, e.g. "2 Key Chains"
    var t = bar.querySelector('.kaching-bundles__bar-title, .kaching-bundles__bar-first-line');
    var m = t && t.textContent.match(/\d+/);
    return m ? Number(m[0]) : 1;
  }

  // Returns true (show), false (hide) or null (not managed).
  function decide(cfg, label, n) {
    var l = label.toLowerCase();
    for (var i = 0; i < cfg.rules.length; i++) {
      if (cfg.rules[i].match(l)) return cfg.rules[i].test(n);
    }
    var listed = false;
    for (var k = 0; k < cfg.lists.length; k++) {
      if (anyMatch(cfg.lists[k], l)) { listed = true; if (k + 1 === n) return true; }
    }
    if (listed) return false;
    if (cfg.numberRule) {
      var m = label.match(/(\d+)\s*$/);
      if (m) return Number(m[1]) <= n;
    }
    return null;
  }

  function setHidden(box, hide) {
    var managed = box.hasAttribute('data-kys');
    if (!hide && !managed) return; // never touch fields we did not hide
    if (managed && box.classList.contains(HIDE) === hide) return;
    box.setAttribute('data-kys', '1');
    box.classList.toggle(HIDE, hide);
    box.style.display = hide ? 'none' : '';
    box.querySelectorAll('input, textarea, select').forEach(function (el) {
      if (hide) {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
        else { try { el.value = ''; } catch (e) {} }
      }
      el.disabled = hide;
      el.classList.toggle('ymq-option-condtion-disabled', hide);
    });
    if (hide) {
      box.querySelectorAll('.ymq-option-preview-list, .ymq-option-error').forEach(function (p) { p.innerHTML = ''; });
    }
  }

  function apply() {
    var cfg = readConfig();
    var n = cfg.enabled ? selectedBundleNumber(cfg.countBy) : null;
    document.querySelectorAll('.ymq-options-box[ymq-option-label]').forEach(function (box) {
      if (n == null) { setHidden(box, false); return; }
      var show = decide(cfg, box.getAttribute('ymq-option-label').trim(), n);
      setHidden(box, show === false);
    });
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; apply(); });
  }

  document.addEventListener('change', schedule, true);
  document.addEventListener('click', function () { setTimeout(schedule, 50); }, true);
  document.addEventListener('shopify:section:load', schedule);
  document.addEventListener('shopify:block:select', schedule);
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class']
  });
  schedule();
})();
