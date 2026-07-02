import { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScreenProps {
  children: ReactNode;
}

// Applies safe-area padding through insets instead of SafeAreaView so the
// container stays a plain View that NativeWind classes apply to directly.
export function Screen({ children }: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 bg-slate-50"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {children}
    </View>
  );
}
