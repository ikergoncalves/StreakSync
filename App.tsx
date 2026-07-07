import './global.css';

import { LinkingOptions, NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getNavigationTheme } from './src/lib/theme';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AppStackParamList } from './src/navigation/types';
import { useAuthStore } from './src/store/auth';

// Custom-scheme deep links only (streaksync://join/CODE) — no verified
// universal/app links or associated domains, which is the right scope for
// this project. Linking.createURL additionally covers the Expo Go dev URL
// form (exp://<host>/--/join/CODE). When the user is signed out the App
// stack isn't mounted, so the link is simply ignored and they land on
// sign-in; the manual code entry on JoinGroupScreen is the fallback.
const linking: LinkingOptions<AppStackParamList> = {
  prefixes: [Linking.createURL('/'), 'streaksync://'],
  config: {
    screens: {
      JoinGroup: 'join/:code',
    },
  },
};

export default function App() {
  const initialize = useAuthStore((state) => state.initialize);
  // NativeWind's dark: classes follow the OS on their own; the navigation
  // theme (tab bar, transition backgrounds) and status bar can't, so they
  // get the color scheme explicitly. "auto" flips the status bar content
  // between dark-on-light and light-on-dark with the OS appearance.
  const colorScheme = useColorScheme();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <SafeAreaProvider>
      <NavigationContainer linking={linking} theme={getNavigationTheme(colorScheme)}>
        <RootNavigator />
        <StatusBar style="auto" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
