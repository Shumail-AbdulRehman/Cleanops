import { v5Colors } from './src/theme';
import { NativeFontsReady, staffFonts } from './src/fonts';
import { useFonts } from 'expo-font';
import { LanguageProvider, useLanguage } from "./src/i18n/LanguageProvider";
import * as Application from "expo-application";
import { configureNativeAppVersion } from "./src/api/client";
configureNativeAppVersion(Application.nativeApplicationVersion);
import "./global.css";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthContext";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { useState } from 'react';
import { NotificationProvider } from './src/notifications/NotificationProvider';
import { NotificationNavigation,staffNavigation } from './src/notifications/NotificationNavigation';

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: v5Colors.surface,
    card: v5Colors.surface,
    text: v5Colors.ink,
    border: v5Colors.border,
    primary: v5Colors.primary,
  },
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchOnMount: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

function LocalizedNavigation() {
  const { isRTL } = useLanguage();
  const [ready,setReady]=useState(false);
  return (
    <NavigationContainer ref={staffNavigation} onReady={()=>setReady(true)} theme={navTheme} direction={isRTL ? "rtl" : "ltr"}>
      <StatusBar style="dark" />
      <NotificationNavigation ready={ready}/>
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsReady] = useFonts(staffFonts);
  return (
    <NativeFontsReady.Provider value={fontsReady}>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <NotificationProvider><LocalizedNavigation /></NotificationProvider>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
    </NativeFontsReady.Provider>
  );
}
