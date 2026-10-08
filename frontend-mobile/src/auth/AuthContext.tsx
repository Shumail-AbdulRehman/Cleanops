import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { passwordChangeRequired as requiresReplacement } from "../launch/recoveryPolicy";
import { setCaptureAccount } from "../verification/captureAccount";
import { clearPhoneAlerts } from '../notifications/native';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { client, configureApiAuth } from "../api/client";
import { STORAGE_KEY } from "../config";
import { loadServerAddress,getServerAddress } from '../api/serverAddress';
import { staffLogoutQueue } from './pendingLogout';
import { createSessionStorage } from './sessionStorage';
import { requestStaffCode, verifyStaffCode, type StaffCodeRequest } from './staffSignInApi';
import type { ApiEnvelope, AuthSession, AuthTokens, StaffUser } from "../types";

type AuthContextValue = {
  user: StaffUser | null;
  isBootstrapping: boolean;
  passwordChangeRequired: boolean;
  requestCode: (phone: string) => Promise<StaffCodeRequest>;
  signInWithCode: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
};

const emptySession: AuthSession = {
  user: null,
  accessToken: null,
  refreshToken: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

const sessionStorage = createSessionStorage(Platform.OS !== 'web', STORAGE_KEY, AsyncStorage, {
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: SecureStore.deleteItemAsync,
});

const persistSession = async (session: AuthSession) => {
  if (!session.user || !session.accessToken || !session.refreshToken) {
    await sessionStorage.write(null);
    return;
  }

  await sessionStorage.write(JSON.stringify(session));
};

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [session, setSession] = useState<AuthSession>(emptySession);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const sessionRef = useRef<AuthSession>(emptySession);

  const applySession = async (nextSession: AuthSession) => {
    await persistSession(nextSession);
    setPasswordChangeRequired(nextSession.passwordChangeRequired === true);
    setCaptureAccount(nextSession.user);
    sessionRef.current = nextSession;
    setSession(nextSession);
  };

  const clearSession = async () => {
    setPasswordChangeRequired(false);
    setCaptureAccount(null);
    await clearPhoneAlerts();
    await applySession(emptySession);
    queryClient.clear();
  };

  const updateTokens = async (tokens: Required<AuthTokens>) => {
    const nextSession = {
      ...sessionRef.current,
      ...tokens,
    };

    await applySession(nextSession);
  };

  const refreshCurrentUser = async () => {
    try {
      const response = await client.get<ApiEnvelope<StaffUser>>("/common/get-current-user");
      if (response.data.data.role !== 'STAFF') throw new Error('Use a staff account in this app.');
      setPasswordChangeRequired(false);
      await applySession({ ...sessionRef.current, user: response.data.data, passwordChangeRequired: false });
    } catch (error) {
      if (requiresReplacement(error)) {
        setPasswordChangeRequired(true);
        await applySession({ ...sessionRef.current, passwordChangeRequired: true });
        return;
      }
      throw error;
    }
  };

  useEffect(() => {
    configureApiAuth({
      getScope: () => sessionRef.current.user ? `${sessionRef.current.user.companyId}_${sessionRef.current.user.id}` : null,
      getTokens: async () => ({
        accessToken: sessionRef.current.accessToken,
        refreshToken: sessionRef.current.refreshToken,
      }),
      setTokens: updateTokens,
      clearSession,
    });

    void (async () => {
      try {
        await loadServerAddress();
        void staffLogoutQueue.flush().catch(() => {});
        const storedSession = await sessionStorage.read();

        if (!storedSession) {
          setIsBootstrapping(false);
          return;
        }

        const parsed = JSON.parse(storedSession) as AuthSession;
        if (parsed.user?.role !== 'STAFF') { await clearSession(); return; }
        setPasswordChangeRequired(parsed.passwordChangeRequired === true);
        setCaptureAccount(parsed.user);
        sessionRef.current = parsed;
        setSession(parsed);
        await persistSession(parsed);

        if (parsed.accessToken) {
          await refreshCurrentUser();
        }
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        // A disconnected phone retains its account and already-issued capture sessions.
        if (status === 401 || error instanceof SyntaxError) await clearSession();
      } finally {
        setIsBootstrapping(false);
      }
    })();
  }, []);

  const signInWithCode = async (phone: string, code: string) => {
    await staffLogoutQueue.flush().catch(() => {});
    const { accessToken, refreshToken, ...user } = await verifyStaffCode(phone, code);
    if (user.role !== 'STAFF') throw new Error('Use a staff account in this app.');
    setIsBootstrapping(true);
    setCaptureAccount(null);
    queryClient.clear();
    try {
      await applySession({ user, accessToken, refreshToken, passwordChangeRequired: false });
      try { await refreshCurrentUser(); }
      catch (error) {
        if ((error as {response?:{status?:number}})?.response?.status === 401) { await clearSession(); throw error; }
        // A suspended account or disconnected phone retains its own-security path.
      }
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
    } finally { setIsBootstrapping(false); }
  };

  const logout = async () => {
    setCaptureAccount(null);
    try {
      if (sessionRef.current.refreshToken) {
        await staffLogoutQueue.enqueue({server:getServerAddress(),refreshToken:sessionRef.current.refreshToken});
        await staffLogoutQueue.flush();
      }
    } finally {
      await clearSession();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: session.user,
        isBootstrapping,
        passwordChangeRequired,
        requestCode: requestStaffCode,
        signInWithCode,
        logout,
        refreshCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
};
