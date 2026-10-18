import * as React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { createBottomTabNavigator, type BottomTabBarProps, type BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
// Namespace import: the node test mocks of this package only provide `createBottomTabNavigator`.
import * as BottomTabs from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type LucideIconName } from "../components/ui/icon";
import { useAuth } from "../auth/AuthContext";
import { StaffText } from "../design/StaffText";
import { displayFor, groupTodayTasks, taskDisplay } from "../design/taskState";
import { colors, radius, space, tabBarHeight, type } from "../design/tokens";
import { useLanguage } from "../i18n/LanguageProvider";
import { HistoryScreen } from "../screens/history/HistoryScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { TasksScreen } from "../screens/TasksScreen";
import { ProfileScreen } from "../screens/profile/ProfileScreen";
import { useTodaysTasksQuery } from "../queries/staff";
import type { StaffTabsParamList } from "../types";
import { tabRoutes } from "./routeNames";

const Tab = createBottomTabNavigator<StaffTabsParamList>();

/** Icon inside the 62 by 32 pip; the pip is filled only on the active tab. */
function TabIcon({ name, focused }: { name: LucideIconName; focused: boolean }) {
  return (
    <View testID={focused ? "tab-pip-active" : "tab-pip"} style={[styles.pip, focused ? styles.pipActive : null]}>
      <Icon name={name} size={24} color={focused ? colors.blueDeep : colors.muted} />
    </View>
  );
}

/** Translated tab label in the `label` role. */
function TabLabel({ text, focused }: { text: string; focused: boolean }) {
  return (
    <StaffText role="label" color={focused ? "blueDeep" : "muted"} align="center" numberOfLines={1} translate={false}>
      {text}
    </StaffText>
  );
}

const BADGE_NEEDS_YOU = { backgroundColor: colors.yellow, color: colors.ink };
const BADGE_OPEN = { backgroundColor: colors.blue, color: colors.surface };

/**
 * Count for the Tasks tab: pending plus in progress, yellow when a task needs the person.
 * Tabs mount lazily, so this reads the shared today's-tasks query here instead of from inside Tasks.
 * The query is observed with `enabled = false`: it adds no request and no poll; My day (the initial tab)
 * and Tasks keep the same cache entry fresh.
 */
function useTasksBadge(): Pick<BottomTabNavigationOptions, "tabBarBadge" | "tabBarBadgeStyle"> {
  const { user } = useAuth();
  const tasksQuery = useTodaysTasksQuery(user?.id, false);
  const tasks = tasksQuery.data ?? [];
  const pending = tasksQuery.counts?.pending ?? tasks.filter(task => task.status === "PENDING").length;
  const inProgress = tasksQuery.counts?.inProgress ?? tasks.filter(task => task.status === "IN_PROGRESS").length;
  const needsYou = groupTodayTasks(tasks).needsYou.some(task => displayFor(taskDisplay(task)).needsYou);
  const count = pending + inProgress;
  return { tabBarBadge: count > 0 ? count : undefined, tabBarBadgeStyle: needsYou ? BADGE_NEEDS_YOU : BADGE_OPEN };
}

function tabOptions(title: string, icon: LucideIconName, extra?: Partial<BottomTabNavigationOptions>): BottomTabNavigationOptions {
  return {
    ...extra,
    title,
    tabBarLabel: ({ focused }) => <TabLabel text={title} focused={focused} />,
    tabBarIcon: ({ focused }) => <TabIcon name={icon} focused={focused} />,
  };
}

/** The Profile tab takes no navigator props; it reads its own month and work summary. */
function ProfileTab() {
  return <ProfileScreen />;
}

/** Tabs in reading order. In Urdu the bar is mirrored (My day on the right); routes keep their names and focus. */
const tabs = [
  { name: tabRoutes.myDay, component: HomeScreen, title: "My day", icon: "Clock" },
  { name: tabRoutes.tasks, component: TasksScreen, title: "Tasks", icon: "ListChecks" },
  { name: tabRoutes.history, component: HistoryScreen, title: "History", icon: "RotateCcwClock" },
  { name: tabRoutes.profile, component: ProfileTab, title: "Profile", icon: "UserRound" },
] as const satisfies readonly { name: keyof StaffTabsParamList; component: React.ComponentType; title: string; icon: LucideIconName }[];

/**
 * The tab bar, or nothing while the focused tab asks to be full screen: My day sets `fullScreen`
 * while it shows locating, the selfie camera or the receipt (spec 67).
 */
export function StaffTabBar(props: BottomTabBarProps) {
  const focused = props.state.routes[props.state.index];
  const params = focused?.params as { fullScreen?: boolean } | undefined;
  if (params?.fullScreen) return null;
  return <BottomTabs.BottomTabBar {...props} />;
}

/** My day, Tasks, History and Profile. */
export function StaffTabs() {
  const { t, language, isRTL } = useLanguage();
  const insets = useSafeAreaInsets();
  const tasksBadge = useTasksBadge();
  const { fontScale } = useWindowDimensions();
  const barHeight = tabBarHeight(insets.bottom, type.label[language].lineHeight, fontScale);
  const itemHeight = barHeight - space.tabBarPadTop - space.tabBarPadBottom - insets.bottom;
  return (
    <Tab.Navigator
      initialRouteName={tabRoutes.myDay}
      backBehavior="initialRoute"
      tabBar={StaffTabBar}
      screenOptions={{
        headerShown: false,
        animation: "none",
        tabBarActiveTintColor: colors.blueDeep,
        tabBarInactiveTintColor: colors.muted,
        tabBarAllowFontScaling: true,
        tabBarIconStyle: styles.iconBox,
        tabBarItemStyle: [styles.item, { minHeight: itemHeight }],
        tabBarBadgeStyle: styles.badge,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: barHeight,
          paddingTop: space.tabBarPadTop,
          paddingBottom: space.tabBarPadBottom + insets.bottom,
        },
      }}
    >
      {(isRTL ? [...tabs].reverse() : tabs).map(tab => (
        <Tab.Screen key={tab.name} name={tab.name} component={tab.component} options={tabOptions(t(tab.title), tab.icon, tab.name === tabRoutes.tasks ? tasksBadge : undefined)} />
      ))}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: 0, justifyContent: "flex-start" },
  iconBox: { width: space.tabPipWidth, height: space.tabPipHeight },
  pip: {
    width: space.tabPipWidth,
    height: space.tabPipHeight,
    borderRadius: radius.tabPipRadius,
    alignItems: "center",
    justifyContent: "center",
  },
  pipActive: { backgroundColor: colors.blueWash },
  badge: { backgroundColor: colors.blue, color: colors.surface },
});
