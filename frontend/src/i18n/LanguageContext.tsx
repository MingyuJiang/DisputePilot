/**
 * Language context + `t()`.
 *
 * The provider is mounted once at the app root. Components rendered without a
 * provider (unit tests, isolated stories) fall back to the persisted language,
 * so `useT()` is always safe to call.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate, type MessageKey, type TranslateParams } from "./messages";
import {
  persistLang,
  readStoredLang,
  setActiveLang,
  type Lang,
} from "./locale";

export type { Lang, MessageKey, TranslateParams };

/** Re-exported so components only import from the i18n entry point. */
export { translate };

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

/** Fallback language is read once, before any component renders. */
const LanguageContext = createContext<LanguageContextValue>({
  lang: readStoredLang(),
  setLang: () => undefined,
});

export function LanguageProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  /** Test/SSR hook; production uses the persisted value (zh-CN default). */
  initialLang?: Lang;
}) {
  const [lang, setLang] = useState<Lang>(() => initialLang ?? readStoredLang());

  // Formatting helpers are module-level functions, so the active locale must be
  // updated before children render (not in an effect, which would lag by a frame).
  setActiveLang(lang);

  useEffect(() => {
    persistLang(lang);
    document.documentElement.lang = lang;
    document.title = translate(lang, "app.documentTitle");
  }, [lang]);

  const change = useCallback((next: Lang) => {
    persistLang(next);
    setLang(next);
  }, []);

  const value = useMemo(() => ({ lang, setLang: change }), [lang, change]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export interface UseI18nResult extends LanguageContextValue {
  t: (key: MessageKey, params?: TranslateParams) => string;
}

export const useI18n = (): UseI18nResult => {
  const { lang, setLang } = useContext(LanguageContext);
  const t = useCallback(
    (key: MessageKey, params?: TranslateParams) => translate(lang, key, params),
    [lang],
  );
  return { lang, setLang, t };
};

/** Convenience hook for components that only need the translator. */
export const useT = () => useI18n().t;

export { DEFAULT_LANG, LANG_STORAGE_KEY } from "./locale";
