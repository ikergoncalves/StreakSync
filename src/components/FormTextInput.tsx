import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form';
import { Text, TextInput, TextInputProps, useColorScheme, View } from 'react-native';

import { getInlineColors } from '../lib/theme';

interface FormTextInputProps<T extends FieldValues> extends TextInputProps {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
}

export function FormTextInput<T extends FieldValues>({
  control,
  name,
  label,
  ...inputProps
}: FormTextInputProps<T>) {
  const inlineColors = getInlineColors(useColorScheme());

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <View className="mb-4">
          <Text className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            {label}
          </Text>
          <TextInput
            className={`rounded-xl border bg-white px-4 py-3 text-base text-slate-900 dark:bg-slate-900 dark:text-slate-50 ${
              error ? 'border-red-500' : 'border-slate-300 dark:border-slate-700'
            }`}
            placeholderTextColor={inlineColors.placeholder}
            onChangeText={onChange}
            onBlur={onBlur}
            value={typeof value === 'string' ? value : ''}
            {...inputProps}
          />
          {error ? (
            <Text className="mt-1 text-xs text-red-600 dark:text-red-400">{error.message}</Text>
          ) : null}
        </View>
      )}
    />
  );
}
