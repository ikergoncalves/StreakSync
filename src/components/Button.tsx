import { ActivityIndicator, Pressable, Text } from 'react-native';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  testID?: string;
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const container =
    variant === 'primary'
      ? 'bg-emerald-600 active:bg-emerald-700'
      : 'bg-slate-200 active:bg-slate-300';
  const label = variant === 'primary' ? 'text-white' : 'text-slate-900';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`h-12 flex-row items-center justify-center rounded-xl px-4 ${container} ${
        isDisabled ? 'opacity-60' : ''
      }`}
      disabled={isDisabled}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#ffffff' : '#0f172a'} />
      ) : (
        <Text className={`text-base font-semibold ${label}`}>{title}</Text>
      )}
    </Pressable>
  );
}
