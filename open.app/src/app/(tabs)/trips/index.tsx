/**
 * Historique des trajets : liste paginée servie par GET /trips (le serveur
 * est la source de vérité une fois la sync passée), avec un rappel du
 * nombre de points encore à synchroniser depuis cet appareil.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACTIVITY_ICONS, ACTIVITY_LABELS } from '@/constants/activities';
import { Spacing } from '@/constants/theme';
import { countUnsyncedPoints } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';
import { fetchTrips, type TripSummary } from '@/services/trips';
import { formatDateTime, formatDistance, formatDuration } from '@/utils/format';

const PAGE_SIZE = 50;

const STATUS_LABELS: Record<string, string> = {
  draft: 'brouillon',
  recording: 'en cours',
  paused: 'en pause',
  completed: '',
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
  // d'être synchronisé depuis l'écran Enregistrer).
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

  return (
    <ThemedView style={styles.flex}>
      <FlatList
        data={trips}
        keyExtractor={(trip) => trip.uuid}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => void handleEndReached()}
        ListHeaderComponent={
          <>
            {pendingPoints > 0 && (
              <ThemedText type="small" style={styles.pending}>
                {pendingPoints} point{pendingPoints > 1 ? 's' : ''} en attente de synchronisation
                sur cet appareil.
              </ThemedText>
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
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              Aucun trajet pour le moment : lancez un enregistrement !
            </ThemedText>
          ) : null
        }
        renderItem={({ item }) => <TripRow trip={item} theme={theme} />}
      />
    </ThemedView>
  );
}

function TripRow({ trip, theme }: { trip: TripSummary; theme: ReturnType<typeof useTheme> }) {
  const icon = trip.activity_type !== null ? ACTIVITY_ICONS[trip.activity_type] : 'map';
  const statusLabel = trip.status !== null ? (STATUS_LABELS[trip.status] ?? '') : '';
  return (
    <Link href={{ pathname: '/(tabs)/trips/[uuid]', params: { uuid: trip.uuid } }} asChild>
      <Pressable style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.iconWrap, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons
            name={icon as keyof typeof Ionicons.glyphMap}
            size={20}
            color={theme.textSecondary}
          />
        </View>
        <View style={styles.cardBody}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {trip.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDateTime(trip.started_at)}
            {trip.activity_type !== null ? ` · ${ACTIVITY_LABELS[trip.activity_type]}` : ''}
            {statusLabel !== '' ? ` · ${statusLabel}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {trip.metrics.distance !== null ? formatDistance(trip.metrics.distance) : '—'}
            {trip.metrics.duration !== null
              ? ` · ${formatDuration(trip.metrics.duration * 1000)}`
              : ''}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.two + 4,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  pending: {
    color: '#B8860B',
    marginBottom: Spacing.two,
  },
  error: {
    color: '#D64545',
    marginBottom: Spacing.two,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.six,
  },
});
