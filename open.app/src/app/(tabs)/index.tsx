/**
 * Dashboard : totaux, records et graphe des distances quotidiennes,
 * alimentés par GET /stats/summary (trajets `completed` du compte).
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { PeriodChips, type Period } from '@/components/period-chips';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchStatsSummary, type StatsSummary } from '@/services/trips';
import { chartFont } from '@/utils/chart';
import {
  formatDayShort,
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from '@/utils/format';

const ACCENT = '#208AEF';

export default function DashboardScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('week');
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (p: Period) => {
    try {
      const summary = await fetchStatsSummary(p);
      setStats(summary);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Statistiques indisponibles.');
    }
  }, []);

  // setState uniquement après await (pas de rendu en cascade), le linter ne peut pas le voir.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(period);
  }, [load, period]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load(period);
    setRefreshing(false);
  };

  const series = (stats?.series ?? []).map((day, index) => ({
    index,
    km: day.distance / 1000,
    label: formatDayShort(day.date),
  }));

  return (
    <ThemedView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}>
        <PeriodChips value={period} onChange={setPeriod} />

        {error !== null && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <View style={styles.tilesRow}>
          <Tile label="Trajets" value={stats !== null ? String(stats.totals.trips) : '—'} />
          <Tile
            label="Distance"
            value={stats !== null ? formatDistance(stats.totals.distance) : '—'}
          />
        </View>
        <View style={styles.tilesRow}>
          <Tile
            label="En mouvement"
            value={stats !== null ? formatDuration(stats.totals.duration * 1000) : '—'}
          />
          <Tile
            label="Dénivelé +"
            value={stats !== null ? formatElevation(stats.totals.elevation_gain) : '—'}
          />
        </View>

        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          DISTANCE PAR JOUR
        </ThemedText>
        <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement }]}>
          {series.length > 0 ? (
            <CartesianChart
              data={series}
              xKey="index"
              yKeys={['km']}
              domainPadding={{ left: 24, right: 24, top: 12 }}
              axisOptions={{
                font: chartFont(),
                labelColor: theme.textSecondary,
                lineColor: theme.backgroundSelected,
                formatXLabel: (value) => series[Math.round(Number(value))]?.label ?? '',
                formatYLabel: (value) => `${Math.round(Number(value) * 10) / 10}`,
              }}>
              {({ points, chartBounds }) => (
                <Bar
                  points={points.km}
                  chartBounds={chartBounds}
                  color={ACCENT}
                  innerPadding={0.4}
                  roundedCorners={{ topLeft: 4, topRight: 4 }}
                />
              )}
            </CartesianChart>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyChart}>
              Aucun trajet terminé sur la période.
            </ThemedText>
          )}
        </View>

        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          RECORDS
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Row
            label="Plus longue distance"
            value={stats !== null ? formatDistance(stats.records.longest_distance) : '—'}
          />
          <Row
            label="Vitesse max"
            value={stats !== null ? formatSpeed(stats.records.max_speed) : '—'}
          />
          <Row
            label="Plus longue durée"
            value={stats !== null ? formatDuration(stats.records.longest_duration * 1000) : '—'}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.tileValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  tilesRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tile: {
    flex: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  tileValue: {
    fontSize: 22,
    lineHeight: 28,
  },
  sectionTitle: {
    marginTop: Spacing.two,
    marginLeft: Spacing.two,
  },
  chartCard: {
    borderRadius: 12,
    padding: Spacing.two,
    height: 220,
  },
  emptyChart: {
    textAlign: 'center',
    marginTop: 90,
  },
  card: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  error: {
    color: '#D64545',
    marginLeft: Spacing.two,
  },
});
