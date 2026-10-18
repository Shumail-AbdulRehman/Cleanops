import type { RootStackParamList, StaffTabsParamList } from "../types";

// Checked route names. Screens navigate with these instead of string literals,
// so a typo fails typecheck. `Shift` and `Tasks` must never change: push
// notifications (notificationDestination) and deep links open them by name.
export const tabRoutes = {
  myDay: "Shift",
  tasks: "Tasks",
  history: "History",
  profile: "Profile",
} as const satisfies Record<string, keyof StaffTabsParamList>;

export const stackRoutes = {
  login: "Login",
  staffTabs: "StaffTabs",
  taskDetail: "TaskDetail",
  startTask: "StartTask",
  verification: "Verification",
  helpGuide: "HelpGuide",
  taskAlerts: "TaskAlerts",
  historyTask: "HistoryTask",
} as const satisfies Record<string, keyof RootStackParamList>;

export type TabRouteName = (typeof tabRoutes)[keyof typeof tabRoutes];
export type StackRouteName = (typeof stackRoutes)[keyof typeof stackRoutes];
