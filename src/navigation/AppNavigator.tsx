import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';

import { AppStackParamList, AppTabParamList } from './types';
import { HabitDetailScreen } from '../screens/HabitDetailScreen';
import { HabitFormScreen } from '../screens/HabitFormScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { TodayScreen } from '../screens/TodayScreen';

const Tab = createBottomTabNavigator<AppTabParamList>();
const Stack = createNativeStackNavigator<AppStackParamList>();

// Emoji icons keep Phase 2 free of an icon-font dependency; swap for a real
// icon set during the Phase 6 polish pass if needed.
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text className={`text-xl ${focused ? '' : 'opacity-40'}`}>{emoji}</Text>;
}

function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#059669',
        tabBarInactiveTintColor: '#64748b',
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🔥" focused={focused} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={AppTabs} />
      <Stack.Screen name="HabitDetail" component={HabitDetailScreen} />
      <Stack.Screen
        name="HabitForm"
        component={HabitFormScreen}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
