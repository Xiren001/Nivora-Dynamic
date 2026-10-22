if (!customElements.get('product-gallery-flash')) {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const finished = (animation) => animation.finished.catch(() => {});
  const onIdle = (callback) => (window.requestIdleCallback ? requestIdleCallback(callback) : setTimeout(callback, 200));

  customElements.define(
    'product-gallery-flash',
    class ProductGalleryFlash extends HTMLElement {
      connectedCallback() {
        this.init();
      }

      disconnectedCallback() {
        this.teardown();
      }

      teardown() {
        this.abortController?.abort();
        this.unsubscribe?.();
        this.unsubscribe = null;
        clearTimeout(this.autoplayTimer);
      }

      init() {
        this.teardown();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        const $ = (selector) => this.querySelector(selector);
        const $$ = (selector) => Array.from(this.querySelectorAll(selector));

        this.stage = $('[data-pgf-stage]');
        this.slides = $$('[data-pgf-slide]');
        this.flash = $('[data-pgf-flash]');
        this.lens = $('[data-pgf-lens]');
        this.status = $('[data-pgf-status]');
        this.thumbList = $('[data-pgf-thumbs]');
        this.thumbs = $$('[data-pgf-thumb]');
        this.dots = $$('[data-pgf-dot]');
        this.lightbox = $('[data-pgf-lightbox]');
        if (!this.stage || !this.slides.length) return;

        const data = this.dataset;
        this.index = Math.max(0, this.slides.findIndex((slide) => slide.classList.contains('is-active')));
        this.effect = data.transition || 'flash';
        this.duration = clamp(parseInt(data.duration, 10) || 350, 100, 800);
        this.easing = data.easing || 'ease-in-out';
        this.peak = clamp(parseFloat(data.flashOpacity) || 0.85, 0.3, 1);
        this.zoomMode = data.zoom || 'none';
        this.zoomLevel = parseFloat(data.zoomLevel) || 2;
        this.autoplayMs = parseInt(data.autoplay, 10) || 0;
        this.isRTL = getComputedStyle(this).direction === 'rtl';
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.busy = false;
        this.queued = null;
        this.pauseReasons = new Set();
        this.upgradedImages = new WeakSet();

        // Arrows
        $('[data-pgf-prev]')?.addEventListener('click', () => this.step(-1), { signal });
        $('[data-pgf-next]')?.addEventListener('click', () => this.step(1), { signal });

        // Thumbnails + dots
        this.thumbs.forEach((thumb) => {
          const target = parseInt(thumb.dataset.pgfThumb, 10);
          const isOverflow = thumb.hasAttribute('data-pgf-overflow');
          thumb.addEventListener(
            'click',
            () => (isOverflow && this.lightbox ? this.openLightboxForSlide(target) : this.go(target)),
            { signal }
          );
          if (data.trigger === 'hover' && !isOverflow) {
            thumb.addEventListener(
              'pointerenter',
              (event) => event.pointerType === 'mouse' && this.go(target),
              { signal }
            );
          }
        });
        this.dots.forEach((dot) =>
          dot.addEventListener('click', () => this.go(parseInt(dot.dataset.pgfDot, 10)), { signal })
        );

        // Keyboard
        this.addEventListener('keydown', (event) => this.onKeydown(event), { signal });

        // Swipe
        this.stage.addEventListener('pointerdown', (event) => this.onSwipeStart(event), { signal });
        this.stage.addEventListener('pointerup', (event) => this.onSwipeEnd(event), { signal });
        this.stage.addEventListener('pointercancel', () => (this.swipe = null), { signal });

        // Lightbox openers (swallow the click that ends a swipe)
        $$('[data-pgf-open]').forEach((opener) =>
          opener.addEventListener(
            'click',
            (event) => {
              if (this.suppressClick) return event.preventDefault();
              this.openLightbox(parseInt(opener.dataset.pgfOpen, 10));
            },
            { signal }
          )
        );
        if (this.lightbox) this.initLightbox(signal);

        // Hover zoom (precise pointers only)
        if (this.zoomMode !== 'none' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
          this.stage.addEventListener('pointermove', (event) => this.onZoomMove(event), { signal });
          this.stage.addEventListener('pointerleave', () => this.endZoom(), { signal });
        }

        // Autoplay
        if (this.autoplayMs) {
          if (data.pauseHover !== undefined) {
            this.addEventListener('pointerenter', () => this.pause('hover'), { signal });
            this.addEventListener('pointerleave', () => this.resume('hover'), { signal });
          }
          this.addEventListener('focusin', () => this.pause('focus'), { signal });
          this.addEventListener(
            'focusout',
            (event) => !this.contains(event.relatedTarget) && this.resume('focus'),
            { signal }
          );
          document.addEventListener(
            'visibilitychange',
            () => (document.hidden ? this.pause('hidden') : this.resume('hidden')),
            { signal }
          );
          this.scheduleAutoplay();
        }

        // Variant change → jump to the variant's featured media
        if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          this.unsubscribe = subscribe(PUB_SUB_EVENTS.variantChange, (event) => this.onVariantChange(event.data));
        }

        this.preloadAround(this.index);
      }

      /* ---------- Navigation ---------- */

      get pendingIndex() {
        if (this.queued) return this.queued.target;
        return this.busy ? this.busyTarget : this.index;
      }

      step(delta) {
        this.go(this.pendingIndex + delta, delta);
      }

      async go(target, direction) {
        const count = this.slides.length;
        target = ((target % count) + count) % count;

        if (this.busy) {
          // Fast clicks: keep only the latest request
          this.queued = target === this.busyTarget ? null : { target, direction };
          return;
        }
        if (target === this.index) return;

        const from = this.slides[this.index];
        const to = this.slides[target];
        direction = direction || (target > this.index ? 1 : -1);

        this.busy = true;
        this.busyTarget = target;
        this.endZoom();
        this.setNav(target);

        try {
          await this.prepare(to);
          if (typeof window.pauseAllMedia === 'function') window.pauseAllMedia();
          from.querySelectorAll('video').forEach((video) => video.pause());
          await this.transition(from, to, direction);
        } finally {
          this.busy = false;
        }

        this.announce(to);
        this.preloadAround(target);
        if (this.autoplayMs) this.scheduleAutoplay();

        if (this.queued) {
          const { target: next, direction: nextDirection } = this.queued;
          this.queued = null;
          this.go(next, nextDirection);
        }
      }

      // Make sure the incoming image is downloaded and decoded before anything moves
      prepare(slide) {
        const img = slide.querySelector('img');
        if (!img) return Promise.resolve();
        img.loading = 'eager';
        const ready = img.decode
          ? img.decode().catch(() => {})
          : new Promise((resolve) => {
              if (img.complete) return resolve();
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            });
        return Promise.race([ready, wait(3000)]);
      }

      async transition(from, to, direction) {
        if (this.effect === 'none' || this.reducedMotion.matches) {
          this.swap(from, to);
          return;
        }

        const duration = this.duration;
        const half = duration / 2;
        const options = (ms) => ({ duration: ms, easing: this.easing, fill: 'forwards' });
        let animations = [];

        switch (this.effect) {
          case 'fade': {
            const out = from.animate([{ opacity: 1 }, { opacity: 0 }], options(half));
            await finished(out);
            this.swap(from, to);
            const fadeIn = to.animate([{ opacity: 0 }, { opacity: 1 }], options(half));
            await finished(fadeIn);
            animations = [out, fadeIn];
            break;
          }
          case 'crossfade': {
            to.classList.add('is-entering');
            animations = [
              to.animate([{ opacity: 0 }, { opacity: 1 }], options(duration)),
              from.animate([{ opacity: 1 }, { opacity: 0 }], options(duration)),
            ];
            await Promise.all(animations.map(finished));
            this.swap(from, to);
            break;
          }
          case 'slide': {
            const sign = direction * (this.isRTL ? -1 : 1);
            to.classList.add('is-entering');
            animations = [
              to.animate([{ transform: `translateX(${sign * 100}%)` }, { transform: 'translateX(0)' }], options(duration)),
              from.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${sign * -100}%)` }], options(duration)),
            ];
            await Promise.all(animations.map(finished));
            this.swap(from, to);
            break;
          }
          case 'zoom_fade': {
            to.classList.add('is-entering');
            animations = [
              to.animate(
                [
                  { opacity: 0, transform: 'scale(1.08)' },
                  { opacity: 1, transform: 'scale(1)' },
                ],
                options(duration)
              ),
              from.animate([{ opacity: 1 }, { opacity: 0 }], options(duration * 0.8)),
            ];
            await Promise.all(animations.map(finished));
            this.swap(from, to);
            break;
          }
          default: {
            // White flash: overlay peaks, the image swaps underneath, overlay clears
            const flashIn = this.flash.animate([{ opacity: 0 }, { opacity: this.peak }], options(half * 0.9));
            await finished(flashIn);
            this.swap(from, to);
            const flashOut = this.flash.animate([{ opacity: this.peak }, { opacity: 0 }], options(half * 1.1));
            await finished(flashOut);
            animations = [flashIn, flashOut];
          }
        }

        to.classList.remove('is-entering');
        animations.forEach((animation) => animation.cancel());
      }

      swap(from, to) {
        from.classList.remove('is-active');
        from.setAttribute('aria-hidden', 'true');
        from.inert = true;
        to.classList.add('is-active');
        to.removeAttribute('aria-hidden');
        to.inert = false;
        this.index = this.slides.indexOf(to);
        if (this.dataset.ratioMode === 'original') this.style.setProperty('--pgf-ratio', to.dataset.ratio);
      }

      setNav(target) {
        let currentThumb = null;
        this.thumbs.forEach((thumb) => {
          const index = parseInt(thumb.dataset.pgfThumb, 10);
          const isCurrent = index === target || (thumb.hasAttribute('data-pgf-overflow') && target >= index);
          if (isCurrent) {
            thumb.setAttribute('aria-current', 'true');
            currentThumb = thumb;
          } else {
            thumb.removeAttribute('aria-current');
          }
        });
        this.dots.forEach((dot) =>
          parseInt(dot.dataset.pgfDot, 10) === target
            ? dot.setAttribute('aria-current', 'true')
            : dot.removeAttribute('aria-current')
        );

        // Keep the active thumbnail in view without scrolling the page
        if (!currentThumb || !this.thumbList || !this.thumbList.offsetParent) return;
        const list = this.thumbList.getBoundingClientRect();
        const item = currentThumb.getBoundingClientRect();
        const behavior = this.reducedMotion.matches ? 'auto' : 'smooth';
        if (getComputedStyle(this.thumbList).gridAutoFlow.startsWith('row')) {
          this.thumbList.scrollBy({ top: item.top + item.height / 2 - (list.top + list.height / 2), behavior });
        } else {
          this.thumbList.scrollBy({ left: item.left + item.width / 2 - (list.left + list.width / 2), behavior });
        }
      }

      announce(slide) {
        if (this.status) this.status.textContent = slide.getAttribute('aria-label') || '';
      }

      preloadAround(index) {
        const count = this.slides.length;
        if (count < 2) return;
        onIdle(() => {
          [index + 1, index - 1].forEach((i) => {
            const img = this.slides[(i + count) % count]?.querySelector('img');
            if (img) img.loading = 'eager';
          });
        });
      }

      onKeydown(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (event.target.closest('input, textarea, select, model-viewer, video, dialog')) return;
        event.preventDefault();
        const forward = event.key === 'ArrowRight' ? 1 : -1;
        this.step(this.isRTL ? -forward : forward);

        if (this.thumbList?.contains(document.activeElement)) {
          requestAnimationFrame(() =>
            this.thumbs.find((thumb) => thumb.getAttribute('aria-current') === 'true')?.focus({ preventScroll: true })
          );
        }
      }

      /* ---------- Swipe ---------- */

      onSwipeStart(event) {
        if (event.pointerType === 'mouse' || this.slides.length < 2) return;
        if (event.target.closest('model-viewer, video, iframe, [loaded]')) return;
        this.swipe = { x: event.clientX, y: event.clientY };
      }

      onSwipeEnd(event) {
        if (!this.swipe) return;
        const dx = event.clientX - this.swipe.x;
        const dy = event.clientY - this.swipe.y;
        this.swipe = null;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

        const forward = dx < 0 ? 1 : -1;
        this.step(this.isRTL ? -forward : forward);
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 350);
      }

      /* ---------- Hover zoom ---------- */

      onZoomMove(event) {
        if (event.pointerType !== 'mouse' || this.busy) return;
        const slide = this.slides[this.index];
        const img = slide?.dataset.type === 'image' && slide.querySelector('.pgf__img');
        if (!img) return this.endZoom();

        const rect = this.stage.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (this.zoomMode === 'inner') {
          // Ask the browser for a sharper srcset candidate once
          if (!this.upgradedImages.has(img)) {
            img.sizes = `${Math.ceil(rect.width * this.zoomLevel)}px`;
            this.upgradedImages.add(img);
          }
          img.style.transformOrigin = `${(x / rect.width) * 100}% ${(y / rect.height) * 100}%`;
          this.classList.add('is-zooming-inner');
          return;
        }

        if (!this.lens) return;
        const ratio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
        const coverWide = rect.width / rect.height > ratio;
        const renderedWidth = coverWide ? rect.width : rect.height * ratio;
        const renderedHeight = coverWide ? rect.width / ratio : rect.height;
        const offsetX = (rect.width - renderedWidth) / 2;
        const offsetY = (rect.height - renderedHeight) / 2;
        const size = this.lens.offsetWidth;
        const zoom = this.zoomLevel;

        this.lens.style.left = `${x}px`;
        this.lens.style.top = `${y}px`;
        this.lens.style.backgroundImage = `url("${slide.dataset.zoomSrc || img.currentSrc}")`;
        this.lens.style.backgroundSize = `${renderedWidth * zoom}px ${renderedHeight * zoom}px`;
        this.lens.style.backgroundPosition = `${-((x - offsetX) * zoom - size / 2)}px ${-((y - offsetY) * zoom - size / 2)}px`;
        this.classList.add('is-zooming-lens');
      }

      endZoom() {
        this.classList.remove('is-zooming-inner', 'is-zooming-lens');
      }

      /* ---------- Autoplay ---------- */

      scheduleAutoplay() {
        clearTimeout(this.autoplayTimer);
        if (!this.autoplayMs || this.pauseReasons.size) return;
        this.autoplayTimer = setTimeout(() => {
          // Don't advance away from a video or 3D model the shopper started
          if (this.slides[this.index].querySelector('[loaded]')) return this.scheduleAutoplay();
          this.step(1);
        }, this.autoplayMs);
      }

      pause(reason) {
        this.pauseReasons.add(reason);
        clearTimeout(this.autoplayTimer);
      }

      resume(reason) {
        this.pauseReasons.delete(reason);
        this.scheduleAutoplay();
      }

      /* ---------- Variant change ---------- */

      onVariantChange({ sectionId, html, variant } = {}) {
        if (!variant || sectionId !== this.dataset.section) return;

        const saleBadge = this.querySelector('[data-pgf-sale-badge]');
        if (saleBadge) saleBadge.hidden = !(variant.compare_at_price > variant.price);

        const mediaId = variant.featured_media?.id;
        if (!mediaId) return;
        const key = `${this.dataset.section}-${mediaId}`;
        const index = this.slides.findIndex((slide) => slide.dataset.mediaId === key);
        if (index > -1) return this.go(index);

        // The media was filtered out of this render (hidden variant images): take the fresh markup
        const fresh = html?.getElementById(this.id);
        if (fresh?.querySelector(`[data-media-id="${key}"]`)) {
          this.innerHTML = fresh.innerHTML;
          this.init();
        }
      }

      /* ---------- Lightbox ---------- */

      initLightbox(signal) {
        const lightbox = this.lightbox;
        this.lbSlides = Array.from(lightbox.querySelectorAll('[data-pgf-lb-slide]'));
        this.lbStage = lightbox.querySelector('[data-pgf-lb-stage]');
        this.lbCounter = lightbox.querySelector('[data-pgf-lb-counter]');
        this.lbIndex = 0;
        this.pointers = new Map();
        this.resetZoom();

        lightbox.querySelector('[data-pgf-lb-close]')?.addEventListener('click', () => lightbox.close(), { signal });
        lightbox.querySelector('[data-pgf-lb-prev]')?.addEventListener('click', () => this.lbStep(-1), { signal });
        lightbox.querySelector('[data-pgf-lb-next]')?.addEventListener('click', () => this.lbStep(1), { signal });
        lightbox.addEventListener(
          'keydown',
          (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            const forward = event.key === 'ArrowRight' ? 1 : -1;
            this.lbStep(this.isRTL ? -forward : forward);
          },
          { signal }
        );
        lightbox.addEventListener('close', () => this.onLightboxClose(), { signal });

        const stage = this.lbStage;
        stage.addEventListener('pointerdown', (event) => this.onLbPointerDown(event), { signal });
        stage.addEventListener('pointermove', (event) => this.onLbPointerMove(event), { signal });
        stage.addEventListener('pointerup', (event) => this.onLbPointerUp(event), { signal });
        stage.addEventListener('pointercancel', (event) => this.pointers.delete(event.pointerId), { signal });
      }

      openLightboxForSlide(slideIndex) {
        const key = this.slides[slideIndex]?.dataset.mediaId;
        const lbIndex = this.lbSlides.findIndex((slide) => slide.dataset.mediaId === key);
        if (lbIndex > -1) this.openLightbox(lbIndex);
        else this.go(slideIndex);
      }

      openLightbox(index) {
        if (!this.lightbox || !this.lbSlides.length) return;
        this.endZoom();
        this.lastFocus = document.activeElement;
        this.lbShow(index);
        this.lightbox.showModal();
        document.documentElement.style.overflow = 'hidden';
        this.pause('lightbox');
      }

      onLightboxClose() {
        document.documentElement.style.overflow = '';
        this.resetZoom();
        // Leave the main gallery on the image the shopper ended on
        const key = this.lbSlides[this.lbIndex]?.dataset.mediaId;
        const index = this.slides.findIndex((slide) => slide.dataset.mediaId === key);
        if (index > -1 && index !== this.index) this.go(index);
        this.lastFocus?.focus({ preventScroll: true });
        this.resume('lightbox');
      }

      lbStep(delta) {
        this.lbShow(this.lbIndex + delta);
      }

      lbShow(index) {
        const count = this.lbSlides.length;
        this.lbIndex = ((index % count) + count) % count;
        this.resetZoom();
        this.lbSlides.forEach((slide, i) => slide.classList.toggle('is-active', i === this.lbIndex));
        [this.lbIndex + 1, this.lbIndex - 1].forEach((i) => {
          const img = this.lbSlides[(i + count) % count].querySelector('img');
          if (img) img.loading = 'eager';
        });
        if (this.lbCounter) this.lbCounter.textContent = `${this.lbIndex + 1} / ${count}`;
      }

      get lbImage() {
        return this.lbSlides[this.lbIndex]?.querySelector('img');
      }

      resetZoom() {
        this.zoom = { scale: 1, x: 0, y: 0 };
        this.lbSlides?.forEach((slide) => {
          const img = slide.querySelector('img');
          if (img) img.style.transform = '';
        });
        this.lightbox?.classList.remove('is-zoomed');
      }

      applyZoom() {
        const img = this.lbImage;
        if (!img) return;
        const { scale } = this.zoom;
        const maxX = Math.max(0, (img.offsetWidth * scale - this.lbStage.clientWidth) / 2);
        const maxY = Math.max(0, (img.offsetHeight * scale - this.lbStage.clientHeight) / 2);
        this.zoom.x = clamp(this.zoom.x, -maxX, maxX);
        this.zoom.y = clamp(this.zoom.y, -maxY, maxY);
        img.style.transform = scale > 1 ? `translate(${this.zoom.x}px, ${this.zoom.y}px) scale(${scale})` : '';
        this.lightbox.classList.toggle('is-zoomed', scale > 1);
      }

      toggleZoom(clientX, clientY) {
        const img = this.lbImage;
        if (!img) return;
        if (this.zoom.scale > 1) return this.resetZoom();
        const rect = img.getBoundingClientRect();
        const scale = 2.5;
        this.zoom = {
          scale,
          x: (rect.left + rect.width / 2 - clientX) * (scale - 1),
          y: (rect.top + rect.height / 2 - clientY) * (scale - 1),
        };
        this.applyZoom();
      }

      onLbPointerDown(event) {
        this.lbStage.setPointerCapture?.(event.pointerId);
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = Array.from(this.pointers.values());
        if (points.length === 2) {
          this.pinch = {
            distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1,
            scale: this.zoom.scale,
          };
          this.drag = null;
        } else if (points.length === 1) {
          this.drag = {
            x: event.clientX,
            y: event.clientY,
            zx: this.zoom.x,
            zy: this.zoom.y,
            time: Date.now(),
            onImage: Boolean(event.target.closest('img')),
          };
        }
      }

      onLbPointerMove(event) {
        if (!this.pointers.has(event.pointerId)) return;
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = Array.from(this.pointers.values());

        if (points.length === 2 && this.pinch) {
          const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
          this.zoom.scale = clamp((this.pinch.scale * distance) / this.pinch.distance, 1, 4);
          this.applyZoom();
        } else if (points.length === 1 && this.drag && this.zoom.scale > 1) {
          this.zoom.x = this.drag.zx + (event.clientX - this.drag.x);
          this.zoom.y = this.drag.zy + (event.clientY - this.drag.y);
          this.applyZoom();
        }
      }

      onLbPointerUp(event) {
        this.pointers.delete(event.pointerId);
        if (this.pointers.size) return;
        this.pinch = null;
        const drag = this.drag;
        this.drag = null;
        if (!drag) return;

        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        const isTap = Math.abs(dx) < 8 && Math.abs(dy) < 8 && Date.now() - drag.time < 300;

        if (this.zoom.scale === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          const forward = dx < 0 ? 1 : -1;
          return this.lbStep(this.isRTL ? -forward : forward);
        }
        if (!isTap || !drag.onImage) return;

        // Mouse: single click zooms. Touch: double-tap zooms.
        if (event.pointerType === 'mouse') return this.toggleZoom(event.clientX, event.clientY);
        const now = Date.now();
        if (now - (this.lastTap || 0) < 300) {
          this.lastTap = 0;
          this.toggleZoom(event.clientX, event.clientY);
        } else {
          this.lastTap = now;
        }
      }
    }
  );
}
