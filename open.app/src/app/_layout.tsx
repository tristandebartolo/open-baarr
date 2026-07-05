import * as QuickActions from 'expo-quick-actions';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

// Effet de bord obligatoire : enregistre la tâche GPS background
// (TaskManager.defineTask doit s'exécuter au chargement du bundle).
import '@/tasks/locationTask';

import { initSyncTriggers, syncNow } from '@/services/sync';
import { useAuthStore } from '@/stores/auth-store';
import { useRecordStore } from '@/stores/record-store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const status = useAuthStore((state) => state.status);
  const restore = useAuthStore((state) => state.restore);

  // Appui long sur l'icône → navigation vers la route de l'action.
  useQuickActionRouting();

  useEffect(() => {
    void restore();
    // Trajet actif interrompu (app tuée en cours d'enregistrement) :
    // reprise du suivi et des stats, indépendamment de la session.
    void useRecordStore.getState().restore();

    // Raccourci statique (jamais mis à jour dynamiquement — pas de requête,
    // préservation batterie) : l'écran Enregistrer restaure de lui-même
    // l'enregistrement en cours, ou permet d'en créer un.
    void QuickActions.setItems([
      {
        id: 'record',
        title: 'Enregistrer un trajet',
        subtitle: 'Reprendre ou démarrer',
        icon: 'symbol:record.circle',
        params: { href: '/(tabs)/record' },
      },
    ]);
  }, [restore]);

  useEffect(() => {
    if (status !== 'restoring') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  // Déclencheurs de sync : ouverture de l'app (session valide) + retour réseau.
  useEffect(() => {
    if (status === 'signedIn') {
      initSyncTriggers();
      void syncNow('ouverture');
    }
  }, [status]);

  // Splash maintenu tant que SecureStore n'a pas été lu :
  // évite un flash de l'écran login quand une session existe.
  if (status === 'restoring') {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={status !== 'signedIn'}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
