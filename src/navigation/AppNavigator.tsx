import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AppStackParamList } from './types';
import { HomeScreen } from '../screens/HomeScreen';

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}
