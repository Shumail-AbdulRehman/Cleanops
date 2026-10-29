import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { formatStaffPhone, staffSignInError } from "../auth/staffSignInApi";
import { API_BASE_URL } from "../config";
import { changeApiServerAddress } from "../api/client";
import { getServerAddress, loadServerAddress } from "../api/serverAddress";
import { ActionButton } from "../design/ActionButton";
import { Field } from "../design/Field";
import { LanguageToggle } from "../design/LanguageToggle";
import { StaffText } from "../design/StaffText";
import { colors, radius, space } from "../design/tokens";
import { useLanguage } from "../i18n/LanguageProvider";

const NETWORK_CODES = ["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"];
const RESEND_LABEL = "Send a new code";
const RESEND_COUNTDOWN = "You can ask for a new code in {seconds} seconds.";

export function LoginScreen() {
  const { requestCode, signInWithCode } = useAuth();
  const { t, isRTL } = useLanguage();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", event => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const [phone, setPhone] = useState("");
  const [requestedPhone, setRequestedPhone] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"request" | "resend" | "verify" | null>(null);
  const operationInFlight = useRef(false);
  const [lastError, setLastError] = useState<{ key: string; values?: Record<string, string | number> } | null>(null);
  const [resendWait, setResendWait] = useState<{ until: number; seconds: number } | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendPressed, setResendPressed] = useState(false);
  const [serverAddress, setServerAddress] = useState(API_BASE_URL);
  const [serverDraft, setServerDraft] = useState(API_BASE_URL);
  const [serverError, setServerError] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [savingServer, setSavingServer] = useState(false);

  useEffect(() => {
    void loadServerAddress().then((address) => {
      setServerAddress(address);
      setServerDraft(address);
    });
  }, []);

  useEffect(() => {
    if (!resendWait) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((resendWait.until - Date.now()) / 1000));
      setResendSeconds(remaining);
      if (remaining === 0) {
        clearInterval(timer);
        setResendWait(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [resendWait]);

  const resendAnnouncement = resendWait ? t(RESEND_COUNTDOWN, { seconds: resendWait.seconds }) : null;
  useEffect(() => {
    if (Platform.OS === "ios" && resendAnnouncement) {
      AccessibilityInfo.announceForAccessibilityWithOptions(resendAnnouncement, { queue: true });
    }
  }, [resendWait, resendAnnouncement]);

  const startResendWait = (seconds: number) => {
    setResendWait(seconds > 0 ? { until: Date.now() + seconds * 1000, seconds } : null);
    setResendSeconds(seconds);
  };

  const resetCodeStep = () => {
    setRequestedPhone("");
    setCode("");
    setLastError(null);
    startResendWait(0);
  };

  const saveServer = async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    try {
      setSavingServer(true);
      setServerError(null);
      const address = await changeApiServerAddress(serverDraft);
      setServerAddress(address);
      setServerDraft(address);
      if (address !== serverAddress) resetCodeStep();
      else setLastError(null);
      setEditingServer(false);
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Could not save the server address.",
      );
    } finally {
      operationInFlight.current = false;
      setSavingServer(false);
    }
  };

  const handleError = (error: unknown, resending = false) => {
    const detail = staffSignInError(error);
    const address = getServerAddress();
    const networkCode = (error as { code?: string } | null)?.code;
    if (detail) {
      setLastError(detail);
      if (resending && detail.retryAfterSeconds) startResendWait(detail.retryAfterSeconds);
    } else if (networkCode && NETWORK_CODES.includes(networkCode) && address.startsWith("http://")) {
      setLastError({
        key: "Unable to sign in.\n\nServer: {address}\nCheck that your phone and server are on the same network, or change the server address below.",
        values: { address },
      });
    } else {
      setLastError({ key: "Unable to sign in." });
    }
  };

  const handleRequest = async (resending = false) => {
    if (operationInFlight.current || (resending && resendWait && Date.now() < resendWait.until)) return;
    const number = resending ? requestedPhone : phone.trim();
    if ((number.match(/\d/g)?.length ?? 0) < 10) {
      setLastError({ key: "Enter your phone number." });
      return;
    }

    operationInFlight.current = true;
    setPending(resending ? "resend" : "request");
    setLastError(null);
    try {
      const result = await requestCode(number);
      setRequestedPhone(result.phone);
      setCode("");
      startResendWait(result.resendAfterSeconds);
    } catch (error) {
      handleError(error, resending);
    } finally {
      operationInFlight.current = false;
      setPending(null);
    }
  };

  const handleVerify = async () => {
    if (operationInFlight.current) return;
    if (!/^\d{6}$/.test(code)) {
      setLastError({ key: "Enter the 6-digit code." });
      return;
    }

    operationInFlight.current = true;
    setPending("verify");
    setLastError(null);
    try {
      await signInWithCode(requestedPhone, code);
    } catch (error) {
      handleError(error);
    } finally {
      operationInFlight.current = false;
      setPending(null);
    }
  };

  const rowDirection = isRTL ? "row-reverse" : "row";
  const enteringCode = Boolean(requestedPhone);
  const formattedPhone = formatStaffPhone(requestedPhone);
  const displayPhone = isRTL ? `\u2066${formattedPhone}\u2069` : formattedPhone;
  const fieldError = lastError ? t(lastError.key, lastError.values) : null;
  const resendBusy = pending === "resend";
  const resendDisabled = resendSeconds > 0 || pending !== null || savingServer;
  // Native groups the disabled action for screen readers. On web the press target owns the button semantics.
  const groupDisabledResend = Platform.OS !== "web" && resendDisabled;
  const resendAccessibility = {
    accessibilityRole: "button" as const,
    accessibilityLabel: t(RESEND_LABEL),
    accessibilityState: { disabled: resendDisabled, busy: resendBusy },
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.screen}
    >
      {/* Fixed status-bar band, so content scrolled for the keyboard never sits under the clock (spec 67). */}
      <View testID="status-band" style={{ height: insets.top }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: space.gutter,
          paddingTop: 16,
          paddingBottom: insets.bottom + 20 + (Platform.OS === "android" ? keyboardHeight : 0),
          gap: 30,
        }}
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.topRow, { flexDirection: rowDirection }]}>
          <View style={[styles.brand, { flexDirection: rowDirection }]}>
            <Image
              source={require("../../assets/hygene-ops-mark.png")}
              style={styles.mark}
              accessible={false}
            />
            <StaffText role="sectionTitle" translate={false}>Hygene</StaffText>
            <StaffText role="sectionTitle" color="blue" translate={false}>Ops</StaffText>
          </View>
          <View style={styles.toggle}><LanguageToggle appearance="onWhite" /></View>
        </View>

        <StaffText role="pageTitle" accessibilityRole="header">Staff sign in</StaffText>

        <View style={styles.fields}>
          {enteringCode ? (
            <>
              <StaffText role="body" translate={false}>
                {t("Enter the 6-digit code we sent to {phone}.", { phone: displayPhone })}
              </StaffText>
              <Field
                key="otp"
                label="6-digit code"
                kind="otp"
                value={code}
                onChangeText={(value) => { setCode(value); setLastError(null); }}
                error={fieldError}
                editable={!pending && !savingServer}
                returnKeyType="done"
                onSubmitEditing={() => void handleVerify()}
              />
            </>
          ) : (
            <Field
              key="phone"
              label="Phone number"
              kind="phone"
              placeholder="0300 1234567"
              value={phone}
              onChangeText={(value) => { setPhone(value); setLastError(null); }}
              error={fieldError}
              editable={!pending && !savingServer}
              returnKeyType="done"
              onSubmitEditing={() => void handleRequest()}
            />
          )}
        </View>

        <View style={styles.bottom}>
          {enteringCode ? (
            <>
              <ActionButton kind="form" label="Sign in" busy={pending === "verify"} onPress={() => void handleVerify()} />
              <ActionButton
                kind="ghost"
                label="Change number"
                onPress={() => { if (!operationInFlight.current) resetCodeStep(); }}
              />
              <View accessible={groupDisabledResend} {...(groupDisabledResend ? resendAccessibility : undefined)}>
                <Pressable
                  {...(groupDisabledResend ? undefined : resendAccessibility)}
                  accessible={!groupDisabledResend}
                  aria-hidden={groupDisabledResend}
                  aria-disabled={resendDisabled}
                  disabled={resendDisabled}
                  onPress={() => void handleRequest(true)}
                  onPressIn={() => setResendPressed(true)}
                  onPressOut={() => setResendPressed(false)}
                  style={[
                    styles.resendButton,
                    { flexDirection: rowDirection },
                    resendPressed && !resendDisabled && styles.resendPressed,
                    resendDisabled && styles.disabled,
                  ]}
                >
                  {resendBusy ? <ActivityIndicator size="small" color={colors.blueDeep} /> : null}
                  <StaffText role="groupTitle" color="blueDeep" align="center">{RESEND_LABEL}</StaffText>
                </Pressable>
              </View>
              {resendSeconds > 0 ? (
                <StaffText
                  role="meta"
                  color="muted"
                  translate={false}
                  accessibilityLiveRegion={resendSeconds === resendWait?.seconds ? "polite" : "none"}
                >
                  {t(RESEND_COUNTDOWN, { seconds: resendSeconds })}
                </StaffText>
              ) : null}
            </>
          ) : (
            <ActionButton kind="form" label="Send code" busy={pending === "request"} onPress={() => void handleRequest()} />
          )}
          <ActionButton
            kind="ghost"
            label={showServerSettings ? "Hide connection settings" : "Show connection settings"}
            onPress={() => setShowServerSettings((value) => !value)}
          />
          {showServerSettings ? (
            <View style={styles.server}>
              <StaffText role="label" color="muted">Server address</StaffText>
              <StaffText role="body" translate={false} testID="server-address">{serverAddress}</StaffText>
              {editingServer ? (
                <View style={styles.serverEdit}>
                  <Field
                    label="Server address"
                    kind="url"
                    value={serverDraft}
                    onChangeText={setServerDraft}
                    error={serverError}
                    placeholder="http://192.168.1.10:8080/api"
                  />
                  <StaffText role="meta" color="muted">
                    Use the server computer’s Wi-Fi address. Include :8080/api.
                  </StaffText>
                  <ActionButton kind="form" label="Save address" busy={savingServer} onPress={() => void saveServer()} />
                  <ActionButton
                    kind="outline"
                    label="Cancel"
                    onPress={() => {
                      setServerDraft(serverAddress);
                      setServerError(null);
                      setEditingServer(false);
                    }}
                  />
                </View>
              ) : (
                <ActionButton kind="outline" label="Change server address" onPress={() => setEditingServer(true)} />
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  topRow: { alignItems: "center", justifyContent: "space-between", gap: 12 },
  brand: { alignItems: "center", gap: 6, flexShrink: 1 },
  toggle: { flexShrink: 0 },
  mark: { width: 36, height: 36 },
  fields: { gap: 16 },
  bottom: { gap: 12 },
  resendButton: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: space.ghostHeight,
    borderRadius: radius.actionRadius,
    paddingHorizontal: space.gutterNarrow,
  },
  resendPressed: { backgroundColor: colors.soft },
  disabled: { opacity: 0.75 },
  server: { backgroundColor: colors.canvas, borderRadius: radius.fieldRadius, padding: 14, gap: 10 },
  serverEdit: { gap: 12 },
});
