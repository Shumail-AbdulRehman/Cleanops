import * as React from "react";
import { Text as RNText, Platform, StyleSheet, type TextProps } from "react-native";
import { NativeFontsReady, nativeFontFamily } from '../../fonts';
import { useLanguage } from "../../i18n/LanguageProvider";
import { translateText } from "../../i18n/translations";
import { cn } from "../../lib/utils";

const Text = React.forwardRef<RNText, TextProps>(
  ({ className, children, style, ...props }, ref) => {
    const { language, isRTL } = useLanguage();
    const fontsReady = React.useContext(NativeFontsReady);
    const weight = StyleSheet.flatten(style)?.fontWeight;
    const emphasized = /(?:^|\s)font-(?:medium|semibold|bold|extrabold|black)(?:\s|$)/.test(className ?? '') || weight === 'bold' || Number(weight) >= 500;
    const content =
      typeof children === "string"
        ? translateText(children, language)
        : Array.isArray(children) &&
            children.every(
              (v) => typeof v === "string" || typeof v === "number",
            )
          ? translateText(children.join(""), language)
          : children;
    const textLanguage = typeof content === 'string' && /[A-Za-z]/.test(content) && !/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/.test(content) ? 'en' : language;
    const loadedFamily = nativeFontFamily(textLanguage, emphasized);
    return (
      <RNText
        ref={ref}
        className={cn("text-foreground", className)}
        {...props}
        style={[
          {
            fontFamily: fontsReady ? Platform.OS === 'web' ? `${loadedFamily}, ${nativeFontFamily('en', emphasized)}, sans-serif` : loadedFamily : Platform.OS === "web" ? "system-ui, -apple-system, sans-serif" : Platform.OS === "android" ? "sans-serif" : "System",
            ...(fontsReady ? { fontWeight: 'normal' as const } : {}),
            writingDirection: isRTL ? "rtl" : "ltr",
            textAlign: isRTL ? "right" : "left",
          },
          style,
        ]}
      >
        {content}
      </RNText>
    );
  },
);
Text.displayName = "Text";

export { Text };
