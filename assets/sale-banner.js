if (!customElements.get('sale-banner')) {
  class SaleBanner extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.isRotating = this.classList.contains('sale-banner--rotate');
      this.messages = Array.from(this.querySelectorAll('.sale-banner__message'));
      this.dots = Array.from(this.querySelectorAll('.sale-banner__dot'));
      this.index = Math.max(0, this.messages.findIndex((message) => message.classList.contains('is-active')));

      this.initDismiss();
      if (!this.reducedMotion) {
        this.initLetters();
        this.initMarquee();
      }
      this.initCountdowns();
      this.initRotation();

      this.messages.forEach((message, i) => {
        if (!this.isRotating || i === this.index) this.animateTypewriter(message);
      });
    }

    disconnectedCallback() {
      clearInterval(this.countdownTimer);
      clearInterval(this.rotationTimer);
      if (this.resizeObserver) this.resizeObserver.disconnect();
    }

    /* Dismiss */
    initDismiss() {
      const button = this.querySelector('.sale-banner__close');
      if (!button) return;
      button.addEventListener('click', () => {
        this.hidden = true;
        const days = Number(this.dataset.dismissDays) || 0;
        const inEditor = window.Shopify && window.Shopify.designMode;
        if (days > 0 && !inEditor) {
          try {
            localStorage.setItem(`sale-banner:${this.dataset.key}`, String(Date.now() + days * 86400000));
          } catch (e) {}
        }
        this.pause();
      });
    }

    /* Letter-by-letter reveal: split text into spans, keep the full text for screen readers. */
    initLetters() {
      this.querySelectorAll('.sale-banner__message--anim-letters .sale-banner__text').forEach((text) => {
        this.addScreenReaderCopy(text);
        let index = 0;
        const walk = (node) => {
          Array.from(node.childNodes).forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE) {
              const fragment = document.createDocumentFragment();
              for (const char of child.textContent) {
                if (/\s/.test(char)) {
                  fragment.append(char);
                  continue;
                }
                const span = document.createElement('span');
                span.className = 'sale-banner__char';
                span.style.setProperty('--i', index++);
                span.textContent = char;
                fragment.append(span);
              }
              child.replaceWith(fragment);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              walk(child);
            }
          });
        };
        walk(text);
      });
    }

    addScreenReaderCopy(text) {
      const copy = document.createElement('span');
      copy.className = 'visually-hidden';
      copy.innerHTML = text.innerHTML;
      text.after(copy);
      text.setAttribute('aria-hidden', 'true');
    }

    /* Marquee: repeat the content until it fills the width, then duplicate the group for a seamless loop. */
    initMarquee() {
      const marquees = Array.from(this.querySelectorAll('.sale-banner__marquee'));
      if (!marquees.length) return;
      const speed = Number(this.dataset.marqueeSpeed) || 80;

      const build = (marquee) => {
        if (marquee.classList.contains('is-ready') || marquee.offsetWidth === 0) return;
        const track = marquee.querySelector('.sale-banner__marquee-track');
        const group = track.querySelector('.sale-banner__marquee-group');
        const item = group.firstElementChild;
        let guard = 0;
        while (group.offsetWidth < marquee.offsetWidth && guard++ < 20) {
          group.append(this.hideClone(item.cloneNode(true)));
        }
        track.append(this.hideClone(group.cloneNode(true)));
        track.style.setProperty('--sb-marquee-duration', `${Math.max(group.offsetWidth / speed, 2)}s`);
        marquee.classList.add('is-ready');
      };

      this.resizeObserver = new ResizeObserver((entries) => entries.forEach((entry) => build(entry.target)));
      marquees.forEach((marquee) => this.resizeObserver.observe(marquee));
    }

    hideClone(element) {
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
      element.querySelectorAll('a, button').forEach((control) => (control.tabIndex = -1));
      return element;
    }

    /* Countdown */
    initCountdowns() {
      this.countdowns = Array.from(this.querySelectorAll('[data-countdown]'))
        .map((element) => ({
          element,
          end: Date.parse(element.dataset.countdown),
          message: element.closest('.sale-banner__message'),
        }))
        .filter((countdown) => {
          if (Number.isNaN(countdown.end)) {
            countdown.element.hidden = true;
            return false;
          }
          return true;
        });
      if (!this.countdowns.length) return;
      this.tick();
      this.countdownTimer = setInterval(() => this.tick(), 1000);
    }

    tick() {
      const now = Date.now();
      this.countdowns.forEach((countdown) => {
        const seconds = Math.max(0, Math.floor((countdown.end - now) / 1000));
        this.renderCountdown(countdown.element, seconds);
        if (seconds === 0) this.expire(countdown.message);
      });
    }

    renderCountdown(element, total) {
      const pad = (value) => String(value).padStart(2, '0');
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      let parts;
      let separator = ':';

      switch (this.dataset.countdownFormat) {
        case 'hms':
          parts = [pad(Math.floor(total / 3600)), pad(minutes), pad(seconds)];
          break;
        case 'short':
          separator = '';
          parts = [
            days > 0 ? `${days}${this.dataset.labelDays}` : null,
            `${hours}${this.dataset.labelHours}`,
            `${minutes}${this.dataset.labelMinutes}`,
          ].filter(Boolean);
          break;
        default:
          parts = [pad(days), pad(hours), pad(minutes), pad(seconds)];
      }

      const key = parts.join('|');
      if (element.dataset.rendered === key) return;
      element.dataset.rendered = key;

      const fragment = document.createDocumentFragment();
      parts.forEach((part, i) => {
        if (i > 0 && separator) {
          const sep = document.createElement('span');
          sep.className = 'sale-banner__cd-sep';
          sep.textContent = separator;
          fragment.append(sep);
        }
        const segment = document.createElement('span');
        segment.className = 'sale-banner__cd-seg';
        segment.textContent = part;
        fragment.append(segment);
      });
      element.replaceChildren(fragment);
    }

    expire(message) {
      if (!message || message.dataset.expired) return;
      message.dataset.expired = 'true';

      if (this.dataset.expired === 'text' && message.querySelector('.sale-banner__expired')) {
        message.classList.add('is-expired');
        return;
      }

      const i = this.messages.indexOf(message);
      message.hidden = true;
      if (this.dots[i]) this.dots[i].hidden = true;

      if (this.messages.every((item) => item.hidden)) {
        this.hidden = true;
        this.pause();
        clearInterval(this.countdownTimer);
      } else if (this.isRotating && i === this.index) {
        this.step(1);
      }
    }

    /* Rotation */
    initRotation() {
      if (!this.isRotating || this.messages.length < 2) return;

      const prev = this.querySelector('.sale-banner__arrow--prev');
      const next = this.querySelector('.sale-banner__arrow--next');
      if (prev) prev.addEventListener('click', () => this.userStep(-1));
      if (next) next.addEventListener('click', () => this.userStep(1));
      this.dots.forEach((dot, i) =>
        dot.addEventListener('click', () => {
          this.show(i);
          this.restart();
        })
      );

      this.autoplay = this.dataset.autoplay === 'true';
      this.interval = (Number(this.dataset.interval) || 5) * 1000;
      if (!this.autoplay) return;

      if (this.dataset.pauseHover === 'true') {
        this.addEventListener('mouseenter', () => this.pause());
        this.addEventListener('mouseleave', () => this.play());
      }
      this.addEventListener('focusin', () => this.pause());
      this.addEventListener('focusout', (event) => {
        if (!this.contains(event.relatedTarget)) this.play();
      });
      this.play();
    }

    play() {
      if (!this.autoplay || this.hidden) return;
      this.paused = false;
      clearInterval(this.rotationTimer);
      this.rotationTimer = setInterval(() => this.step(1), this.interval);
    }

    pause() {
      this.paused = true;
      clearInterval(this.rotationTimer);
    }

    restart() {
      if (this.autoplay && !this.paused) this.play();
    }

    userStep(direction) {
      this.step(direction);
      this.restart();
    }

    step(direction) {
      const count = this.messages.length;
      let i = this.index;
      for (let k = 0; k < count; k++) {
        i = (i + direction + count) % count;
        if (!this.messages[i].hidden) return this.show(i);
      }
    }

    show(i) {
      if (i === this.index || !this.messages[i] || this.messages[i].hidden) return;
      const current = this.messages[this.index];
      const next = this.messages[i];

      current.classList.remove('is-active');
      current.classList.add('is-leaving');
      current.setAttribute('aria-hidden', 'true');
      current.setAttribute('inert', '');
      setTimeout(() => current.classList.remove('is-leaving'), 500);

      next.classList.add('is-active');
      next.removeAttribute('aria-hidden');
      next.removeAttribute('inert');

      this.dots.forEach((dot, n) => dot.setAttribute('aria-current', n === i ? 'true' : 'false'));
      this.index = i;
      this.animateTypewriter(next);
    }

    /* Typewriter: types the text of a message each time it is shown. */
    animateTypewriter(message) {
      if (this.reducedMotion || !message.classList.contains('sale-banner__message--anim-typewriter')) return;
      const text = message.querySelector('.sale-banner__text');
      if (!text) return;

      if (!text.sbNodes) {
        this.addScreenReaderCopy(text);
        text.sbNodes = [];
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) text.sbNodes.push({ node: walker.currentNode, value: walker.currentNode.textContent });
        text.style.minWidth = `${text.offsetWidth}px`;
        text.style.minHeight = `${text.offsetHeight}px`;
      }

      clearTimeout(text.sbTimer);
      const nodes = text.sbNodes;
      const total = nodes.reduce((sum, item) => sum + item.value.length, 0) || 1;
      const perChar = Math.max(20, ((Number(this.dataset.duration) || 1.5) * 1000) / total);
      nodes.forEach((item) => (item.node.textContent = ''));
      text.classList.add('is-typing');

      let nodeIndex = 0;
      let charIndex = 0;
      const typeNext = () => {
        if (nodeIndex >= nodes.length) {
          text.classList.remove('is-typing');
          if (this.dataset.loop === 'true') text.sbTimer = setTimeout(() => this.animateTypewriter(message), 2000);
          return;
        }
        const item = nodes[nodeIndex];
        charIndex++;
        item.node.textContent = item.value.slice(0, charIndex);
        if (charIndex >= item.value.length) {
          nodeIndex++;
          charIndex = 0;
        }
        text.sbTimer = setTimeout(typeNext, perChar);
      };
      text.sbTimer = setTimeout(typeNext, (Number(this.dataset.delay) || 0) * 1000);
    }
  }

  customElements.define('sale-banner', SaleBanner);
}
