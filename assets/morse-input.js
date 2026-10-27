if (!customElements.get('morse-input')) {
  const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
    K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
    U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
    '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', _: '..--.-', '"': '.-..-.',
    $: '...-..-', '@': '.--.-.',
  };

  const LETTER_GAPS = { space: ' ', wide: '   ', bar: ' | ' };
  const WORD_GAPS = { slash: ' / ', wide: '       ', bar: ' || ' };
  const SPECIAL_LETTERS = { ß: 'ss', æ: 'ae', Æ: 'AE', ø: 'o', Ø: 'O', œ: 'oe', Œ: 'OE', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L' };

  customElements.define(
    'morse-input',
    class MorseInput extends HTMLElement {
      connectedCallback() {
        this.config = JSON.parse(this.querySelector('[data-morse-config]').textContent);
        this.field = this.querySelector('[data-morse-name]');
        this.valueInput = this.querySelector('[data-morse-value]');
        this.output = this.querySelector('[data-morse-output]');
        this.counter = this.querySelector('[data-morse-counter]');
        this.error = this.querySelector('[data-morse-error]');

        this.onInput = this.onInput.bind(this);
        this.onSubmit = this.onSubmit.bind(this);
        this.onCheckoutClick = this.onCheckoutClick.bind(this);
        this.onOptionChange = this.onOptionChange.bind(this);

        this.field.addEventListener('input', this.onInput);
        this.field.addEventListener('blur', () => this.touched && this.validate());
        document.addEventListener('submit', this.onSubmit, true);
        document.addEventListener('click', this.onCheckoutClick, true);
        document.addEventListener('change', this.onOptionChange);
        if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          this.variantChangeUnsubscriber = subscribe(PUB_SUB_EVENTS.variantChange, this.onOptionChange);
        }

        this.render();
        this.updateVisibility();
      }

      disconnectedCallback() {
        document.removeEventListener('submit', this.onSubmit, true);
        document.removeEventListener('click', this.onCheckoutClick, true);
        document.removeEventListener('change', this.onOptionChange);
        if (this.variantChangeUnsubscriber) this.variantChangeUnsubscriber();
      }

      get form() {
        return document.getElementById(this.dataset.formId);
      }

      get isActive() {
        return !this.field.disabled;
      }

      onInput() {
        this.touched = true;
        const raw = this.field.value;
        const caret = this.field.selectionStart ?? raw.length;
        const before = this.clean(raw.slice(0, caret));
        const cleaned = this.clean(raw);

        if (cleaned.removed) this.showError(this.config.messages.invalid, true);
        else if (this.error.dataset.temporary) this.clearError();

        if (cleaned.text !== raw) {
          this.field.value = cleaned.text;
          const position = Math.min(before.text.length, cleaned.text.length);
          this.field.setSelectionRange(position, position);
        }

        this.render();
        if (this.error.hidden === false && !this.error.dataset.temporary) this.validate();
      }

      // Removes characters the merchant didn't allow, applies the letter case and the character limit.
      clean(value) {
        const c = this.config;
        let text = value;
        if (c.convertAccents) {
          text = text
            .replace(/[ßæÆøØœŒđĐłŁ]/g, (ch) => SPECIAL_LETTERS[ch])
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '');
        }

        let removed = false;
        let result = '';
        for (const ch of text) {
          const upper = ch.toUpperCase();
          const allowed =
            (c.allowLetters && /^[A-Z]$/.test(upper)) ||
            (c.allowNumbers && /^[0-9]$/.test(ch)) ||
            (c.allowSpaces && ch === ' ') ||
            (c.allowPunctuation && !/^[A-Z0-9 ]$/.test(upper) && MORSE[ch] !== undefined);
          if (allowed) result += ch;
          else removed = true;
        }

        result = result.replace(/ {2,}/g, ' ').replace(/^ /, '');
        if (c.textCase === 'upper') result = result.toUpperCase();
        if (c.textCase === 'capitalize') result = result.replace(/(^|[ \-'])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
        if (result.length > c.max) {
          result = result.slice(0, c.max);
          removed = true;
        }
        return { text: result, removed };
      }

      // Returns one entry per word, each a list of [character, code] pairs.
      toMorse(text) {
        return text
          .trim()
          .split(' ')
          .filter(Boolean)
          .map((word) => [...word.toUpperCase()].map((ch) => [ch, MORSE[ch] || '']).filter(([, code]) => code));
      }

      format(words, dot, dash) {
        const letterGap = LETTER_GAPS[this.config.letterGap] ?? ' ';
        const wordGap = WORD_GAPS[this.config.wordGap] ?? ' / ';
        return words
          .map((word) => word.map(([, code]) => this.symbols(code, dot, dash)).join(letterGap))
          .join(wordGap);
      }

      symbols(code, dot, dash) {
        return code.replace(/\./g, '\u0000').replace(/-/g, dash).replace(/\u0000/g, dot);
      }

      render() {
        const c = this.config;
        const text = this.field.value.trim();
        const words = this.toMorse(text);

        if (this.counter) this.counter.textContent = `${this.field.value.length}/${c.max}`;

        if (this.valueInput) {
          const orderValue =
            c.orderSymbols === 'display' ? this.format(words, c.dot, c.dash) : this.format(words, '.', '-');
          this.valueInput.value = orderValue;
          this.valueInput.disabled = !this.isActive || orderValue === '';
        }

        if (!this.output) return;
        this.output.replaceChildren();
        if (!words.length) {
          const empty = document.createElement('span');
          empty.className = 'morse-input__empty';
          empty.textContent = c.emptyText || '';
          this.output.append(empty);
          return;
        }

        if (c.previewStyle === 'letters') {
          words.forEach((word, index) => {
            if (index > 0) {
              const gap = document.createElement('span');
              gap.className = 'morse-input__word-gap';
              gap.setAttribute('aria-hidden', 'true');
              this.output.append(gap);
            }
            word.forEach(([ch, code]) => {
              const cell = document.createElement('span');
              cell.className = 'morse-input__cell';
              const symbols = document.createElement('span');
              symbols.className = 'morse-input__cell-code';
              symbols.textContent = this.symbols(code, c.dot, c.dash);
              const letter = document.createElement('span');
              letter.className = 'morse-input__cell-letter';
              letter.textContent = ch;
              cell.append(symbols, letter);
              this.output.append(cell);
            });
          });
        } else {
          const line = document.createElement('span');
          line.className = 'morse-input__line';
          line.textContent = this.format(words, c.dot, c.dash);
          this.output.append(line);
        }
      }

      validate() {
        if (!this.isActive) return true;
        const c = this.config;
        const length = this.field.value.trim().length;
        if (c.required && length === 0) return this.showError(c.messages.required);
        if (length > 0 && length < c.min) return this.showError(c.messages.min.replace('[min]', c.min));
        this.clearError();
        return true;
      }

      showError(message, temporary = false) {
        this.error.textContent = message;
        this.error.hidden = false;
        this.classList.add('morse-input--invalid');
        if (temporary) {
          this.error.dataset.temporary = 'true';
          clearTimeout(this.errorTimer);
          this.errorTimer = setTimeout(() => this.error.dataset.temporary && this.clearError(), 2500);
        } else {
          delete this.error.dataset.temporary;
          this.field.setAttribute('aria-invalid', 'true');
        }
        return false;
      }

      clearError() {
        clearTimeout(this.errorTimer);
        this.error.hidden = true;
        this.error.textContent = '';
        delete this.error.dataset.temporary;
        this.classList.remove('morse-input--invalid');
        this.field.removeAttribute('aria-invalid');
      }

      // Runs before the theme's add-to-cart handler; stops the submit while this field is invalid.
      onSubmit(event) {
        if (event.target !== this.form) return;
        this.touched = true;
        if (this.validate()) return;
        this.blockEvent(event);
      }

      onCheckoutClick(event) {
        const button = event.target.closest?.('.shopify-payment-button');
        if (!button || button.closest('form') !== this.form) return;
        this.touched = true;
        if (this.validate()) return;
        this.blockEvent(event);
      }

      blockEvent(event) {
        const firstInvalid = !event.defaultPrevented;
        event.preventDefault();
        event.stopPropagation();
        if (firstInvalid) {
          this.field.focus({ preventScroll: true });
          this.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      onOptionChange(event) {
        const sectionId = event?.data?.sectionId;
        if (sectionId && sectionId !== this.dataset.sectionId) return;
        if (event instanceof Event && !event.target.closest?.(`#variant-selects-${this.dataset.sectionId}`)) return;
        this.updateVisibility();
      }

      // Selected value of each product option, in picker order (option 1 = first).
      selectedOptions() {
        const picker = document.getElementById(`variant-selects-${this.dataset.sectionId}`);
        if (!picker) return [];
        return [...picker.querySelectorAll('.product-form__input')].map((group) => {
          const select = group.querySelector('select');
          if (select) return select.value;
          return group.querySelector('input[type="radio"]:checked')?.value ?? '';
        });
      }

      updateVisibility() {
        const c = this.config;
        let visible = true;

        if (c.conditions.length) {
          const selected = this.selectedOptions();
          const results = c.conditions.map(({ option, operator, value }) => {
            const current = (selected[option - 1] || '').trim().toLowerCase();
            const values = value
              .split(',')
              .map((v) => v.trim().toLowerCase())
              .filter(Boolean);
            const matches =
              operator === 'contains'
                ? values.some((v) => current.includes(v))
                : values.includes(current);
            return operator === 'is_not' ? !matches : matches;
          });
          const met = c.conditionLogic === 'any' ? results.some(Boolean) : results.every(Boolean);
          visible = c.conditionAction === 'hide' ? !met : met;
        }

        // In the theme editor the field stays visible (dimmed) so it can still be selected and edited.
        if (window.Shopify?.designMode) this.classList.toggle('morse-input--editor-hidden', !visible);
        else this.hidden = !visible;
        this.field.disabled = !visible;
        if (!visible) this.clearError();
        this.render();
      }
    }
  );
}
