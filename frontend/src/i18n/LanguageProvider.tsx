import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LanguageContext } from "./context";
import { translate, type Language } from "./translations";
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem("hygene-ops.language") === "ur" ? "ur" : "en";
    } catch {
      return "en";
    }
  });
  useEffect(() => {
    document.documentElement.lang = language === "ur" ? "ur-PK" : "en-PK";
    document.documentElement.dir = language === "ur" ? "rtl" : "ltr";
    try {
      localStorage.setItem("hygene-ops.language", language);
    } catch {
      /* Session choice still works. */
    }
  }, [language]);
  const t = useCallback(
    (text: string, values?: Record<string, string | number>) =>
      translate(text, language, values),
    [language],
  );
  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
