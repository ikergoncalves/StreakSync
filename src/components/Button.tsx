import { ActivityIndicator, Pressable, Text } from 'react-native';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  testID?: string;
}

const CONTAINER_BY_VARIANT = {
  primary: 'bg-emerald-600 active:bg-emerald-700',
  secondary: 'bg-slate-200 active:bg-slate-300',
  danger: 'bg-red-600 active:bg-red-700',
} as const;

const LABEL_BY_VARIANT = {
  primary: 'text-white',
  secondary: 'text-slate-900',
  danger: 'text-white',
} as const;

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`h-12 flex-row items-center justify-center rounded-xl px-4 ${CONTAINER_BY_VARIANT[variant]} ${
        isDisabled ? 'opacity-60' : ''
      }`}
      disabled={isDisabled}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? '#0f172a' : '#ffffff'} />
      ) : (
        <Text className={`text-base font-semibold ${LABEL_BY_VARIANT[variant]}`}>{title}</Text>
      )}
    </Pressable>
  );
}
