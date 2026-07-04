/** Sélecteur de période du dashboard (7 jours / 30 jours / tout). */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { StatsPeriod } from '@/services/trips';

export type Period = StatsPeriod;

const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: '7 jours' },
  { value: 'month', label: '30 jours' },
  { value: 'all', label: 'Tout' },
];

const ACCENT = '#208AEF';

export function PeriodChips({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {PERIODS.map((period) => {
        const selected = period.value === value;
        return (
          <Pressable
            key={period.value}
            onPress={() => onChange(period.value)}
            style={[
              styles.chip,
              { backgroundColor: selected ? ACCENT : theme.backgroundElement },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: selected ? '#ffffff' : theme.text }}>
              {period.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 20,
  },
});
