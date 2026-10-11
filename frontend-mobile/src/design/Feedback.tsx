import * as React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { Icon, type LucideIconName } from '../components/ui/icon';
import { useLanguage } from '../i18n/LanguageProvider';
import { ActionButton } from './ActionButton';
import { StaffText } from './StaffText';
import { colors, motion, radius, space, tabBarHeight, type, whiteAlpha } from './tokens';

// ---------------------------------------------------------------- snackbar

const SNACK_MS = 2200;

type SnackValues = Record<string, string | number>;
/** `confirm` is the done look (yellow tick, the default); `failure` is an alert icon for something that went wrong. */
export type SnackTone = 'confirm' | 'failure';
type Show = (messageKey: string, values?: SnackValues, tone?: SnackTone) => void;

const noopShow: Show = () => {};
const SnackbarContext = React.createContext<{ show: Show }>({ show: noopShow });

/** Short message, a confirmation unless a failure tone is passed. Outside a provider `show` does nothing, so early screens never crash. */
export function useSnackbar(): { show: Show } {
  return React.useContext(SnackbarContext);
}

const RISE = 12;
const easeOut = Easing.bezier(...motion.easing.easeOut);

/**
 * The bar itself. It fades in and rises 12 (fade only under reduced motion). No exit animation:
 * the parent unmounts it, so nothing lingers or flickers. It sits above the tab bar: safe-area bottom inset
 * plus the tab bar height from the shared formula (the provider is outside the tab navigator, so the
 * navigator's own hook is not available here) plus a 12 gap.
 */
function SnackBar({ id, text, isRTL, tone }: { id: number; text: string; isRTL: boolean; tone: SnackTone }) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const { language } = useLanguage();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  React.useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: reduced ? motion.duration.reducedFade : motion.duration.snack,
      easing: easeOut,
    });
  }, [id, reduced, progress]);
  const motionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * RISE }],
  }));
  const bottom = tabBarHeight(insets.bottom, type.label[language].lineHeight, fontScale) + space.snackAboveBar;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.snack, { bottom, flexDirection: isRTL ? 'row-reverse' : 'row' }, motionStyle]}
    >
      {tone === 'failure' ? (
        <Icon name="CircleAlert" size={22} color={colors.surface} />
      ) : (
        <Icon name="Check" size={22} color={colors.yellow} />
      )}
      <View style={styles.snackText}>
        <StaffText role="label" color="surface" translate={false}>{text}</StaffText>
      </View>
    </Animated.View>
  );
}

/** Mounted once at the app root (spec 48). One message at a time; a new one replaces the old. */
export function SnackbarProvider({ children }: { children?: React.ReactNode }) {
  const { t, isRTL } = useLanguage();
  const [message, setMessage] = React.useState<{ id: number; key: string; values?: SnackValues; tone: SnackTone } | null>(null);
  const counter = React.useRef(0);
  const api = React.useMemo(
    () => ({
      show: ((key, values, tone = 'confirm') => {
        counter.current += 1;
        setMessage({ id: counter.current, key, values, tone });
      }) as Show,
    }),
    [],
  );

  const id = message?.id;
  React.useEffect(() => {
    if (id === undefined) return undefined;
    const timer = setTimeout(() => setMessage(null), SNACK_MS);
    return () => clearTimeout(timer);
  }, [id]);

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {message ? (
        <SnackBar id={message.id} text={t(message.key, message.values)} isRTL={isRTL} tone={message.tone} />
      ) : null}
    </SnackbarContext.Provider>
  );
}

// ---------------------------------------------------------------- connectivity

/** The one definition of online: same rule as the home screen. */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
  React.useEffect(
    () =>
      NetInfo.addEventListener(state => {
        setOnline(state.isConnected !== false && state.isInternetReachable !== false);
      }),
    [],
  );
  return online;
}

/** Dark bar shown above content while offline. Renders nothing online. */
export function OfflineBanner() {
  const online = useOnline();
  const { isRTL } = useLanguage();
  if (online) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
    >
      <Icon name="WifiOff" size={22} color={colors.surface} />
      <View style={styles.bannerText}>
        <StaffText role="label" color="surface">Internet needed to continue</StaffText>
        <StaffText role="meta" color="bannerSoft">You are seeing the last saved information.</StaffText>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- skeleton

export interface SkeletonProps {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  tone?: 'onBlue' | 'onWhite';
}

/** Plain placeholder block. No shimmer. */
export function Skeleton({ width = '100%', height, radius: corner = 8, tone = 'onWhite' }: SkeletonProps) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width,
        height,
        borderRadius: corner,
        backgroundColor: tone === 'onBlue' ? whiteAlpha.block : colors.line,
      }}
    />
  );
}

// ---------------------------------------------------------------- empty and error

export interface EmptyStateProps {
  icon: LucideIconName;
  /** English keys, translated. */
  title: string;
  body?: string;
  action?: React.ReactElement<React.ComponentProps<typeof ActionButton>>;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.center}>
      <View style={styles.glyph}>
        <Icon name={icon} size={40} color={colors.blue} />
      </View>
      <StaffText role="sectionTitle" align="center">{title}</StaffText>
      {body ? (
        <View style={styles.gap}>
          <StaffText role="body" color="muted" align="center">{body}</StaffText>
        </View>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

export interface ErrorStateProps {
  title?: string;
  body?: string;
  onRetry: () => void;
}

export function ErrorState({
  title = 'Something could not load',
  body = 'Your saved work is unchanged. Check your internet and try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <EmptyState
      icon="CloudOff"
      title={title}
      body={body}
      action={<ActionButton kind="outline" label="Try again" icon="RefreshCw" onPress={onRetry} />}
    />
  );
}

const styles = StyleSheet.create({
  snack: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 200,
    elevation: 12,
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  snackText: { flexShrink: 1 },
  banner: {
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.night2,
    paddingHorizontal: space.gutterNarrow,
    paddingVertical: 10,
  },
  bannerText: { flexShrink: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.gutter, paddingVertical: 32 },
  glyph: {
    width: 88,
    height: 88,
    borderRadius: radius.sheetRadius,
    backgroundColor: colors.blueWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  gap: { marginTop: 4 },
  action: { marginTop: 20, alignSelf: 'stretch' },
});
