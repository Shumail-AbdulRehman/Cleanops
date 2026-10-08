import axios from "axios";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { createLogoutQueue } from "./logoutQueue";
const KEY = "hygene-pending-logouts";
export const staffLogoutQueue = createLogoutQueue(
  {
    read: () =>
      Platform.OS === "web"
        ? AsyncStorage.getItem(KEY)
        : SecureStore.getItemAsync(KEY),
    write: async (value) => {
      if (Platform.OS === "web") {
        if (value) await AsyncStorage.setItem(KEY, value);
        else await AsyncStorage.removeItem(KEY);
      } else {
        if (value) await SecureStore.setItemAsync(KEY, value);
        else await SecureStore.deleteItemAsync(KEY);
      }
    },
  },
  async (entry) => {
    await axios.post(
      entry.server + "/common/logout",
      { refreshToken: entry.refreshToken },
      { timeout: 5000, withCredentials: false },
    );
  },
);
