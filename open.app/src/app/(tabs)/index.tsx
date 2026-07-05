/**
 * Dashboard : carte héro (distance de la période), graphe journalier
 * continu, répartition par activité, santé de la période, records et
 * dernier trajet — alimenté par GET /stats/summary + GET /trips (2 requêtes
 * par chargement, au focus et au pull-to-refresh, pas de polling).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACTIVITY_COLORS, ACTIVITY_ICONS, ACTIVITY_LABELS } from '@/constants/activities';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchStatsSummary,
  fetchTrips,
  type StatsPeriod,
  type StatsSummary,
  type TripSummary,
} from '@/services/trips';
import { weatherIcon, weatherLabel } from '@/services/weather';
import { chartFont } from '@/utils/chart';
import {
  activityBreakdown,
  fillDailySeries,
  healthAggregates,
  latestTrip,
  tripsInPeriod,
} from '@/utils/dashboard';
import {
  formatDateTime,
  formatDayShort,
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from '@/utils/format';

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'week', label: '7 jours' },
  { value: 'month', label: '30 jours' },
  { value: 'all', label: 'Tout' },
];

/** « YYYY-MM-DD » local (le serveur agrège par date locale du serveur). */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DashboardScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  /** Horodatage du chargement : ancre des fenêtres 7/30 j (pureté du rendu). */
  const [loadedAt, setLoadedAt] = useState<{ epoch: number; day: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (p: StatsPeriod) => {
    try {
      const [summary, list] = await Promise.all([
        fetchStatsSummary(p),
        fetchTrips({ status: 'completed', limit: 50 }),
      ]);
      setStats(summary);
      setTrips(list.items);
      setLoadedAt({ epoch: Math.floor(Date.now() / 1000), day: todayIso() });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Statistiques indisponibles.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(period);
    }, [load, period]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await load(period);
    setRefreshing(false);
  };

  const series = useMemo(
    () =>
      (stats !== null && loadedAt !== null
        ? fillDailySeries(stats.series, period, loadedAt.day)
        : []
      ).map((day, index) => ({ index, km: day.km, label: formatDayShort(day.date) })),
    [stats, period, loadedAt],
  );
  const periodTrips = useMemo(
    () => (loadedAt !== null ? tripsInPeriod(trips, period, loadedAt.epoch) : []),
    [trips, period, loadedAt],
  );
  const breakdown = useMemo(() => activityBreakdown(periodTrips), [periodTrips]);
  const health = useMemo(() => healthAggregates(periodTrips), [periodTrips]);
  const latest = useMemo(() => latestTrip(trips), [trips]);

  // Un libellé d'axe sur n, pour rester lisible en 30 jours.
  const xLabelStep = Math.max(1, Math.ceil(series.length / 7));

  return (
    <ThemedView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}>
        {/* Carte héro : période + distance en très grand. */}
        <View style={styles.hero}>
          <View style={styles.heroChips}>
            {PERIODS.map((item) => {
              const selected = item.value === period;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => setPeriod(item.value)}
                  style={[
                    styles.heroChip,
                    { backgroundColor: selected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.18)' },
                  ]}>
                  <ThemedText
                    type="smallBold"
                    style={{ color: selected ? Palette.accent : '#FFFFFF' }}>
                    {item.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText style={styles.heroValue}>
            {stats !== null ? formatDistance(stats.totals.distance) : '—'}
          </ThemedText>
          <ThemedText type="small" style={styles.heroSubline}>
            {stats !== null
              ? `${stats.totals.trips} trajet${stats.totals.trips > 1 ? 's' : ''} · ${formatDuration(stats.totals.duration * 1000)} en mouvement · D+ ${formatElevation(stats.totals.elevation_gain)}`
              : ' '}
          </ThemedText>
        </View>

        {error !== null && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <SectionTitle title="DISTANCE PAR JOUR" />
        <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement }]}>
          {series.some((day) => day.km > 0) ? (
            <CartesianChart
              data={series}
              xKey="index"
              yKeys={['km']}
              domainPadding={{ left: 16, right: 16, top: 16 }}
              axisOptions={{
                font: chartFont(),
                labelColor: theme.textSecondary,
                lineColor: theme.backgroundSelected,
                formatXLabel: (value) => {
                  const index = Math.round(Number(value));
                  return index % xLabelStep === 0 ? (series[index]?.label ?? '') : '';
                },
                formatYLabel: (value) => `${Math.round(Number(value) * 10) / 10}`,
              }}>
              {({ points, chartBounds }) => (
                <Bar
                  points={points.km}
                  chartBounds={chartBounds}
                  color={Palette.accent}
                  innerPadding={series.length > 10 ? 0.25 : 0.45}
                  roundedCorners={{ topLeft: 5, topRight: 5 }}
                />
              )}
            </CartesianChart>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyChart}>
              Aucun trajet terminé sur la période.
            </ThemedText>
          )}
        </View>

        {breakdown.length > 0 && (
          <>
            <SectionTitle title="PAR ACTIVITÉ" />
            <View style={[styles.card, styles.breakdownCard, { backgroundColor: theme.backgroundElement }]}>
              {breakdown.map((entry) => (
                <View key={entry.type} style={styles.breakdownRow}>
                  <View
                    style={[
                      styles.breakdownIcon,
                      { backgroundColor: ACTIVITY_COLORS[entry.type] + '22' },
                    ]}>
                    <Ionicons
                      name={ACTIVITY_ICONS[entry.type] as keyof typeof Ionicons.glyphMap}
                      size={16}
                      color={ACTIVITY_COLORS[entry.type]}
                    />
                  </View>
                  <View style={styles.breakdownBody}>
                    <View style={styles.breakdownHeader}>
                      <ThemedText type="small">{ACTIVITY_LABELS[entry.type]}</ThemedText>
                      <ThemedText type="smallBold">{formatDistance(entry.distance)}</ThemedText>
                    </View>
                    <View style={[styles.breakdownTrack, { backgroundColor: theme.backgroundSelected }]}>
                      <View
                        style={[
                          styles.breakdownFill,
                          {
                            backgroundColor: ACTIVITY_COLORS[entry.type],
                            width: `${Math.max(3, Math.round(entry.share * 100))}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {(health.hrAvg !== null || health.steps !== null || health.calories !== null) && (
          <>
            <SectionTitle title="SANTÉ DE LA PÉRIODE" />
            <View style={styles.tilesRow}>
              <Tile
                icon="heart-outline"
                color={Palette.danger}
                label="FC moyenne"
                value={health.hrAvg !== null ? `${health.hrAvg} bpm` : '—'}
              />
              <Tile
                icon="footsteps-outline"
                color={Palette.success}
                label="Pas"
                value={health.steps !== null ? health.steps.toLocaleString('fr-FR') : '—'}
              />
              <Tile
                icon="flame-outline"
                color="#E8890C"
                label="Calories"
                value={health.calories !== null ? `${health.calories.toLocaleString('fr-FR')} kcal` : '—'}
              />
            </View>
          </>
        )}

        <SectionTitle title="RECORDS" />
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <RecordRow
            icon="trophy-outline"
            label="Plus longue distance"
            value={stats !== null ? formatDistance(stats.records.longest_distance) : '—'}
          />
          <RecordRow
            icon="flash-outline"
            label="Vitesse max"
            value={stats !== null ? formatSpeed(stats.records.max_speed) : '—'}
          />
          <RecordRow
            icon="hourglass-outline"
            label="Plus longue durée"
            value={stats !== null ? formatDuration(stats.records.longest_duration * 1000) : '—'}
          />
        </View>

        {latest !== null && (
          <>
            <SectionTitle title="DERNIER TRAJET" />
            <Pressable
              onPress={() =>
                router.push({ pathname: '/(tabs)/trips/[uuid]', params: { uuid: latest.uuid } })
              }
              style={({ pressed }) => [
                styles.card,
                styles.latestCard,
                { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
              ]}>
              <View
                style={[
                  styles.latestIcon,
                  {
                    backgroundColor:
                      (latest.activity_type !== null
                        ? ACTIVITY_COLORS[latest.activity_type]
                        : Palette.accent) + '22',
                  },
                ]}>
                <Ionicons
                  name={
                    (latest.activity_type !== null
                      ? ACTIVITY_ICONS[latest.activity_type]
                      : 'map') as keyof typeof Ionicons.glyphMap
                  }
                  size={20}
                  color={
                    latest.activity_type !== null
                      ? ACTIVITY_COLORS[latest.activity_type]
                      : Palette.accent
                  }
                />
              </View>
              <View style={styles.latestBody}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {latest.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDateTime(latest.started_at)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {latest.metrics.distance !== null ? formatDistance(latest.metrics.distance) : '—'}
                  {latest.metrics.duration !== null
                    ? ` · ${formatDuration(latest.metrics.duration * 1000)}`
                    : ''}
                  {latest.weather.temperature !== null
                    ? ` · ${latest.weather.temperature.toFixed(0)} °C${latest.weather.weather_code !== null ? ` ${weatherLabel(latest.weather.weather_code).toLowerCase()}` : ''}`
                    : ''}
                </ThemedText>
              </View>
              {latest.weather.weather_code !== null && (
                <Ionicons
                  name={weatherIcon(latest.weather.weather_code) as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={theme.textSecondary}
                />
              )}
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
      {title}
    </ThemedText>
  );
}

function Tile({
  icon,
  color,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
      <Ionicons name={icon} size={18} color={color} />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.tileValue} numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
  );
}

function RecordRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.recordRow}>
      <Ionicons name={icon} size={17} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.recordLabel}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
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
  hero: {
    backgroundColor: Palette.accent,
    borderRadius: 24,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  heroChips: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  heroChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: 16,
  },
  heroValue: {
    color: '#FFFFFF',
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '700',
  },
  heroSubline: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  sectionTitle: {
    letterSpacing: 1,
    marginTop: Spacing.two,
    marginLeft: Spacing.two,
  },
  chartCard: {
    borderRadius: 16,
    padding: Spacing.two,
    height: 200,
  },
  emptyChart: {
    textAlign: 'center',
    marginTop: 80,
  },
  card: {
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  breakdownCard: {
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  breakdownIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakdownBody: {
    flex: 1,
    gap: 4,
  },
  breakdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: 6,
    borderRadius: 3,
  },
  tilesRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tile: {
    flex: 1,
    borderRadius: 16,
    padding: Spacing.two + 4,
    gap: 2,
  },
  tileValue: {
    fontSize: 15,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 11,
  },
  recordLabel: {
    flex: 1,
  },
  latestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two + 4,
  },
  latestIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  latestBody: {
    flex: 1,
    gap: 2,
  },
  error: {
    color: Palette.danger,
    marginLeft: Spacing.two,
  },
});
