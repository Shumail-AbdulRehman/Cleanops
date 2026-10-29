import * as React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/ui/icon';
import { StaffText } from '../design/StaffText';
import { TopBar } from '../design/TopBar';
import { colors, gutterFor } from '../design/tokens';
import { useLanguage } from '../i18n/LanguageProvider';

const ANSWERS: ReadonlyArray<{ question: string; answer: string }> = [
  { question: 'How to check in', answer: 'Go to your location. Tap the yellow button. Take a selfie.' },
  { question: 'How to finish a task', answer: 'Scan the QR. Clean. Scan the same QR. Take every photo. Submit.' },
  { question: 'The QR will not scan', answer: 'Turn on the light and hold the phone steady. If it still fails, ask your manager.' },
  { question: 'I did not get the code', answer: 'Wait one minute and tap Send a new code. If it still does not come, ask your manager to check your phone number.' },
  {
    question: 'Permissions',
    answer: 'Camera and location are required for attendance. Task photos also require current server authority. Turning on permissions does not renew expired authority.',
  },
];

const NOTE = 'Ask your manager about your shift, task QR or your phone number.';

/** Plain help answers reached from Profile. Static: no data, no actions besides going back. */
export function HelpScreen() {
  const navigation = useNavigation();
  const { isRTL } = useLanguage();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const gutter = gutterFor(width);

  return (
    <View style={styles.screen}>
      <TopBar title="Help" onBack={() => navigation.goBack()} backLabel="Back" withSafeArea />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter, paddingBottom: insets.bottom + 24 }]}
      >
        {ANSWERS.map((item, index) => (
          <React.Fragment key={item.question}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <View style={styles.item}>
              <StaffText role="groupTitle" accessibilityRole="header">{item.question}</StaffText>
              <StaffText role="body" color="muted" style={styles.answer}>{item.answer}</StaffText>
            </View>
          </React.Fragment>
        ))}
        <View
          testID="help-note"
          style={[styles.note, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
        >
          <Icon name="UserRound" size={22} color={colors.blueDeep} />
          <View style={styles.noteText}>
            <StaffText role="body" color="blueDeep">{NOTE}</StaffText>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 8, gap: 0 },
  item: { paddingVertical: 14, gap: 2 },
  answer: { marginTop: 2 },
  rule: { height: 1, backgroundColor: colors.line },
  note: {
    marginTop: 14,
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.blueWash,
    alignItems: 'flex-start',
  },
  noteText: { flex: 1, minWidth: 0 },
});
