/**
 * Language primitives shared by the React context and the formatters.
 *
 * The UI language is a pure presentation setting: it never changes ids,
 * statuses or any value that comes from the backend. `dp.demo.lang` is the
 * persisted key; zh-CN is the default for this demo.
 */

export type Lang = "zh-CN" | "en";

export const LANG_STORAGE_KEY = "dp.demo.lang";

export const DEFAULT_LANG: Lang = "zh-CN";

const isLang = (value: string | null): value is Lang => value === "zh-CN" || value === "en";

/** Read the persisted language; storage can throw in private/sandboxed modes. */
export const readStoredLang = (): Lang => {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
};

export const persistLang = (lang: Lang): void => {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Presentation preference only — a blocked storage must not break the app.
  }
};

let activeLang: Lang = readStoredLang();

/**
 * Non-React formatters (money/date) read this. The provider updates it before
 * rendering children, so a language switch re-formats in the same pass.
 */
export const setActiveLang = (lang: Lang): void => {
  activeLang = lang;
};

export const getActiveLang = (): Lang => activeLang;

/** BCP-47 locale used by Intl for each UI language. */
export const intlLocale = (lang: Lang = activeLang): string =>
  lang === "zh-CN" ? "zh-CN" : "en-US";
