import { createContext, useContext } from "react";
import { translate, type Language } from "./translations";
export const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string, values?: Record<string, string | number>) => string;
}>({
  language: "en",
  setLanguage: () => {},
  t: (text: string, values?: Record<string, string | number>) =>
    translate(text, "en", values),
});
export const useLanguage = () => useContext(LanguageContext);
