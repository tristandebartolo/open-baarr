import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { countUnsyncedPhotos, countUnsyncedPoints } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';
import { syncNow } from '@/services/sync';
import { useAuthStore } from '@/stores/auth-store';
import { useSyncStore } from '@/stores/sync-store';
import { formatDateTime } from '@/utils/format';

export default function SettingsScreen() {
  const theme = useTheme();
  const profile = useAuthStore((state) => state.profile);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const username = useAuthStore((state) => state.username);
  const refreshProfile = useAuthStore((state) => state.refreshProfile);
  const signOut = useAuthStore((state) => state.signOut);

  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ points: number; photos: number } | null>(null);

  const syncing = useSyncStore((s) => s.syncing);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const lastError = useSyncStore((s) => s.lastError);
  const lastResult = useSyncStore((s) => s.lastResult);

  const loadProfile = async () => {
    try {
      await refreshProfile();
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Profil indisponible.');
    }
  };

  const loadPending = useCallback(async () => {
    const [points, photos] = await Promise.all([countUnsyncedPoints(), countUnsyncedPhotos()]);
    setPending({ points, photos });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPending();
    }, [loadPending]),
  );

  // Déclencheur manuel : le résultat du run (erreur serveur comprise) est
  // affiché tel quel — c'est l'outil de diagnostic de la sync.
  const handleSyncNow = async () => {
    await syncNow('manuel');
    await loadPending();
  };

  // Profil absent (démarrage hors-ligne) : nouvelle tentative à l'ouverture de l'écran.
  // setState uniquement après await (pas de rendu en cascade), le linter ne peut pas le voir.
  useEffect(() => {
    if (profile === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  };

  return (
    <ThemedView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          COMPTE
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Row label="Utilisateur" value={profile?.name ?? username ?? '—'} />
          <Row label="E-mail" value={profile?.mail ?? '—'} />
          <Row label="Rôles" value={profile?.roles.join(', ') ?? '—'} />
          <Row
            label="Enregistrement"
            value={profile === null ? '—' : profile.permissions.record ? 'autorisé' : 'refusé'}
          />
          <Row label="Serveur" value={serverUrl ?? '—'} />
        </View>

        {loadError !== null && (
          <ThemedText type="small" style={styles.error}>
            {loadError}
          </ThemedText>
        )}

        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.syncTitle}>
          SYNCHRONISATION
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Row
            label="Points en attente"
            value={pending !== null ? String(pending.points) : '—'}
          />
          <Row
            label="Photos en attente"
            value={pending !== null ? String(pending.photos) : '—'}
          />
          <Row
            label="Dernière synchronisation"
            value={lastSyncAt !== null ? formatDateTime(Math.floor(lastSyncAt / 1000)) : '—'}
          />
          <Row label="Dernier résultat" value={lastResult ?? '—'} />
        </View>
        {lastError !== null && (
          <ThemedText type="small" style={styles.error}>
            Erreur : {lastError}
          </ThemedText>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={syncing}
          style={({ pressed }) => [
            styles.syncButton,
            { backgroundColor: Palette.accent, opacity: pressed || syncing ? 0.7 : 1 },
          ]}
          onPress={() => void handleSyncNow()}>
          {syncing ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <ThemedText type="smallBold" style={styles.syncButtonLabel}>
              Synchroniser maintenant
            </ThemedText>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          style={[styles.logoutButton, { backgroundColor: theme.backgroundElement }]}
          onPress={() => void signOut()}>
          <ThemedText type="smallBold" style={styles.logoutLabel}>
            Se déconnecter
          </ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.rowValue} numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    padding: Spacing.three,
  },
  sectionTitle: {
    marginBottom: Spacing.one,
    marginLeft: Spacing.two,
  },
  syncTitle: {
    marginTop: Spacing.four,
    marginBottom: Spacing.one,
    marginLeft: Spacing.two,
  },
  syncButton: {
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: Spacing.two,
  },
  syncButtonLabel: {
    color: '#ffffff',
  },
  card: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 12,
  },
  rowValue: {
    flexShrink: 1,
  },
  error: {
    color: '#d64545',
    marginTop: Spacing.two,
    marginLeft: Spacing.two,
  },
  logoutButton: {
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: Spacing.four,
  },
  logoutLabel: {
    color: '#d64545',
  },
});
