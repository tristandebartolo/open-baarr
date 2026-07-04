/**
 * Détail d'un trajet : carte du tracé, métriques, courbes
 * vitesse/altitude/FC, santé manuelle (PATCH /trips), photos, export GPX.
 *
 * Le tracé vient des points SQLite si le trajet a été enregistré sur cet
 * appareil ; sinon il est reconstruit depuis l'export GPX du serveur
 * (l'API n'expose pas les points bruts).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { CartesianChart, Line } from 'victory-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACTIVITY_LABELS } from '@/constants/activities';
import { Spacing } from '@/constants/theme';
import { getTripPoints } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';
import { fetchTripTrack, shareTripGpx } from '@/services/gpx';
import {
  fetchTripDetail,
  patchTrip,
  type ManualHealthPatch,
  type TripDetail,
} from '@/services/trips';
import { chartFont, downsample } from '@/utils/chart';
import { haversineMeters } from '@/utils/geo';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from '@/utils/format';

const ACCENT = '#208AEF';
const ALTITUDE = '#7A5AF8';
const HEART = '#D64545';

/** Point de tracé unifié (SQLite local ou GPX serveur). */
type TrackPoint = {
  lat: number;
  lng: number;
  alt: number | null;
  /** Epoch ms (null : GPX sans <time>). */
  t: number | null;
  /** m/s (dérivée du GPX quand absente). */
  spd: number | null;
  hr: number | null;
  seg: number;
};

export default function TripDetailScreen() {
  const { uuid } = useLocalSearchParams<{ uuid: string }>();
  const theme = useTheme();

  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchTripDetail(uuid));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trajet indisponible.');
      return;
    }
    try {
      setTrack(await loadTrack(uuid));
    } catch (e) {
      console.warn('opencar: tracé indisponible', e);
    }
  }, [uuid]);

  // setState uniquement après await (pas de rendu en cascade), le linter ne peut pas le voir.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const segments = useMemo(() => {
    const bySeg = new Map<number, { latitude: number; longitude: number }[]>();
    for (const point of track) {
      const coords = bySeg.get(point.seg) ?? [];
      coords.push({ latitude: point.lat, longitude: point.lng });
      bySeg.set(point.seg, coords);
    }
    return [...bySeg.entries()].map(([seg, coords]) => ({ seg, coords }));
  }, [track]);

  const region = useMemo(() => {
    if (track.length === 0) {
      return null;
    }
    let minLat = track[0].lat;
    let maxLat = track[0].lat;
    let minLng = track[0].lng;
    let maxLng = track[0].lng;
    for (const point of track) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
    }
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.005),
      longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.005),
    };
  }, [track]);

  const sampled = useMemo(() => downsample(track), [track]);
  const speedSeries = useMemo(
    () =>
      sampled
        .map((p, index) => ({ index, v: p.spd !== null ? p.spd * 3.6 : null }))
        .filter((p): p is { index: number; v: number } => p.v !== null),
    [sampled],
  );
  const altitudeSeries = useMemo(
    () =>
      sampled
        .map((p, index) => ({ index, v: p.alt }))
        .filter((p): p is { index: number; v: number } => p.v !== null),
    [sampled],
  );
  const heartSeries = useMemo(
    () =>
      sampled
        .map((p, index) => ({ index, v: p.hr }))
        .filter((p): p is { index: number; v: number } => p.v !== null),
    [sampled],
  );

  const handleExport = async () => {
    if (detail === null || exporting) {
      return;
    }
    setExporting(true);
    try {
      await shareTripGpx(detail.uuid, detail.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export GPX impossible.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: detail?.title ?? 'Trajet' }} />
      <ScrollView contentContainerStyle={styles.container}>
        {error !== null && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        {region !== null && (
          <MapView style={styles.map} initialRegion={region}>
            {segments.map((segment) =>
              segment.coords.length > 1 ? (
                <Polyline
                  key={segment.seg}
                  coordinates={segment.coords}
                  strokeColor={ACCENT}
                  strokeWidth={4}
                />
              ) : null,
            )}
            {track.length > 0 && (
              <>
                <Marker
                  coordinate={{ latitude: track[0].lat, longitude: track[0].lng }}
                  pinColor="green"
                  title="Départ"
                />
                <Marker
                  coordinate={{
                    latitude: track[track.length - 1].lat,
                    longitude: track[track.length - 1].lng,
                  }}
                  pinColor="red"
                  title="Arrivée"
                />
              </>
            )}
          </MapView>
        )}

        {detail !== null && (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {detail.activity_type !== null ? `${ACTIVITY_LABELS[detail.activity_type]} · ` : ''}
              {formatDateTime(detail.started_at)}
              {detail.points_count > 0 ? ` · ${detail.points_count} points` : ''}
            </ThemedText>

            <View style={styles.metricsGrid}>
              <Metric
                label="Distance"
                value={detail.metrics.distance !== null ? formatDistance(detail.metrics.distance) : '—'}
              />
              <Metric
                label="En mouvement"
                value={
                  detail.metrics.duration !== null
                    ? formatDuration(detail.metrics.duration * 1000)
                    : '—'
                }
              />
              <Metric
                label="Durée totale"
                value={
                  detail.metrics.duration_total !== null
                    ? formatDuration(detail.metrics.duration_total * 1000)
                    : '—'
                }
              />
              <Metric label="Vitesse moy." value={formatSpeed(detail.metrics.speed_avg)} />
              <Metric label="Vitesse max" value={formatSpeed(detail.metrics.speed_max)} />
              <Metric
                label="D+ / D−"
                value={`${formatElevation(detail.metrics.elevation_gain)} / ${formatElevation(detail.metrics.elevation_loss)}`}
              />
            </View>

            {(detail.health.heart_rate_avg !== null ||
              detail.health.steps !== null ||
              detail.health.calories !== null) && (
              <>
                <SectionTitle title="SANTÉ (CAPTEURS)" />
                <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                  <Row
                    label="FC moyenne / max"
                    value={
                      detail.health.heart_rate_avg !== null || detail.health.heart_rate_max !== null
                        ? `${detail.health.heart_rate_avg ?? '—'} / ${detail.health.heart_rate_max ?? '—'} bpm`
                        : '—'
                    }
                  />
                  <Row
                    label="Pas"
                    value={detail.health.steps !== null ? String(detail.health.steps) : '—'}
                  />
                  <Row
                    label="Calories actives"
                    value={
                      detail.health.calories !== null
                        ? `${Math.round(detail.health.calories)} kcal`
                        : '—'
                    }
                  />
                </View>
              </>
            )}

            {speedSeries.length > 1 && (
              <Chart title="VITESSE (KM/H)" data={speedSeries} color={ACCENT} theme={theme} />
            )}
            {altitudeSeries.length > 1 && (
              <Chart title="ALTITUDE (M)" data={altitudeSeries} color={ALTITUDE} theme={theme} />
            )}
            {heartSeries.length > 1 && (
              <Chart title="FRÉQUENCE CARDIAQUE (BPM)" data={heartSeries} color={HEART} theme={theme} />
            )}

            {detail.photos.length > 0 && (
              <>
                <SectionTitle title="PHOTOS" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.photosRow}>
                    {detail.photos.map((photo) => (
                      <Image
                        key={photo.uuid}
                        source={{ uri: photo.url }}
                        style={styles.photo}
                        contentFit="cover"
                        transition={150}
                      />
                    ))}
                  </View>
                </ScrollView>
              </>
            )}

            <HealthForm detail={detail} onSaved={setDetail} />

            <Pressable
              onPress={() => void handleExport()}
              style={({ pressed }) => [
                styles.exportButton,
                { backgroundColor: ACCENT, opacity: pressed || exporting ? 0.8 : 1 },
              ]}>
              {exporting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Ionicons name="share-outline" size={20} color="#ffffff" />
              )}
              <ThemedText type="smallBold" style={styles.exportLabel}>
                Exporter en GPX
              </ThemedText>
            </Pressable>
          </>
        )}

        {detail === null && error === null && (
          <ActivityIndicator size="large" color={ACCENT} style={styles.loader} />
        )}
      </ScrollView>
    </ThemedView>
  );
}

/** Points locaux si le trajet a été enregistré ici, sinon GPX du serveur. */
async function loadTrack(uuid: string): Promise<TrackPoint[]> {
  const local = await getTripPoints(uuid);
  if (local.length > 0) {
    return local.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      alt: p.alt,
      t: p.t,
      spd: p.spd,
      hr: p.hr,
      seg: p.seg,
    }));
  }
  const remote = await fetchTripTrack(uuid);
  // Vitesse dérivée : le GPX ne la porte pas (distance / Δt entre points).
  return remote.map((point, i) => {
    const previous = i > 0 ? remote[i - 1] : null;
    let spd: number | null = null;
    if (
      previous !== null &&
      previous.seg === point.seg &&
      previous.t !== null &&
      point.t !== null &&
      point.t > previous.t
    ) {
      const meters = haversineMeters(previous.lat, previous.lng, point.lat, point.lng);
      spd = meters / ((point.t - previous.t) / 1000);
    }
    return { ...point, spd };
  });
}

function SectionTitle({ title }: { title: string }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
      {title}
    </ThemedText>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
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

function Chart({
  title,
  data,
  color,
  theme,
}: {
  title: string;
  data: { index: number; v: number }[];
  color: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <>
      <SectionTitle title={title} />
      <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement }]}>
        <CartesianChart
          data={data}
          xKey="index"
          yKeys={['v']}
          axisOptions={{
            font: chartFont(),
            labelColor: theme.textSecondary,
            lineColor: theme.backgroundSelected,
            formatXLabel: () => '',
            formatYLabel: (value) => `${Math.round(Number(value))}`,
          }}>
          {({ points }) => <Line points={points.v} color={color} strokeWidth={2} curveType="monotoneX" />}
        </CartesianChart>
      </View>
    </>
  );
}

/** Formulaire de santé manuelle : client autoritaire, PATCH direct. */
function HealthForm({
  detail,
  onSaved,
}: {
  detail: TripDetail;
  onSaved: (detail: TripDetail) => void;
}) {
  const theme = useTheme();
  const [weight, setWeight] = useState(detail.health.weight?.toString() ?? '');
  const [hydration, setHydration] = useState(detail.health.hydration?.toString() ?? '');
  const [feeling, setFeeling] = useState<number | null>(detail.health.feeling);
  const [fatigue, setFatigue] = useState<number | null>(detail.health.fatigue);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const parseNumber = (raw: string): number | null => {
    const value = Number(raw.replace(',', '.'));
    return raw.trim() !== '' && Number.isFinite(value) ? value : null;
  };

  const handleSave = async () => {
    const patch: ManualHealthPatch = {};
    const parsedWeight = parseNumber(weight);
    const parsedHydration = parseNumber(hydration);
    if (parsedWeight !== null) {
      patch.weight = parsedWeight;
    }
    if (parsedHydration !== null) {
      patch.hydration = parsedHydration;
    }
    if (feeling !== null) {
      patch.feeling = feeling;
    }
    if (fatigue !== null) {
      patch.fatigue = fatigue;
    }
    if (Object.keys(patch).length === 0) {
      setMessage({ text: 'Renseignez au moins une valeur.', isError: true });
      return;
    }
    setSaving(true);
    try {
      onSaved(await patchTrip(detail.uuid, patch));
      setMessage({ text: 'Santé enregistrée.', isError: false });
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : 'Enregistrement impossible.',
        isError: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundSelected, color: theme.text },
  ];

  return (
    <>
      <SectionTitle title="SANTÉ (SAISIE MANUELLE)" />
      <View style={[styles.card, styles.form, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.formRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.formLabel}>
            Poids (kg)
          </ThemedText>
          <TextInput
            style={inputStyle}
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={theme.textSecondary}
          />
        </View>
        <View style={styles.formRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.formLabel}>
            Hydratation (L)
          </ThemedText>
          <TextInput
            style={inputStyle}
            value={hydration}
            onChangeText={setHydration}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={theme.textSecondary}
          />
        </View>
        <ScaleRow label="Ressenti" value={feeling} onChange={setFeeling} />
        <ScaleRow label="Fatigue" value={fatigue} onChange={setFatigue} />

        {message !== null && (
          <ThemedText
            type="small"
            style={{ color: message.isError ? '#D64545' : '#2E8B57' }}>
            {message.text}
          </ThemedText>
        )}

        <Pressable
          onPress={() => void handleSave()}
          disabled={saving}
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: theme.backgroundSelected, opacity: pressed || saving ? 0.7 : 1 },
          ]}>
          {saving ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <ThemedText type="smallBold">Enregistrer la santé</ThemedText>
          )}
        </Pressable>
      </View>
    </>
  );
}

/** Échelle 1–5 (ressenti, fatigue). */
function ScaleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.formRow}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.formLabel}>
        {label}
      </ThemedText>
      <View style={styles.scale}>
        {[1, 2, 3, 4, 5].map((step) => {
          const selected = value === step;
          return (
            <Pressable
              key={step}
              onPress={() => onChange(step)}
              style={[
                styles.scaleDot,
                { backgroundColor: selected ? ACCENT : theme.backgroundSelected },
              ]}>
              <ThemedText
                type="smallBold"
                style={{ color: selected ? '#ffffff' : theme.textSecondary }}>
                {step}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
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
  map: {
    height: 240,
    borderRadius: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metric: {
    flexBasis: '31%',
    flexGrow: 1,
    borderRadius: 12,
    padding: Spacing.two + 4,
    gap: 2,
  },
  sectionTitle: {
    marginTop: Spacing.two,
    marginLeft: Spacing.two,
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
  chartCard: {
    borderRadius: 12,
    padding: Spacing.two,
    height: 180,
  },
  photosRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 12,
  },
  form: {
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  formLabel: {
    flexShrink: 0,
  },
  input: {
    minWidth: 90,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    fontSize: 14,
    textAlign: 'right',
  },
  scale: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  scaleDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: Spacing.one,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 24,
    paddingVertical: Spacing.two + 4,
    marginTop: Spacing.two,
  },
  exportLabel: {
    color: '#ffffff',
  },
  loader: {
    marginTop: Spacing.six,
  },
  error: {
    color: '#D64545',
  },
});
