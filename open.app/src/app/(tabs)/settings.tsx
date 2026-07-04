import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/stores/auth-store';

export default function SettingsScreen() {
  const theme = useTheme();
  const profile = useAuthStore((state) => state.profile);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const username = useAuthStore((state) => state.username);
  const refreshProfile = useAuthStore((state) => state.refreshProfile);
  const signOut = useAuthStore((state) => state.signOut);

  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProfile = async () => {
    try {
      await refreshProfile();
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Profil indisponible.');
    }
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
