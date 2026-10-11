import * as React from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { NativeFontsReady, fontFor } from '../fonts';
import { useLanguage } from '../i18n/LanguageProvider';
import { Icon } from '../components/ui/icon';
import { StaffText } from './StaffText';
import { colors, radius, space, tokens } from './tokens';

export type FieldKind = 'email' | 'password' | 'code' | 'url' | 'text' | 'phone' | 'otp';

export interface FieldProps {
  /** English key. */
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  kind?: FieldKind;
  /** Shown as written (emails and URLs are not translated). */
  placeholder?: string;
  /** English key or server message. */
  error?: string | null;
  editable?: boolean;
  autoFocus?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  maxLength?: number;
  accessibilityLabel?: string;
  testID?: string;
}

const secretKinds: ReadonlySet<FieldKind> = new Set<FieldKind>(['password', 'code']);
const keyboards: Partial<Record<FieldKind, TextInputProps['keyboardType']>> = {
  email: 'email-address',
  url: 'url',
  phone: 'phone-pad',
  otp: 'number-pad',
};
const autofill: Partial<Record<FieldKind, Pick<TextInputProps, 'autoComplete' | 'textContentType'>>> = {
  phone: Platform.OS === 'ios' ? { textContentType: 'telephoneNumber' } : { autoComplete: 'tel' },
  otp: Platform.OS === 'ios' ? { textContentType: 'oneTimeCode' } : {
    autoComplete: Platform.OS === 'android' ? 'sms-otp' : 'one-time-code',
  },
};

/** One large labelled text box with an optional show-password button and an inline error. */
export function Field({
  label,
  value,
  onChangeText,
  kind = 'text',
  placeholder,
  error,
  editable = true,
  autoFocus,
  returnKeyType,
  onSubmitEditing,
  maxLength,
  accessibilityLabel,
  testID,
}: FieldProps) {
  const { isRTL, t } = useLanguage();
  const fontsReady = React.useContext(NativeFontsReady);
  const [focused, setFocused] = React.useState(false);
  const [shown, setShown] = React.useState(false);
  const secret = secretKinds.has(kind);
  const hidden = secret && !shown;
  const failed = Boolean(error);

  const borderColor = failed ? colors.bad : focused ? colors.blue : colors.lineStrong;
  const borderWidth = failed || focused ? 2 : 1.5;
  const inputType = tokens.type.input.en;
  const eyeLabel = t(shown ? 'Hide password' : 'Show password');

  return (
    <View style={styles.wrap}>
      <StaffText role="fieldLabel">{label}</StaffText>
      <View
        style={[
          styles.box,
          { flexDirection: isRTL ? 'row-reverse' : 'row', borderColor, borderWidth },
        ]}
      >
        <TextInput
          testID={testID}
          accessibilityLabel={accessibilityLabel ?? t(label)}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.subtle}
          editable={editable}
          autoFocus={autoFocus}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboards[kind] ?? 'default'}
          {...autofill[kind]}
          secureTextEntry={hidden}
          maxLength={kind === 'otp' ? Math.min(maxLength ?? 6, 6) : maxLength ?? (secret ? 128 : undefined)}
          allowFontScaling
          style={[
            styles.input,
            {
              fontFamily: fontFor('body', 'en', fontsReady),
              fontSize: inputType.size,
              lineHeight: inputType.lineHeight,
              color: colors.ink,
              writingDirection: 'ltr',
              textAlign: isRTL && kind !== 'phone' && kind !== 'otp' ? 'right' : 'left',
            },
          ]}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={eyeLabel}
            onPress={() => setShown(v => !v)}
            hitSlop={4}
            style={styles.eye}
          >
            <Icon name={shown ? 'EyeOff' : 'Eye'} size={22} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {failed ? (
        <View style={[styles.error, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <Icon name="CircleAlert" size={18} color={colors.bad} />
          <View style={styles.errorText}>
            <StaffText role="label" color="bad" accessibilityLiveRegion="polite">
              {error as string}
            </StaffText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  box: {
    height: space.fieldHeight,
    borderRadius: radius.fieldRadius,
    backgroundColor: colors.surface,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  input: { flex: 1, height: space.fieldHeight, padding: 0 },
  eye: { width: space.touchMin, height: space.touchMin, alignItems: 'center', justifyContent: 'center' },
  error: { alignItems: 'flex-start', gap: 6 },
  errorText: { flex: 1 },
});
