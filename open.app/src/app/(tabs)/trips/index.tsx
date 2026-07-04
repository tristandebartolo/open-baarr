import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function TripsScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">Trajets</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.placeholder}>
        L’historique des trajets (liste + détail) arrivera aux étapes 5 et 6.
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
