/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // `media` makes every `dark:` variant follow the OS appearance setting
  // automatically (NativeWind resolves it through the Appearance API on
  // native). This is NativeWind's default; it is spelled out here because
  // the whole dark theme relies on it — there is no manual toggle.
  darkMode: 'media',
  theme: {
    extend: {},
  },
  plugins: [],
};
