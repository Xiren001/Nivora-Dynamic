// "Ships by [date]" for the Trust Stack shipping row. Liquid prints an estimate
// at render time; this recalculates on load so cached pages stay correct.
if (!customElements.get('trust-ship-date')) {
  customElements.define(
    'trust-ship-date',
    class TrustShipDate extends HTMLElement {
      connectedCallback() {
        try {
          const date = this.calculate();
          this.textContent = this.format(date);
          this.setAttribute('datetime', date.toISOString().slice(0, 10));
        } catch (error) {
          // Keep the server-rendered date
        }
      }

      // Store-local "now" as { y, m, d, hour }
      storeNow() {
        const timeZone = this.dataset.timezone;
        if (timeZone) {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23',
          })
            .formatToParts(new Date())
            .reduce((acc, part) => ({ ...acc, [part.type]: parseInt(part.value, 10) }), {});
          return { y: parts.year, m: parts.month, d: parts.day, hour: parts.hour % 24 };
        }

        // Fall back to the shop's UTC offset printed by Liquid, e.g. "+0200"
        const match = /^([+-])(\d{2})(\d{2})$/.exec(this.dataset.offset || '');
        const offsetMinutes = match ? (match[1] === '-' ? -1 : 1) * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10)) : 0;
        const local = new Date(Date.now() + offsetMinutes * 60000);
        return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(), hour: local.getUTCHours() };
      }

      calculate() {
        const { y, m, d, hour } = this.storeNow();
        const processing = Math.max(0, parseInt(this.dataset.processing, 10) || 0);
        const cutoff = parseInt(this.dataset.cutoff, 10);
        const skipWeekends = this.dataset.skipWeekends === 'true';
        const holidays = new Set((this.dataset.holidays || '').split(',').map((s) => s.trim()).filter(Boolean));

        // Work in UTC so adding days never trips over DST
        const day = new Date(Date.UTC(y, m - 1, d));
        if (!Number.isNaN(cutoff) && hour >= cutoff) day.setUTCDate(day.getUTCDate() + 1);

        const isBusinessDay = (date) => {
          const weekday = date.getUTCDay();
          if (skipWeekends && (weekday === 0 || weekday === 6)) return false;
          return !holidays.has(date.toISOString().slice(0, 10));
        };

        let remaining = processing;
        for (let i = 0; i < 60; i++) {
          if (isBusinessDay(day)) {
            if (remaining === 0) break;
            remaining--;
          }
          day.setUTCDate(day.getUTCDate() + 1);
        }
        return day;
      }

      format(date) {
        const options = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
        const locales = [this.dataset.locale, (this.dataset.locale || '').split('-')[0], 'en-US'].filter(Boolean);
        for (const locale of locales) {
          try {
            return new Intl.DateTimeFormat(locale, options).format(date);
          } catch (error) {
            // Try the next locale
          }
        }
        return date.toISOString().slice(0, 10);
      }
    }
  );
}
