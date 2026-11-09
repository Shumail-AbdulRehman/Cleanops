import * as React from 'react';
import { Linking, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type LucideIconName } from '../../components/ui/icon';
import { ActionButton } from '../../design/ActionButton';
import { Pill } from '../../design/Pill';
import { StaffText } from '../../design/StaffText';
import { TopBar } from '../../design/TopBar';
import { colors, gutterFor, radius, space } from '../../design/tokens';
import { useLanguage } from '../../i18n/LanguageProvider';
import { registerPhoneAlerts } from '../../notifications/native';

const NOT_CHECKED = 'Alert registration has not been checked on this screen. Your assigned work stays available.';
const TRAILER = 'Registered does not prove every alert will arrive. Your work always stays in this app.';
const FAILED = 'Phone alerts could not be confirmed. Check your connection and retry.';

function resultMessage(state: string): string {
  if (state === 'enabled') return 'Phone alerts registered.';
  if (state === 'denied') return 'Phone alerts are denied. Open settings to allow them.';
  if (state === 'unavailable') return 'Phone alerts are unavailable on this device or app configuration.';
  return FAILED;
}

function PermissionRow({ icon, label, allowed }: { icon: LucideIconName; label: string; allowed: boolean }) {
  const { isRTL } = useLanguage();
  return (
    <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <Icon name={icon} size={22} color={colors.blueDeep} />
      <View style={styles.rowLabel}>
        <StaffText role="rowTitle">{label}</StaffText>
      </View>
      <View style={styles.pillSlot} testID="permission-pill">
        <Pill tone={allowed ? 'green' : 'red'} label={allowed ? 'Allowed' : 'Not allowed'} />
      </View>
    </View>
  );
}

/** Phone alert registration and permission status. Reading permissions never prompts. */
export function TaskAlertsScreen() {
  const { user } = useAuth();
  const { language, isRTL } = useLanguage();
  const navigation = useNavigation<{ goBack: () => void }>();
  const insets = useSafeAreaInsets();
  const gutter = gutterFor(useWindowDimensions().width);
  const [message, setMessage] = React.useState('');
  const [fallback, setFallback] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [camera, setCamera] = React.useState(false);
  const [location, setLocation] = React.useState(false);
  const lock = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      let live = true;
      void Camera.getCameraPermissionsAsync()
        .then(p => { if (live) setCamera(!!p.granted); })
        .catch(() => { if (live) setCamera(false); });
      void Location.getForegroundPermissionsAsync()
        .then(p => { if (live) setLocation(!!p.granted); })
        .catch(() => { if (live) setLocation(false); });
      return () => { live = false; };
    }, []),
  );

  async function retry() {
    if (!user || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFallback('');
    try {
      const state = await registerPhoneAlerts(`${user.companyId}_${user.id}`, language, true);
      setMessage(resultMessage(state));
    } catch {
      setMessage(FAILED);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function openSettings() {
    void Linking.openSettings().catch(() => setFallback('Open this app in your phone settings.'));
  }

  return (
    <View style={styles.screen}>
      <TopBar title="Task alerts" onBack={() => navigation.goBack()} withSafeArea />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 12, paddingBottom: insets.bottom + 24, gap: 16 }}>
        <View style={[styles.note, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} accessibilityLiveRegion="polite">
          <Icon name="Bell" size={22} color={colors.blueDeep} />
          <View style={styles.rowLabel}>
            {message ? (
              <>
                <StaffText role="rowTitle">{message}</StaffText>
                <StaffText role="body" color="muted">{TRAILER}</StaffText>
              </>
            ) : (
              <StaffText role="body">{NOT_CHECKED}</StaffText>
            )}
          </View>
        </View>
        <View>
          <StaffText role="sectionTitle">Permissions</StaffText>
          <PermissionRow icon="Camera" label="Camera" allowed={camera} />
          <PermissionRow icon="MapPin" label="Location" allowed={location} />
        </View>
        <View style={styles.actions}>
          <ActionButton kind="outline" icon="RefreshCw" label="Retry phone alerts" busy={busy} onPress={() => void retry()} />
          <ActionButton kind="ghost" icon="Settings" label="Open settings" onPress={openSettings} />
          {fallback ? <StaffText role="body" color="muted" accessibilityLiveRegion="polite">{fallback}</StaffText> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  note: { gap: 12, padding: 16, borderRadius: radius.cardRadius, backgroundColor: colors.blueWash, alignItems: 'flex-start' },
  rowLabel: { flex: 1, minWidth: 0, gap: 4 },
  row: { alignItems: 'center', gap: 14, minHeight: space.rowMinHeightCompact, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  pillSlot: { alignSelf: 'center', flexShrink: 1 },
  actions: { gap: 8 },
});
