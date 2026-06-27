/** The languages of the user interface. */
export type Locale = 'de' | 'en';

const LOCALE_KEY = 'callisto.locale';

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === 'de' || stored === 'en') {
      return stored;
    }
  } catch {
    // Without storage the browser's language decides.
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/**
 * The language of this page load. Switching reloads the page, so texts can be resolved once and
 * kept in plain constants, also outside of components.
 */
export const locale: Locale = detectLocale();

/** The locale for `Intl` formatting; British English keeps day-first dates and the 24-hour clock. */
export const intlLocale = locale === 'de' ? 'de-DE' : 'en-GB';

document.documentElement.lang = locale;

/** Switches the user interface to another language. */
export function setLocale(next: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, next);
  } catch {
    // Nothing to remember it in; the reload falls back to the browser's language.
  }
  window.location.reload();
}

/** The texts of the current language. The English texts must have the shape of the German ones. */
export function localized<T>(texts: { de: T; en: NoInfer<T> }): T {
  return texts[locale];
}
