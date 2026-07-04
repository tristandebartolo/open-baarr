import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function TripsLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
      }}>
      <Stack.Screen name="index" options={{ title: 'Trajets' }} />
      <Stack.Screen name="[uuid]" options={{ title: 'Trajet', headerBackTitle: 'Trajets' }} />
    </Stack>
  );
}
