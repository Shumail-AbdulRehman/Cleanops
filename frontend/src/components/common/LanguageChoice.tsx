import { Languages } from "lucide-react";
import { useLanguage } from "@/i18n/context";
export default function LanguageChoice() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div className="language-choice" role="group" aria-label={t("Language")}>
      <Languages size={18} aria-hidden="true" />
      <button
        lang="en"
        aria-pressed={language === "en"}
        onClick={() => setLanguage("en")}
      >
        English
      </button>
      <button
        lang="ur"
        dir="rtl"
        aria-pressed={language === "ur"}
        onClick={() => setLanguage("ur")}
      >
        اردو
      </button>
    </div>
  );
}
