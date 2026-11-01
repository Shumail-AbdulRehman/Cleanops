import * as React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Icon, type LucideIconName } from '../../components/ui/icon';
import { Avatar } from '../../design/Avatar';
import { Skeleton } from '../../design/Feedback';
import { LanguageToggle } from '../../design/LanguageToggle';
import { LabeledName, NameLine, StaffText, isolate } from '../../design/StaffText';
import { clock, shortDay } from '../../design/format';
import { colors, gutterFor, motion, radius, space, tokens, whiteAlpha, type ColorToken, type TypeRoleName } from '../../design/tokens';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { NowRail, NowState, NowText, NowTone } from './nowState';

export interface DayHeaderProps {
  /** The `nowState` result. Ignored while `loading`. */
  state: NowState;
  firstName: string;
  today: Date;
  /** IANA zone for the date and rail times; defaults to the device zone. */
  timeZone?: string;
  onAvatarPress: () => void;
  loading?: boolean;
}

const background: Record<NowTone, ColorToken> = { blue: 'blue', quiet: 'night2', bad: 'badDeep', ok: 'ok' };

/**
 * The sky colour behind the header for this state. My day paints the fixed status-bar band
 * above its scroll view in the same colour; the header itself carries no top inset (spec 67).
 */
export function skyColor(state: NowState, loading = false): ColorToken {
  return background[loading ? 'blue' : state.tone];
}

/** Entered names longer than this use the long title role. */
const LONG_NAME = 22;

// Layout values the design draws that have no token (DESIGN-SYSTEM lists no My day header sizes).
const layout = {
  padBottom: 46,
  padBottomCompact: 32,
  whoMinHeight: 52,
  titleTop: 18,
  titleTopCompact: 8,
  subTop: 8,
  subTopCompact: 4,
  railTop: 12,
  railRowTop: 8,
  railTrack: 4,
  railDot: 14,
  railDotBorder: 3,
  railIcon: 16,
  railIconGap: 5,
  tick: 250,
  tickTop: 40,
  tickOutset: -46,
  pinIcon: 17,
  pinGap: 6,
  railRowGap: 10,
  /** About 32 characters of `body` per line. */
  subMaxWidthEm: 20,
} as const;

const TICK_COLOR = whiteAlpha.tick;
const TRACK_COLOR = whiteAlpha.rail;

const isolated = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, isolate(value)]));

/**
 * Urdu keeps an entered place or task title out of the sentence. Each entry names the
 * shorter sentence said without the name and whether the name line comes first.
 */
const urduSplit: Record<string, { rest: string; nameFirst: boolean; pin: boolean }> = {
  'Your shift starts at {time} at {place}.': { rest: 'Your shift starts at {time}.', nameFirst: false, pin: true },
  'Take a selfie at {place}. Keep location on.': { rest: 'Take a selfie at your location. Keep location on.', nameFirst: false, pin: true },
  '{title}. Finish by {time}.': { rest: 'Finish by {time}.', nameFirst: true, pin: false },
};

function Sentence({ title, sub, compact, tone }: { title: NowText; sub: NowText; compact: boolean; tone: NowTone }) {
  const { language, isRTL, t } = useLanguage();
  const long = (title.name?.length ?? 0) > LONG_NAME;
  const titleRole: TypeRoleName = long ? 'nowTitleLong' : compact ? 'nowTitleCompact' : 'nowTitle';
  const titleCompact = long && compact;
  const subColor: ColorToken = tone === 'blue' ? 'onBlue' : 'onDarkSoft';
  const subWidth = { maxWidth: layout.subMaxWidthEm * tokens.type.body.en.size };

  const titleNode =
    title.name !== undefined && /\{area\}/.test(title.key) ? (
      <LabeledName
        role={titleRole}
        color="surface"
        labelKey={title.key}
        name={title.name}
        values={isolated(Object.fromEntries(Object.entries(title.values).filter(([key]) => key !== 'area')))}
        compact={titleCompact}
      />
    ) : (
      <StaffText role={titleRole} color="surface" translate={false} compact={titleCompact}>
        {t(title.key, isolated(title.values))}
      </StaffText>
    );

  const split = language === 'ur' && sub.name !== undefined ? urduSplit[sub.key] : undefined;
  let subNode: React.ReactNode;
  if (split && sub.name !== undefined) {
    const rest = (
      <StaffText key="rest" role="body" color={subColor} translate={false}>
        {t(split.rest, isolated(sub.values))}
      </StaffText>
    );
    const name = split.pin ? (
      <View key="name" style={[styles.pinRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <Icon name="MapPin" size={layout.pinIcon} color={colors[subColor]} />
        <View style={styles.flex}>
          <NameLine role="body" color={subColor} name={sub.name} />
        </View>
      </View>
    ) : (
      <NameLine key="name" role="body" color={subColor} name={sub.name} />
    );
    subNode = split.nameFirst ? [name, rest] : [rest, name];
  } else {
    subNode = (
      <StaffText role="body" color={subColor} translate={false}>
        {t(sub.key, isolated(sub.values))}
      </StaffText>
    );
  }

  return (
    <>
      <View
        accessible
        accessibilityRole="header"
        style={{ marginTop: compact ? layout.titleTopCompact : layout.titleTop }}
        testID="day-header-title"
      >
        {titleNode}
      </View>
      <View style={[{ marginTop: compact ? layout.subTopCompact : layout.subTop }, subWidth]} testID="day-header-sub">
        {subNode}
      </View>
    </>
  );
}

function Rail({ rail, timeZone }: { rail: NowRail; timeZone?: string }) {
  const { isRTL, t } = useLanguage();
  const progress = Math.min(1, Math.max(0, rail.progress));
  const at = `${progress * 100}%` as const;
  const start = isRTL ? 'right' : 'left';
  const checkedIn = t('Checked in {time}', { time: isolate(clock(rail.checkedInAt, timeZone)) });
  const checkOut = t('Check-out {time}', { time: isolate(clock(rail.checkOutAt, timeZone)) });
  const row = { flexDirection: isRTL ? 'row-reverse' : 'row' } as const;
  return (
    <View style={styles.rail} testID="day-header-rail">
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { [start]: 0, width: at }]} />
        <View style={[styles.dot, { [start]: at, [isRTL ? 'marginRight' : 'marginLeft']: -layout.railDot / 2 }]} />
      </View>
      <View style={[styles.railRow, row]}>
        <View style={[styles.railItem, row]}>
          <Icon name="Check" size={layout.railIcon} color={colors.surface} />
          <StaffText role="label" color="surface" translate={false}>
            {checkedIn}
          </StaffText>
        </View>
        <View style={[styles.railItem, row]}>
          <View style={isRTL ? styles.mirror : null}>
            <Icon name="LogOut" size={layout.railIcon} color={colors.surface} />
          </View>
          <StaffText role="label" color="surface" translate={false}>
            {checkOut}
          </StaffText>
        </View>
      </View>
    </View>
  );
}

const easeOut = Easing.bezier(...motion.easing.easeOut);

/** The coloured top of My day: greeting, language switch, the one sentence and, after check-in, the shift line. */
export function DayHeader({ state, firstName, today, timeZone, onAvatarPress, loading = false }: DayHeaderProps) {
  const { language, isRTL, t } = useLanguage();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const gutter = gutterFor(width);
  const row = { flexDirection: isRTL ? 'row-reverse' : 'row' } as const;

  const tone: NowTone = loading ? 'blue' : state.tone;
  const compact = !loading && state.rail !== null;

  // Sentence change: fade up 8 over 220 ms; reduced motion fades only.
  const opacity = useSharedValue(1);
  const shift = useSharedValue(0);
  const changeKey = `${state.title.key}|${state.title.name ?? ''}`;
  const lastKey = React.useRef(changeKey);
  React.useEffect(() => {
    if (lastKey.current === changeKey) return;
    lastKey.current = changeKey;
    opacity.value = 0;
    shift.value = reduced ? 0 : 8;
    const timing = { duration: reduced ? motion.duration.reducedFade : motion.duration.nowChange, easing: easeOut };
    opacity.value = withTiming(1, timing);
    shift.value = withTiming(0, timing);
  }, [changeKey, reduced, opacity, shift]);
  const sentenceStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: shift.value }] }));

  const avatarSize = compact ? space.avatarCompact : space.avatar;
  const avatarSlop = (space.touchMinIcon - avatarSize) / 2;

  return (
    <View
      testID="day-header"
      style={[
        styles.sky,
        {
          backgroundColor: colors[background[tone]],
          paddingHorizontal: gutter,
          paddingBottom: compact ? layout.padBottomCompact : layout.padBottom,
        },
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          styles.tick,
          { top: layout.tickTop, [isRTL ? 'left' : 'right']: layout.tickOutset },
          isRTL ? styles.mirror : null,
        ]}
      >
        <Icon name="Check" size={layout.tick} color={TICK_COLOR} strokeWidth={3.5} />
      </View>

      {loading ? (
        <View testID="day-header-loading">
          <View style={[styles.who, row]}>
            <Skeleton tone="onBlue" width={space.avatar} height={space.avatar} radius={space.avatar / 2} />
            <View style={styles.hi}>
              <Skeleton tone="onBlue" width={120} height={15} />
              <View style={styles.skGap}>
                <Skeleton tone="onBlue" width={90} height={12} />
              </View>
            </View>
          </View>
          {(
            [
              ['88%', 32, styles.skTitle],
              ['60%', 32, styles.skTitleGap],
              ['76%', 15, styles.skSubGap],
            ] as const
          ).map(([w, h, gap]) => (
            <View key={w} style={[gap, styles.skLine, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Skeleton tone="onBlue" width={w} height={h} />
            </View>
          ))}
        </View>
      ) : (
        <>
          <View style={[styles.who, row, compact ? styles.whoCompact : null]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Profile')}
              onPress={onAvatarPress}
              hitSlop={avatarSlop}
            >
              <Avatar size={avatarSize} />
            </Pressable>
            <View style={styles.hi}>
              <StaffText role="groupTitle" color="surface" translate={false} numberOfLines={1}>
                {t('Salaam, {name}', { name: isolate(firstName) })}
              </StaffText>
              {compact ? null : (
                <StaffText role="meta" color="onBlue" translate={false} numberOfLines={1}>
                  {shortDay(today, timeZone, language === 'ur' ? 'ur' : 'en')}
                </StaffText>
              )}
            </View>
            <LanguageToggle appearance="onBlue" />
          </View>

          <Animated.View style={sentenceStyle}>
            <Sentence title={state.title} sub={state.sub} compact={compact} tone={tone} />
          </Animated.View>

          {state.rail ? <Rail rail={state.rail} timeZone={timeZone} /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sky: { position: 'relative', overflow: 'hidden' },
  tick: { position: 'absolute', width: layout.tick, height: layout.tick },
  mirror: { transform: [{ scaleX: -1 }] },
  who: { alignItems: 'center', gap: space.rowGapNarrow, minHeight: layout.whoMinHeight },
  whoCompact: { minHeight: space.touchMin },
  hi: { flex: 1, minWidth: 0 },
  flex: { flex: 1, minWidth: 0 },
  pinRow: { alignItems: 'center', gap: layout.pinGap },
  rail: { marginTop: layout.railTop },
  track: {
    height: layout.railTrack,
    borderRadius: layout.railTrack / 2,
    backgroundColor: TRACK_COLOR,
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: layout.railTrack / 2,
    backgroundColor: colors.surface,
  },
  dot: {
    position: 'absolute',
    width: layout.railDot,
    height: layout.railDot,
    borderRadius: radius.pillRadius,
    backgroundColor: colors.surface,
    borderWidth: layout.railDotBorder,
    borderColor: colors.blue,
  },
  railRow: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: layout.railRowGap, marginTop: layout.railRowTop },
  railItem: { alignItems: 'center', gap: layout.railIconGap, flexShrink: 1 },
  skGap: { marginTop: 8 },
  skTitle: { marginTop: 22 },
  skTitleGap: { marginTop: 10 },
  skSubGap: { marginTop: 16 },
  skLine: { width: '100%' },
});
