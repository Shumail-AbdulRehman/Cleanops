// Design tokens for the staff phone app redesign.
// Every value here is transcribed from specs-mobile-redesign/DESIGN-SYSTEM.md.
// This file and DESIGN-SYSTEM.md are the only places a raw hex value may appear in new code.
// Plain frozen data and pure helpers only: no React or React Native imports.

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------- colour

export const colors = deepFreeze({
  ink: "#141c30",
  muted: "#55617a",
  subtle: "#98a4b8",
  offDay: "#667389",
  future: "#b5bfd0",
  pillText: "#3b475e",
  line: "#e3e8f0",
  lineStrong: "#cbd4e2",
  canvas: "#f2f5fb",
  segmentTrack: "#e4e9f3",
  surface: "#ffffff",
  soft: "#f7f9fc",
  blue: "#2556d8",
  blueDeep: "#1a3ba3",
  blueWash: "#eaf0ff",
  onBlue: "#dbe5ff",
  onDarkSoft: "#e9edf5",
  onCamera: "#d6deed",
  bannerSoft: "#c9d3e6",
  yellow: "#ffd21f",
  yellowPress: "#f0c000",
  yellowWash: "#fff6d0",
  yellowInk: "#5a4300",
  ok: "#16613d",
  okWash: "#e4f4ea",
  bad: "#a32128",
  badDeep: "#7f1a20",
  badWash: "#fdeeed",
  warn: "#7b4200",
  warnWash: "#fff1dc",
  late: "#f08a3c",
  night: "#0e1526",
  night2: "#1a2439",
  tintBg: "#dfe8fc",
  tintFg: "#4f77d6",
  scrim: "#0e152680",
  cameraButton: "#ffffff24",
} as const);

export type ColorToken = keyof typeof colors;

/**
 * Translucent white on the blue top (v3 style.css), kept apart from `colors` because DESIGN-SYSTEM.md's
 * colour table lists only solid colours. Rail tick 7 percent, language pill track 16, skeleton block 22,
 * rail track 26. The 14 percent value is `colors.cameraButton`.
 */
export const whiteAlpha = deepFreeze({
  tick: "#ffffff12",
  track: "#ffffff29",
  block: "#ffffff38",
  rail: "#ffffff42",
} as const);

// ---------------------------------------------------------------- type

/**
 * Font role keys. Spec 03's `fontFor(family, language, fontsReady)` maps them to real families:
 * `body` Inter Regular, `bodySemi` Inter SemiBold, `bodyBold` Inter Bold, `bodyExtra` Inter ExtraBold,
 * `title` Manrope ExtraBold, `titleBold` Manrope Bold, `urdu` Noto Arabic Regular, `urduBold` Noto Arabic Bold.
 */
export type FontFamilyKey =
  | "body"
  | "bodySemi"
  | "bodyBold"
  | "bodyExtra"
  | "title"
  | "titleBold"
  | "urdu"
  | "urduBold";

export interface TypeMetrics {
  /** Font size in px. */
  readonly size: number;
  /** Line height in px. */
  readonly lineHeight: number;
}

export interface TypeVariant extends TypeMetrics {
  readonly family: FontFamilyKey;
  /** Sizes used in My day compact (after check-in). */
  readonly compact?: TypeMetrics;
  /** Sizes used when the window is narrower than `space.narrowWidth`. */
  readonly narrow?: TypeMetrics;
}

export interface TypeRole {
  readonly en: TypeVariant;
  readonly ur: TypeVariant;
  /** Maximum number of lines the design allows. */
  readonly maxLines?: number;
}

export type TypeLanguage = "en" | "ur";

const typeRoles = {
  nowTitle: {
    en: { family: "title", size: 31, lineHeight: 36, compact: { size: 26, lineHeight: 30 } },
    ur: { family: "urduBold", size: 28, lineHeight: 43, compact: { size: 23, lineHeight: 33 } },
  },
  nowTitleCompact: {
    en: { family: "title", size: 26, lineHeight: 30 },
    ur: { family: "urduBold", size: 23, lineHeight: 33 },
  },
  nowTitleLong: {
    en: { family: "title", size: 27, lineHeight: 32, compact: { size: 23, lineHeight: 27 } },
    ur: { family: "urduBold", size: 25, lineHeight: 40, compact: { size: 23, lineHeight: 33 } },
    maxLines: 3,
  },
  pageTitle: {
    en: { family: "title", size: 30, lineHeight: 35 },
    ur: { family: "urduBold", size: 27, lineHeight: 43 },
  },
  headline: {
    en: { family: "title", size: 27, lineHeight: 32 },
    ur: { family: "urduBold", size: 25, lineHeight: 40 },
  },
  moment: {
    en: { family: "title", size: 30, lineHeight: 35 },
    ur: { family: "urduBold", size: 25, lineHeight: 40 },
  },
  cameraTitle: {
    en: { family: "title", size: 25, lineHeight: 30 },
    ur: { family: "urduBold", size: 25, lineHeight: 40 },
  },
  sheetTitle: {
    en: { family: "title", size: 21, lineHeight: 26 },
    ur: { family: "urduBold", size: 21, lineHeight: 35 },
  },
  sectionTitle: {
    en: { family: "title", size: 20, lineHeight: 25 },
    ur: { family: "urduBold", size: 20, lineHeight: 29 },
  },
  barTitle: {
    en: { family: "titleBold", size: 18, lineHeight: 23 },
    ur: { family: "urduBold", size: 18, lineHeight: 31 },
  },
  groupTitle: {
    en: { family: "titleBold", size: 16.5, lineHeight: 21 },
    ur: { family: "urduBold", size: 16.5, lineHeight: 28 },
  },
  action: {
    en: { family: "title", size: 19, lineHeight: 24 },
    ur: { family: "urduBold", size: 19, lineHeight: 27 },
  },
  body: {
    en: { family: "body", size: 16, lineHeight: 23 },
    ur: { family: "urdu", size: 17, lineHeight: 31 },
  },
  rowTitle: {
    en: { family: "bodySemi", size: 16.5, lineHeight: 21 },
    ur: { family: "urduBold", size: 16.5, lineHeight: 23 },
  },
  meta: {
    en: { family: "body", size: 14.5, lineHeight: 20 },
    ur: { family: "urdu", size: 14.5, lineHeight: 22 },
  },
  label: {
    en: { family: "bodySemi", size: 14, lineHeight: 20 },
    ur: { family: "urduBold", size: 15, lineHeight: 27 },
  },
  fieldLabel: {
    en: { family: "bodySemi", size: 15.5, lineHeight: 22 },
    ur: { family: "urduBold", size: 17, lineHeight: 30 },
  },
  // Text inside fields stays Latin and left-to-right in both languages.
  input: {
    en: { family: "body", size: 17, lineHeight: 24 },
    ur: { family: "body", size: 17, lineHeight: 24 },
  },
  // Tab badge number: the one place below 14. A number, so it keeps the Latin face.
  badge: {
    en: { family: "bodyBold", size: 13, lineHeight: 16 },
    ur: { family: "bodyBold", size: 13, lineHeight: 16 },
  },
  calendarHead: {
    en: { family: "bodySemi", size: 14, lineHeight: 18 },
    ur: { family: "urduBold", size: 14.5, lineHeight: 20, narrow: { size: 13, lineHeight: 18 } },
  },
} satisfies Record<string, TypeRole>;

export type TypeRoleName = keyof typeof typeRoles;

export const type: Readonly<Record<TypeRoleName, TypeRole>> = deepFreeze(typeRoles);

// ---------------------------------------------------------------- spacing and size

export const space = deepFreeze({
  /** Page and row side padding. */
  gutter: 20,
  /** Page and row side padding below `narrowWidth`. */
  gutterNarrow: 16,
  /** Window width below which narrow rules apply. */
  narrowWidth: 375,
  rowMinHeight: 76,
  /** Task row in My day compact. */
  rowMinHeightCompact: 64,
  rowPadV: 13,
  rowPadVCompact: 8,
  /** Round status marker diameter. */
  markerSize: 34,
  /** Marker to text gap. */
  rowGap: 14,
  rowGapNarrow: 12,
  /** Big action button. */
  actionHeight: 64,
  /** Text-style action under a big action. */
  ghostHeight: 52,
  dockPadTop: 10,
  dockPadSide: 16,
  /** Plus the bottom safe-area inset. */
  dockPadBottom: 12,
  fieldHeight: 60,
  chipHeight: 44,
  segmentHeight: 44,
  /** Padding of the segmented control track around the segments. */
  segmentTrackPad: 4,
  touchMin: 44,
  /** Icon-only buttons. */
  touchMinIcon: 48,
  tabMinHeight: 60,
  tabPipWidth: 62,
  tabPipHeight: 32,
  /** How far My day's white sheet overlaps the blue top. */
  workSheetOverlap: 26,
  /** Fixture tile square. */
  tileSize: 42,
  /** Receipt badge square. */
  badgeOkSize: 96,
  /** Camera shutter diameter. */
  shutter: 80,
  /** Dark gap between the shutter and its ring. */
  shutterGap: 4,
  /** White ring around the shutter. */
  shutterRing: 4,
  avatar: 44,
  /** Avatar in My day compact. */
  avatarCompact: 38,
  /** Avatar on Profile. */
  avatarProfile: 76,
  /** Tab bar: padding above and below the items, and the gap between the pip and its label. */
  tabBarPadTop: 8,
  tabBarPadBottom: 4,
  tabPipLabelGap: 6,
  /** StaffText caps `label` scaling at 1.4; the bar grows with it so labels are never cut. */
  tabLabelScaleCap: 1.4,
  /** Clear space between the message bar and the tab bar. */
  snackAboveBar: 12,
} as const);

export const radius = deepFreeze({
  actionRadius: 18,
  fieldRadius: 16,
  chipRadius: 22,
  segmentTrackRadius: 14,
  segmentThumbRadius: 11,
  tabPipRadius: 16,
  /** Bottom sheet top corners and dialog. */
  sheetRadius: 26,
  /** My day white sheet top corners. */
  workSheetRadius: 28,
  /** Fact tables, receipts. */
  cardRadius: 18,
  /** Fixture tiles. */
  tileRadius: 12,
  badgeOkRadius: 30,
  /** Pills (fully rounded). */
  pillRadius: 999,
} as const);

// ---------------------------------------------------------------- motion

export type CubicBezier = readonly [number, number, number, number];

export const motion = deepFreeze({
  /** Durations in ms. */
  duration: {
    press: 120,
    nowChange: 220,
    sheet: 280,
    scrim: 200,
    dialog: 180,
    snack: 200,
    busy: 180,
    scanLine: 1900,
    locateRing: 1500,
    badge: 340,
    tickDraw: 300,
    tickDelay: 120,
    reducedFade: 120,
  },
  /** Cubic-bezier control points (x1, y1, x2, y2). */
  easing: {
    easeOut: [0.23, 1, 0.32, 1] as CubicBezier,
    drawer: [0.32, 0.72, 0, 1] as CubicBezier,
  },
  /** Press scales. */
  scale: {
    press: 0.97,
    shutter: 0.93,
  },
} as const);

// ---------------------------------------------------------------- helpers

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`contrast() needs a 6-digit hex colour, got "${color}"`);
  }
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 2) + 0.0722 * channel(hex, 4);
}

/** WCAG 2 contrast ratio of two 6-digit hex colours (order does not matter). */
export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Height of the staff tab bar: the one formula for the bar and for anything that must sit above it. */
export function tabBarHeight(insetBottom: number, labelLineHeight: number, fontScale: number): number {
  const scale = Math.min(Math.max(fontScale || 1, 1), space.tabLabelScaleCap);
  const item = Math.max(space.tabMinHeight, space.tabPipHeight + space.tabPipLabelGap + Math.ceil(labelLineHeight * scale));
  return space.tabBarPadTop + item + space.tabBarPadBottom + insetBottom;
}

/** True when the window is narrower than `space.narrowWidth`. */
export function isNarrow(width: number): boolean {
  return width < space.narrowWidth;
}

/** Page side padding for a window width: 20, or 16 below `narrowWidth`. */
export function gutterFor(width: number): number {
  return isNarrow(width) ? space.gutterNarrow : space.gutter;
}

export const tokens = deepFreeze({ colors, whiteAlpha, type, space, radius, motion });
