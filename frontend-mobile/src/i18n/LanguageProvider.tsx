import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { translate, type Language } from "./translations";
const Context = createContext({
  language: "en" as Language,
  isRTL: false,
  setLanguage: (_language: Language) => {},
  t: (text: string, values?: Record<string, string | number>) =>
    translate(text, "en", values),
});
export const useLanguage = () => useContext(Context);
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setValue] = useState<Language>("en");
  const changed = useRef(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    void import("@react-native-async-storage/async-storage")
      .then(async ({ default: storage }) => {
        const saved = await storage.getItem("hygene-ops.language");
        if (live && !changed.current && saved === "ur") setValue("ur");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const setLanguage = (value: Language) => {
    changed.current = true;
    setValue(value);
    writes.current = writes.current
      .then(async () => {
        const { default: storage } =
          await import("@react-native-async-storage/async-storage");
        await storage.setItem("hygene-ops.language", value);
      })
      .catch(() => {});
  };
  return (
    <Context.Provider
      value={{
        language,
        isRTL: language === "ur",
        setLanguage,
        t: (text, values) => translate(text, language, values),
      }}
    >
      {children}
    </Context.Provider>
  );
}
