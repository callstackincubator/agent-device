import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastViewport } from '../src/components';
import { LabStateProvider, useLabState } from '../src/lab-state';
import { getNavigationTheme, useAppColors } from '../src/theme';

function RootLayoutContent() {
  const colors = useAppColors();
  const { toastMessage } = useLabState();

  return (
    <ThemeProvider value={getNavigationTheme(colors)}>
      <StatusBar style={colors.mode === 'light' ? 'dark' : 'light'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.surface },
          headerShown: false,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="product/[productId]" />
      </Stack>
      {toastMessage ? <ToastViewport message={toastMessage} /> : null}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LabStateProvider>
        <RootLayoutContent />
      </LabStateProvider>
    </SafeAreaProvider>
  );
}
