import { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScreenProps {
  children: ReactNode;
  /** Safe-area sides to pad. Tab screens skip 'bottom': the tab bar covers it. */
  edges?: ('top' | 'bottom')[];
}

// Applies safe-area padding through insets instead of SafeAreaView so the
// container stays a plain View that NativeWind classes apply to directly.
export function Screen({ children, edges = ['top', 'bottom'] }: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      style={{
        paddingTop: edges.includes('top') ? insets.top : 0,
        paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
      }}
    >
      {children}
    </View>
  );
}
