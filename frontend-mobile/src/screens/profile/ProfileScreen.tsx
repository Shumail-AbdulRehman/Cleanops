import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as Application from 'expo-application';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type LucideIconName } from '../../components/ui/icon';
import { Avatar } from '../../design/Avatar';
import { ConfirmDialog } from '../../design/ConfirmDialog';
import { Skeleton } from '../../design/Feedback';
import { localDate, monthTitle } from '../../design/format';
import { LanguageToggle } from '../../design/LanguageToggle';
import { NameLine, StaffText, isolate } from '../../design/StaffText';
import { colors, gutterFor, space, type ColorToken } from '../../design/tokens';
import { useLanguage } from '../../i18n/LanguageProvider';
import { stackRoutes, tabRoutes } from '../../navigation/routeNames';
import { useProfileSummary } from '../../queries/history';
import { useStaffProfileQuery } from '../../queries/profile';
import { ProfileMonth } from './ProfileMonth';
import { ProfileWork } from './ProfileWork';

export interface ProfileScreenProps {
  /** Part 2 passes the company name; Part 1 shows no company line. */
  companyName?: string;
  /** Rendered after the header (spec 51: the month section). */
  topSlot?: React.ReactNode;
  /** Rendered after `topSlot` (spec 51: the work section). */
  workSlot?: React.ReactNode;
}

const ROW_MIN = 60;
const DEFAULT_ZONE = 'Asia/Karachi';

/** Month key (YYYY-MM) of the join date in the location's zone; an invalid zone falls back to Asia/Karachi. */
function joinedMonthKey(createdAt: string, zone?: string | null): string {
  try {
    return localDate(createdAt, zone || DEFAULT_ZONE).slice(0, 7);
  } catch {
    return localDate(createdAt, DEFAULT_ZONE).slice(0, 7);
  }
}

function DetailRow({ icon, label, children }: { icon: LucideIconName; label: string; children: React.ReactNode }) {
  const { isRTL } = useLanguage();
  return (
    <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <Icon name={icon} size={22} color={colors.muted} />
      <View style={styles.rowBody}>
        <StaffText role="label" color="muted">{label}</StaffText>
        {children}
      </View>
    </View>
  );
}

function SkeletonRow() {
  const { isRTL } = useLanguage();
  return (
    <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <Skeleton width={22} height={22} radius={6} />
      <View style={styles.rowBody}>
        <Skeleton width={72} height={12} />
        <Skeleton width="60%" height={16} />
      </View>
    </View>
  );
}

/**
 * A tappable settings row. The pressed wash lives in React state: on Android, NativeWind's
 * interop drops a `style` callback on `Pressable`, which lost the row layout (spec 67).
 */
function PressRow({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const { isRTL, t } = useLanguage();
  const [pressed, setPressed] = React.useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

function LinkRow({ icon, label, onPress }: { icon: LucideIconName; label: string; onPress: () => void }) {
  const { isRTL } = useLanguage();
  return (
    <PressRow label={label} onPress={onPress}>
      <Icon name={icon} size={22} color={colors.muted} />
      <View style={styles.rowBody}>
        <StaffText role="rowTitle">{label}</StaffText>
      </View>
      <Icon name={isRTL ? 'ChevronLeft' : 'ChevronRight'} size={20} color={colors.subtle} />
    </PressRow>
  );
}

function Value({ text, color = 'ink' }: { text: string; color?: ColorToken }) {
  // Phone, email and number stay left-to-right even in Urdu.
  return <StaffText role="rowTitle" color={color} translate={false}>{isolate(text)}</StaffText>;
}

/** Profile tab: who the staff member is, their details, settings and help. */
export function ProfileScreen({ companyName, topSlot, workSlot }: ProfileScreenProps) {
  const navigation = useNavigation<any>();
  const { user, logout } = useAuth();
  const { isRTL, language, t } = useLanguage();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const gutter = gutterFor(width);
  const profile = useStaffProfileQuery(user?.id);
  const summary = useProfileSummary(user?.id);
  const summaryLoading = summary.isPending && !summary.data;
  const summaryFailed = !summaryLoading && !summary.data;
  const [confirming, setConfirming] = React.useState(false);

  const details = profile.data ?? (summary.data ? { ...summary.data, createdAt: summary.data.joinedAt } : null);
  const loading = profile.isPending && !details;
  const failed = !loading && !details;
  const name = details?.name ?? user?.name ?? '';
  const email = details ? details.email : user?.email;
  const company = companyName ?? summary.data?.company.name;
  const dir = { flexDirection: isRTL ? 'row-reverse' : 'row' } as const;

  return (
    <View style={styles.screen}>
      {/* Fixed status-bar band, so scrolled content never sits under the clock (spec 67). */}
      <View testID="status-band" style={[styles.band, { height: insets.top }]} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={[styles.header, { paddingTop: 24, paddingHorizontal: gutter }]}>
          <Avatar size={space.avatarProfile} />
          <View style={styles.headerName}>
            <NameLine role="headline" name={name} />
          </View>
          <StaffText role="body" color="muted" align="center">Cleaning staff</StaffText>
          {company ? <StaffText role="body" color="muted" align="center" translate={false}>{isolate(company)}</StaffText> : null}
        </View>

        {topSlot ?? (
          <ProfileMonth
            summary={summary.data?.month}
            loading={summaryLoading}
            error={summaryFailed}
            onRetry={() => { void summary.refetch(); }}
            onSeeHistory={() => navigation.navigate(tabRoutes.history)}
          />
        )}
        {workSlot ?? <ProfileWork summary={summary.data} loading={summaryLoading} />}

        <View style={[styles.block, { paddingHorizontal: gutter }]}>
          <StaffText role="groupTitle" accessibilityRole="header" style={styles.blockTitle}>My details</StaffText>
          {loading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            <>
              {details ? (
                <DetailRow icon="Phone" label="Phone">
                  {details.phone ? <Value text={details.phone} /> : <StaffText role="rowTitle" color="muted">Not recorded</StaffText>}
                </DetailRow>
              ) : null}
              <DetailRow icon="Mail" label="Email">
                {email ? <Value text={email} /> : <StaffText role="rowTitle" color="muted">No email</StaffText>}
              </DetailRow>
              {details ? (
                <>
                  <DetailRow icon="Hash" label="Staff number">
                    <Value text={String(details.id)} />
                  </DetailRow>
                  <DetailRow icon="Calendar" label="Joined">
                    <StaffText role="rowTitle" translate={false}>
                      {monthTitle(joinedMonthKey(details.createdAt, summary.data?.location?.timezone), language)}
                    </StaffText>
                  </DetailRow>
                </>
              ) : null}
            </>
          )}
          {failed ? (
            <View style={[styles.errorLine, dir]}>
              <View style={styles.rowBody}>
                <StaffText role="meta" color="muted">Details could not load.</StaffText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Try again')}
                onPress={() => { void profile.refetch(); }}
                style={styles.retry}
              >
                <StaffText role="label" color="blueDeep">Try again</StaffText>
              </Pressable>
            </View>
          ) : null}
          <StaffText role="meta" color="muted" style={styles.note}>Ask your manager to change these.</StaffText>
        </View>

        <View style={[styles.block, { paddingHorizontal: gutter }]}>
          <StaffText role="groupTitle" accessibilityRole="header" style={styles.blockTitle}>Settings and help</StaffText>
          <View style={[styles.row, dir]}>
            <Icon name="Languages" size={22} color={colors.muted} />
            <View style={styles.rowBody}>
              <StaffText role="rowTitle">Language</StaffText>
            </View>
            <LanguageToggle appearance="onWhite" />
          </View>
          <LinkRow icon="Bell" label="Task alerts" onPress={() => navigation.navigate(stackRoutes.taskAlerts)} />
          <LinkRow icon="CircleQuestionMark" label="Help" onPress={() => navigation.navigate(stackRoutes.helpGuide)} />
          <PressRow label="Sign out" onPress={() => setConfirming(true)}>
            <Icon name="LogOut" size={22} color={colors.bad} />
            <View style={styles.rowBody}>
              <StaffText role="rowTitle" color="bad">Sign out</StaffText>
            </View>
          </PressRow>
        </View>

        <View style={[styles.footer, { paddingHorizontal: gutter }]}>
          <StaffText role="meta" color="subtle" align="center">
            {t('Version {v}', { v: Application.nativeApplicationVersion ?? '0.0.0' })}
          </StaffText>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirming}
        title="Sign out of this phone?"
        body="You will need your phone number and a new code to sign in again."
        confirmLabel="Sign out"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); void logout(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  band: { backgroundColor: colors.surface },
  header: { backgroundColor: colors.surface, alignItems: 'center', paddingBottom: 24, gap: 4 },
  headerName: { alignSelf: 'stretch', alignItems: 'center', marginTop: 10 },
  block: { backgroundColor: colors.surface, marginTop: 10, paddingVertical: 8 },
  blockTitle: { paddingTop: 10, paddingBottom: 4 },
  row: { minHeight: ROW_MIN, alignItems: 'center', gap: 14, paddingVertical: 8 },
  rowBody: { flex: 1, minWidth: 0 },
  pressed: { backgroundColor: colors.soft },
  errorLine: { minHeight: 44, alignItems: 'center', gap: 12 },
  retry: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 },
  note: { paddingVertical: 10 },
  footer: { paddingTop: 20 },
});
