import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form';
import { Text, TextInput, TextInputProps, View } from 'react-native';

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
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <View className="mb-4">
          <Text className="mb-1.5 text-sm font-medium text-slate-700">{label}</Text>
          <TextInput
            className={`rounded-xl border bg-white px-4 py-3 text-base text-slate-900 ${
              error ? 'border-red-500' : 'border-slate-300'
            }`}
            placeholderTextColor="#94a3b8"
            onChangeText={onChange}
            onBlur={onBlur}
            value={typeof value === 'string' ? value : ''}
            {...inputProps}
          />
          {error ? <Text className="mt-1 text-xs text-red-600">{error.message}</Text> : null}
        </View>
      )}
    />
  );
}
