import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function DashboardScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">Dashboard</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.placeholder}>
        Les statistiques (km, durées, D+, records) arriveront à l’étape 6.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  placeholder: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
