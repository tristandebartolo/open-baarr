import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function RecordScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">Enregistrer</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.placeholder}>
        L’enregistrement GPS (carte live, start/pause/stop) arrivera à l’étape 5.
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
