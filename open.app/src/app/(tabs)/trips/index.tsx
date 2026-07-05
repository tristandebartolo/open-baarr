/**
 * Historique des trajets : liste paginée servie par GET /trips, groupée par
 * mois, avec un rappel du nombre de points encore à synchroniser depuis cet
 * appareil. Le serveur est la source de vérité une fois la sync passée.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACTIVITY_COLORS, ACTIVITY_ICONS } from '@/constants/activities';
import { Palette, Spacing } from '@/constants/theme';
import { countUnsyncedPoints } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';
import { syncNow } from '@/services/sync';
import { useSyncStore } from '@/stores/sync-store';
import { fetchTrips, type TripSummary } from '@/services/trips';
import { formatDateTime, formatDistance, formatDuration, formatMonthYear } from '@/utils/format';

const PAGE_SIZE = 50;

type TripSection = {
  title: string;
  data: TripSummary[];
};

export default function TripsScreen() {
  const theme = useTheme();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const syncing = useSyncStore((s) => s.syncing);

  const loadFirstPage = useCallback(async () => {
    try {
      const [response, unsynced] = await Promise.all([
        fetchTrips({ page: 0, limit: PAGE_SIZE }),
        countUnsyncedPoints(),
      ]);
      setTrips(response.items);
      setTotal(response.total);
      setPage(0);
      setPendingPoints(unsynced);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trajets indisponibles.');
    }
  }, []);

  // Rechargement à chaque retour sur l'onglet (un trajet vient peut-être
  // d'être synchronisé, repris ou supprimé).
  useFocusEffect(
    useCallback(() => {
      void loadFirstPage();
    }, [loadFirstPage]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadFirstPage();
    setRefreshing(false);
  };

  // Forçage manuel depuis le bandeau « en attente ».
  const handleSyncNow = async () => {
    await syncNow('manuel');
    await loadFirstPage();
  };

  const handleEndReached = async () => {
    if (loadingMore || trips.length >= total) {
      return;
    }
    setLoadingMore(true);
    try {
      const response = await fetchTrips({ page: page + 1, limit: PAGE_SIZE });
      setTrips((current) => [...current, ...response.items]);
      setTotal(response.total);
      setPage(response.page);
    } catch {
      // Pagination silencieuse : le pull-to-refresh réessaiera.
    } finally {
      setLoadingMore(false);
    }
  };

  // Sections par mois (la liste API est déjà triée par date décroissante).
  const sections = useMemo<TripSection[]>(() => {
    const grouped: TripSection[] = [];
    for (const trip of trips) {
      const title = formatMonthYear(trip.started_at);
      const last = grouped[grouped.length - 1];
      if (last !== undefined && last.title === title) {
        last.data.push(trip);
      } else {
        grouped.push({ title, data: [trip] });
      }
    }
    return grouped;
  }, [trips]);

  return (
    <ThemedView style={styles.flex}>
      <SectionList
        sections={sections}
        keyExtractor={(trip) => trip.uuid}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => void handleEndReached()}
        ListHeaderComponent={
          <>
            {pendingPoints > 0 && (
              <Pressable
                accessibilityRole="button"
                disabled={syncing}
                onPress={() => void handleSyncNow()}
                style={({ pressed }) => [
                  styles.pendingBanner,
                  { backgroundColor: Palette.warning + '22', opacity: pressed ? 0.7 : 1 },
                ]}>
                {syncing ? (
                  <ActivityIndicator size="small" color={Palette.warning} />
                ) : (
                  <Ionicons name="sync" size={16} color={Palette.warning} />
                )}
                <ThemedText type="small" style={styles.pending}>
                  {pendingPoints} point{pendingPoints > 1 ? 's' : ''} en attente — toucher pour
                  synchroniser
                </ThemedText>
              </Pressable>
            )}
            {error !== null && (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            )}
          </>
        }
        ListEmptyComponent={
          error === null ? (
            <View style={styles.empty}>
              <Ionicons name="map-outline" size={48} color={theme.textSecondary} />
              <ThemedText>Aucun trajet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Lancez votre premier enregistrement depuis l’onglet Enregistrer.
              </ThemedText>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionHeader}>
            {section.title.toUpperCase()}
          </ThemedText>
        )}
        renderItem={({ item }) => <TripRow trip={item} theme={theme} />}
      />
    </ThemedView>
  );
}

function TripRow({ trip, theme }: { trip: TripSummary; theme: ReturnType<typeof useTheme> }) {
  const color = trip.activity_type !== null ? ACTIVITY_COLORS[trip.activity_type] : Palette.accent;
  const icon = trip.activity_type !== null ? ACTIVITY_ICONS[trip.activity_type] : 'map';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/(tabs)/trips/[uuid]', params: { uuid: trip.uuid } })
      }
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
      ]}>
      <View style={[styles.iconWrap, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={color} />
      </View>
      <View style={styles.rowBody}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {trip.title}
        </ThemedText>
        <View style={styles.rowMeta}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDateTime(trip.started_at)}
          </ThemedText>
          {trip.status !== null && trip.status !== 'completed' && (
            <StatusBadge status={trip.status} />
          )}
        </View>
      </View>
      <View style={styles.rowRight}>
        <ThemedText type="smallBold" style={styles.rowDistance}>
          {trip.metrics.distance !== null ? formatDistance(trip.metrics.distance) : '—'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {trip.metrics.duration !== null ? formatDuration(trip.metrics.duration * 1000) : ''}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status === 'paused' ? 'En pause' : 'En cours';
  const color = status === 'paused' ? Palette.warning : Palette.accent;
  return (
    <View style={[styles.statusBadge, { backgroundColor: color + '26' }]}>
      <ThemedText type="small" style={{ color }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
  },
  sectionHeader: {
    letterSpacing: 1,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
    marginLeft: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rowDistance: {
    fontSize: 17,
    lineHeight: 22,
  },
  statusBadge: {
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginBottom: Spacing.two,
  },
  pending: {
    color: Palette.warning,
    flexShrink: 1,
  },
  error: {
    color: Palette.danger,
    marginBottom: Spacing.two,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.six,
  },
  emptyHint: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
});
