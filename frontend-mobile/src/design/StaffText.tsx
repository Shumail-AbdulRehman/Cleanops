import * as React from 'react';
import {
  Platform,
  Text as RNText,
  useWindowDimensions,
  type AccessibilityRole,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { NativeFontsReady, fontFor, isLatinOnly } from '../fonts';
import { useLanguage } from '../i18n/LanguageProvider';
import {
  colors,
  isNarrow,
  type ColorToken,
  type FontFamilyKey,
  type TypeLanguage,
  type TypeMetrics,
  type TypeRoleName,
  type TypeVariant,
  tokens,
} from './tokens';

/** Unicode first-strong isolate (U+2068) and pop directional isolate (U+2069). */
const FSI = '⁨';
const PDI = '⁩';

/** Wraps text in first-strong isolate marks so a name, time or number keeps its own direction inside a sentence. */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

export type StaffTextAlign = 'start' | 'center' | 'end';

/** Layout-only style: the role owns face, size, line height, colour and direction. */
export type StaffTextLayoutStyle = StyleProp<
  Omit<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight' | 'fontWeight' | 'fontVariant' | 'color' | 'textAlign' | 'writingDirection'>
>;

export interface StaffTextProps {
  role: TypeRoleName;
  color?: ColorToken;
  align?: StaffTextAlign;
  numberOfLines?: number;
  /** Uses the role's compact sizes (`nowTitle`, `nowTitleLong`); ignored for other roles. */
  compact?: boolean;
  /** Plain string children go through `t()` unless false. Entered names pass false. */
  translate?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  accessibilityLabel?: string;
  testID?: string;
  style?: StaffTextLayoutStyle;
  children?: React.ReactNode;
}

/** Android font scaling is capped for these roles so small fixed-height parts cannot break. */
const cappedScaleRoles: ReadonlySet<TypeRoleName> = new Set<TypeRoleName>(['action', 'label', 'badge', 'calendarHead']);
const MAX_FONT_SCALE = 1.4;

/** Weight the system fallback face uses before the bundled fonts load. */
const fallbackWeight: Record<FontFamilyKey, TextStyle['fontWeight']> = {
  body: '400',
  bodySemi: '600',
  bodyBold: '700',
  bodyExtra: '800',
  title: '800',
  titleBold: '700',
  urdu: '400',
  urduBold: '700',
};

const urduKeys: ReadonlySet<FontFamilyKey> = new Set<FontFamilyKey>(['urdu', 'urduBold']);

function plainText(children: React.ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.length > 0 && children.every(v => typeof v === 'string' || typeof v === 'number')) {
    return children.join('');
  }
  return null;
}

function metricsFor(variant: TypeVariant, compact: boolean, narrow: boolean): TypeMetrics {
  if (compact && variant.compact) return variant.compact;
  if (narrow && variant.narrow) return variant.narrow;
  return variant;
}

function textAlignFor(align: StaffTextAlign, isRTL: boolean): TextStyle['textAlign'] {
  if (align === 'center') return 'center';
  const startIsLeft = !isRTL;
  return (align === 'start') === startIsLeft ? 'left' : 'right';
}

/** Role-based text for every redesigned screen: face, size, line height, colour and direction come from the role. */
export function StaffText({
  role,
  color = 'ink',
  align = 'start',
  numberOfLines,
  compact = false,
  translate = true,
  accessibilityRole,
  accessibilityLiveRegion,
  accessibilityLabel,
  testID,
  style,
  children,
}: StaffTextProps) {
  const { language, isRTL, t } = useLanguage();
  const fontsReady = React.useContext(NativeFontsReady);
  const { width } = useWindowDimensions();

  const plain = plainText(children);
  const content: React.ReactNode = plain !== null && translate ? t(plain) : plain ?? children;

  const roleTokens = tokens.type[role];
  const lang: TypeLanguage = language === 'ur' ? 'ur' : 'en';
  const latinInUrdu = lang === 'ur' && typeof content === 'string' && isLatinOnly(content);
  const variant = roleTokens[lang];
  const metrics = metricsFor(variant, compact, isNarrow(width));
  // A Latin-only string in Urdu keeps the English face and English line height.
  const englishVariant = roleTokens.en;
  const family: FontFamilyKey = latinInUrdu ? englishVariant.family : variant.family;
  const lineHeight = latinInUrdu ? metricsFor(englishVariant, compact, isNarrow(width)).lineHeight : metrics.lineHeight;
  // Urdu roles that keep a Latin key (input, badge) use the Latin face.
  const faceLanguage: TypeLanguage = urduKeys.has(family) ? 'ur' : 'en';
  const face = fontFor(family, faceLanguage, fontsReady);
  const fontFamily = fontsReady && Platform.OS === 'web' && faceLanguage === 'ur'
    ? `${face}, ${fontFor(englishVariant.family, 'en', true)}, sans-serif`
    : face;

  const roleStyle: TextStyle = {
    fontFamily,
    fontWeight: fontsReady ? 'normal' : fallbackWeight[family],
    fontSize: metrics.size,
    lineHeight,
    color: colors[color],
    fontVariant: ['tabular-nums'],
    writingDirection: isRTL ? 'rtl' : 'ltr',
    textAlign: textAlignFor(align, isRTL),
  };

  return (
    <RNText
      accessibilityRole={accessibilityRole}
      accessibilityLiveRegion={accessibilityLiveRegion}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      numberOfLines={numberOfLines ?? roleTokens.maxLines}
      allowFontScaling
      maxFontSizeMultiplier={cappedScaleRoles.has(role) ? MAX_FONT_SCALE : undefined}
      style={[roleStyle, style]}
    >
      {content}
    </RNText>
  );
}

export interface NameLineProps {
  role: TypeRoleName;
  color?: ColorToken;
  /** An entered name (task, area, location, company, person). Never translated. */
  name: string;
  numberOfLines?: number;
  compact?: boolean;
}

/** An entered name on its own isolated line, aligned to the screen's start side. */
export function NameLine({ role, color, name, numberOfLines, compact }: NameLineProps) {
  return (
    <StaffText role={role} color={color} align="start" translate={false} numberOfLines={numberOfLines} compact={compact}>
      {isolate(name)}
    </StaffText>
  );
}

export interface LabeledNameProps {
  role: TypeRoleName;
  color?: ColorToken;
  /** English key holding an `{area}` placeholder, for example "Next: {area}". */
  labelKey: string;
  /** The entered name that fills `{area}`. */
  name: string;
  /** Other placeholder values in the label. */
  values?: Record<string, string | number>;
  compact?: boolean;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => (key in values ? String(values[key]) : token));
}

/**
 * English: one text, label with the isolated name in place of `{area}`.
 * Urdu: the label without the name on one line, then the name on its own line, so it never sits inside an Urdu sentence.
 */
export function LabeledName({ role, color, labelKey, name, values = {}, compact }: LabeledNameProps) {
  const { language, t } = useLanguage();
  const template = t(labelKey);
  if (language !== 'ur') {
    return (
      <StaffText role={role} color={color} translate={false} compact={compact}>
        {fill(template, { ...values, area: isolate(name) })}
      </StaffText>
    );
  }
  const label = fill(template.replace(/\{area\}/g, ''), values).replace(/\s+/g, ' ').trim();
  return (
    <>
      <StaffText role={role} color={color} translate={false} compact={compact}>
        {label}
      </StaffText>
      <NameLine role={role} color={color} name={name} compact={compact} />
    </>
  );
}
