/**
 * Détail d'un trajet : carte héro du tracé, métriques, courbes
 * vitesse/altitude/FC, santé manuelle (PATCH /trips), photos, export GPX,
 * renommage, reprise d'un trajet terminé et suppression.
 *
 * Le tracé vient des points SQLite si le trajet a été enregistré sur cet
 * appareil ; sinon il est reconstruit depuis l'export GPX du serveur
 * (l'API n'expose pas les points bruts). La présence de la ligne locale
 * (`getTrip`) est aussi le critère du bouton « Reprendre ».
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { CartesianChart, Line } from 'victory-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACTIVITY_COLORS, ACTIVITY_ICONS, ACTIVITY_LABELS } from '@/constants/activities';
import { Palette, Spacing } from '@/constants/theme';
import { deleteLocalTrip, getTrip, getTripPoints, updateTripTitle } from '@/db/queries';
import type { TripRow } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { fetchTripTrack, shareTripGpx } from '@/services/gpx';
import { deleteLocalPhoto } from '@/services/photos';
import {
  deleteTrip,
  fetchTripDetail,
  patchTrip,
  type TripDetail,
  type TripPatch,
} from '@/services/trips';
import { useRecordStore } from '@/stores/record-store';
import { chartFont, downsample } from '@/utils/chart';
import { haversineMeters } from '@/utils/geo';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from '@/utils/format';

/** Onglets de l'écran détail. */
type TabKey = 'infos' | 'sante' | 'notes' | 'galerie';

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'infos', label: 'Infos', icon: 'stats-chart-outline' },
  { key: 'sante', label: 'Santé', icon: 'heart-outline' },
  { key: 'notes', label: 'Notes', icon: 'document-text-outline' },
  { key: 'galerie', label: 'Galerie', icon: 'images-outline' },
];

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
  const [localTrip, setLocalTrip] = useState<TripRow | null>(null);
  const [tab, setTab] = useState<TabKey>('infos');
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const phase = useRecordStore((s) => s.phase);
  const activeTrip = useRecordStore((s) => s.trip);
  const resumeCompleted = useRecordStore((s) => s.resumeCompleted);

  const load = useCallback(async () => {
    setLocalTrip(await getTrip(uuid).catch(() => null));
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

  // Rechargé à chaque focus : après une reprise + nouveau « Terminer »,
  // les métriques serveur ont changé.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const activityColor =
    detail?.activity_type != null ? ACTIVITY_COLORS[detail.activity_type] : Palette.accent;

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

  // Reprise : uniquement un trajet terminé ET enregistré sur cet appareil.
  const canResume =
    localTrip !== null && localTrip.status === 'completed' && phase === 'idle' && !deleting;

  const handleResume = async () => {
    if (resuming) {
      return;
    }
    setResuming(true);
    try {
      await resumeCompleted(uuid);
      router.navigate('/(tabs)/record');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reprise impossible.');
    } finally {
      setResuming(false);
    }
  };

  const isActiveTrip = activeTrip !== null && activeTrip.uuid === uuid && phase !== 'idle';

  const handleDelete = () => {
    if (deleting || isActiveTrip) {
      return;
    }
    Alert.alert(
      'Supprimer le trajet',
      'Le trajet, ses points et ses photos seront définitivement supprimés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => void performDelete(),
        },
      ],
    );
  };

  const performDelete = async () => {
    setDeleting(true);
    try {
      // Le serveur d'abord : pas de suppression locale sans son 204 (un
      // trajet jamais synchronisé se supprime localement, sans appel API).
      if (localTrip === null || localTrip.serverCreated === 1) {
        await deleteTrip(uuid);
      }
      if (localTrip !== null) {
        for (const localUri of await deleteLocalTrip(uuid)) {
          deleteLocalPhoto(localUri);
        }
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suppression impossible.');
      setDeleting(false);
    }
  };

  const handleRename = async (title: string) => {
    const updated = await patchTrip(uuid, { title } satisfies TripPatch);
    setDetail(updated);
    if (localTrip !== null) {
      await updateTripTitle(uuid, updated.title);
      setLocalTrip(await getTrip(uuid));
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: detail?.title ?? 'Trajet', headerTransparent: false }} />
      <ScrollView contentContainerStyle={styles.container}>
        {region !== null && (
          <MapView style={styles.map} initialRegion={region}>
            {segments.map((segment) =>
              segment.coords.length > 1 ? (
                <Polyline
                  key={segment.seg}
                  coordinates={segment.coords}
                  strokeColor={activityColor}
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

        {/* Feuille de contenu qui chevauche la carte héro. */}
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.background },
            region === null && styles.sheetNoMap,
          ]}>
          {error !== null && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          {detail !== null && (
            <>
              <View style={styles.header}>
                <View
                  style={[styles.activityBadge, { backgroundColor: activityColor + '22' }]}>
                  <Ionicons
                    name={
                      (detail.activity_type !== null
                        ? ACTIVITY_ICONS[detail.activity_type]
                        : 'map') as keyof typeof Ionicons.glyphMap
                    }
                    size={22}
                    color={activityColor}
                  />
                </View>
                <View style={styles.headerBody}>
                  <EditableTitle title={detail.title} onSave={handleRename} />
                  <ThemedText type="small" themeColor="textSecondary">
                    {detail.activity_type !== null
                      ? `${ACTIVITY_LABELS[detail.activity_type]} · `
                      : ''}
                    {formatDateTime(detail.started_at)}
                  </ThemedText>
                </View>
                {detail.status !== null && detail.status !== 'completed' && (
                  <StatusBadge status={detail.status} />
                )}
              </View>

              <PublishRow detail={detail} onSaved={setDetail} onError={setError} />

              <TabBar tab={tab} onChange={setTab} />

              {tab === 'infos' && (
                <>
                  <View
                    style={[styles.distanceCard, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.metricLabel}>
                      DISTANCE
                    </ThemedText>
                    <ThemedText type="subtitle">
                      {detail.metrics.distance !== null
                        ? formatDistance(detail.metrics.distance)
                        : '—'}
                    </ThemedText>
                  </View>

                  <View style={styles.metricsGrid}>
                    <Metric
                      icon="time-outline"
                      label="En mouvement"
                      value={
                        detail.metrics.duration !== null
                          ? formatDuration(detail.metrics.duration * 1000)
                          : '—'
                      }
                    />
                    <Metric
                      icon="hourglass-outline"
                      label="Durée totale"
                      value={
                        detail.metrics.duration_total !== null
                          ? formatDuration(detail.metrics.duration_total * 1000)
                          : '—'
                      }
                    />
                    <Metric
                      icon="speedometer-outline"
                      label="Vitesse moy."
                      value={formatSpeed(detail.metrics.speed_avg)}
                    />
                    <Metric
                      icon="flash-outline"
                      label="Vitesse max"
                      value={formatSpeed(detail.metrics.speed_max)}
                    />
                    <Metric
                      icon="trending-up-outline"
                      label="Dénivelé +"
                      value={formatElevation(detail.metrics.elevation_gain)}
                    />
                    <Metric
                      icon="trending-down-outline"
                      label="Dénivelé −"
                      value={formatElevation(detail.metrics.elevation_loss)}
                    />
                  </View>

                  {speedSeries.length > 1 && (
                    <Chart
                      title="VITESSE (KM/H)"
                      data={speedSeries}
                      color={Palette.accent}
                      theme={theme}
                    />
                  )}
                  {altitudeSeries.length > 1 && (
                    <Chart
                      title="ALTITUDE (M)"
                      data={altitudeSeries}
                      color={Palette.altitude}
                      theme={theme}
                    />
                  )}
                </>
              )}

              {tab === 'sante' && (
                <>
                  <SectionTitle title="SANTÉ (CAPTEURS)" />
                  <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                    <Row
                      label="FC moyenne / max"
                      value={
                        detail.health.heart_rate_avg !== null ||
                        detail.health.heart_rate_max !== null
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

                  {heartSeries.length > 1 && (
                    <Chart
                      title="FRÉQUENCE CARDIAQUE (BPM)"
                      data={heartSeries}
                      color={Palette.danger}
                      theme={theme}
                    />
                  )}

                  <HealthForm detail={detail} onSaved={setDetail} />
                </>
              )}

              {tab === 'notes' && <NotesForm detail={detail} onSaved={setDetail} />}

              {tab === 'galerie' && <Gallery photos={detail.photos} />}

              <View style={styles.actions}>
                {canResume && (
                  <ActionPill
                    icon="play"
                    label="Reprendre ce trajet"
                    color={Palette.accent}
                    textColor="#ffffff"
                    busy={resuming}
                    onPress={() => void handleResume()}
                  />
                )}
                <ActionPill
                  icon="share-outline"
                  label="Exporter en GPX"
                  color={theme.backgroundElement}
                  textColor={theme.text}
                  busy={exporting}
                  onPress={() => void handleExport()}
                />
                {!isActiveTrip && (
                  <ActionPill
                    icon="trash-outline"
                    label="Supprimer le trajet"
                    color="transparent"
                    textColor={Palette.danger}
                    busy={deleting}
                    onPress={handleDelete}
                  />
                )}
              </View>
            </>
          )}

          {detail === null && error === null && (
            <ActivityIndicator size="large" color={Palette.accent} style={styles.loader} />
          )}
        </View>
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

/** Titre avec édition inline (crayon → TextInput → PATCH). */
function EditableTitle({
  title,
  onSave,
}: {
  title: string;
  onSave: (title: string) => Promise<void>;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEditing = () => {
    setDraft(title);
    setSaveError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed.length > 255) {
      setSaveError('Titre requis (255 caractères max).');
      return;
    }
    if (trimmed === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Renommage impossible.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <Pressable onPress={startEditing} style={styles.titleRow} accessibilityRole="button">
        <ThemedText type="smallBold" style={styles.title} numberOfLines={2}>
          {title}
        </ThemedText>
        <Ionicons name="pencil" size={14} color={theme.textSecondary} />
      </Pressable>
    );
  }

  return (
    <View style={styles.titleEdit}>
      <TextInput
        style={[
          styles.titleInput,
          { backgroundColor: theme.backgroundElement, color: theme.text },
        ]}
        value={draft}
        onChangeText={setDraft}
        autoFocus
        maxLength={255}
        editable={!saving}
        onSubmitEditing={() => void handleSave()}
        returnKeyType="done"
      />
      <View style={styles.titleEditActions}>
        <Pressable onPress={() => setEditing(false)} disabled={saving} hitSlop={8}>
          <Ionicons name="close" size={20} color={theme.textSecondary} />
        </Pressable>
        <Pressable onPress={() => void handleSave()} disabled={saving} hitSlop={8}>
          {saving ? (
            <ActivityIndicator size="small" color={Palette.accent} />
          ) : (
            <Ionicons name="checkmark" size={20} color={Palette.accent} />
          )}
        </Pressable>
      </View>
      {saveError !== null && (
        <ThemedText type="small" style={styles.error}>
          {saveError}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * Publication sur le site : les trajets naissent dépubliés, le switch fait
 * un PATCH `published` (client autoritaire, nécessite le réseau).
 */
function PublishRow({
  detail,
  onSaved,
  onError,
}: {
  detail: TripDetail;
  onSaved: (detail: TripDetail) => void;
  onError: (message: string | null) => void;
}) {
  const theme = useTheme();
  const [saving, setSaving] = useState(false);

  const handleToggle = async (published: boolean) => {
    setSaving(true);
    try {
      onSaved(await patchTrip(detail.uuid, { published }));
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Publication impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.publishRow, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.publishLabel}>
        <Ionicons
          name={detail.published ? 'globe-outline' : 'eye-off-outline'}
          size={18}
          color={detail.published ? Palette.success : theme.textSecondary}
        />
        <ThemedText type="small">
          {detail.published ? 'Publié sur le site' : 'Non publié'}
        </ThemedText>
      </View>
      {saving ? (
        <ActivityIndicator size="small" color={Palette.accent} />
      ) : (
        <Switch
          value={detail.published}
          onValueChange={(value) => void handleToggle(value)}
          trackColor={{ true: Palette.success }}
        />
      )}
    </View>
  );
}

/** Barre d'onglets du détail (Infos / Santé / Notes / Galerie). */
function TabBar({ tab, onChange }: { tab: TabKey; onChange: (tab: TabKey) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.tabBar, { backgroundColor: theme.backgroundElement }]}>
      {TABS.map((item) => {
        const selected = item.key === tab;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            onPress={() => onChange(item.key)}
            style={[
              styles.tabItem,
              selected && { backgroundColor: theme.background },
            ]}>
            <Ionicons
              name={item.icon}
              size={15}
              color={selected ? Palette.accent : theme.textSecondary}
            />
            <ThemedText
              type="smallBold"
              style={{ color: selected ? Palette.accent : theme.textSecondary }}>
              {item.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Onglet Notes : chapo + description, PATCH direct (client autoritaire). */
function NotesForm({
  detail,
  onSaved,
}: {
  detail: TripDetail;
  onSaved: (detail: TripDetail) => void;
}) {
  const theme = useTheme();
  const [chapo, setChapo] = useState(detail.chapo ?? '');
  const [body, setBody] = useState(detail.body ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const handleSave = async () => {
    const trimmedChapo = chapo.trim();
    const trimmedBody = body.trim();
    if (trimmedChapo === '' && trimmedBody === '') {
      setMessage({ text: 'Renseignez le chapo ou la description.', isError: true });
      return;
    }
    if (trimmedChapo.length > 1000 || trimmedBody.length > 10000) {
      setMessage({
        text: 'Chapo : 1 000 caractères max, description : 10 000 caractères max.',
        isError: true,
      });
      return;
    }
    setSaving(true);
    try {
      const patch: TripPatch = {};
      if (trimmedChapo !== (detail.chapo ?? '')) {
        patch.chapo = trimmedChapo;
      }
      if (trimmedBody !== (detail.body ?? '')) {
        patch.body = trimmedBody;
      }
      if (Object.keys(patch).length > 0) {
        onSaved(await patchTrip(detail.uuid, patch));
      }
      setMessage({ text: 'Notes enregistrées.', isError: false });
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : 'Enregistrement impossible.',
        isError: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { backgroundColor: theme.backgroundSelected, color: theme.text };

  return (
    <>
      <SectionTitle title="CHAPO" />
      <TextInput
        style={[styles.notesInput, styles.chapoInput, inputStyle]}
        value={chapo}
        onChangeText={setChapo}
        multiline
        maxLength={1000}
        placeholder="Un court résumé du trajet…"
        placeholderTextColor={theme.textSecondary}
        editable={!saving}
      />

      <SectionTitle title="DESCRIPTION" />
      <TextInput
        style={[styles.notesInput, styles.bodyInput, inputStyle]}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={10000}
        placeholder="Le récit du trajet, les conditions, les impressions…"
        placeholderTextColor={theme.textSecondary}
        editable={!saving}
      />

      {message !== null && (
        <ThemedText
          type="small"
          style={{ color: message.isError ? Palette.danger : Palette.success }}>
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
          <ActivityIndicator size="small" color={Palette.accent} />
        ) : (
          <ThemedText type="smallBold">Enregistrer les notes</ThemedText>
        )}
      </Pressable>
    </>
  );
}

/** Onglet Galerie : grille 2 colonnes des photos du trajet. */
function Gallery({ photos }: { photos: TripDetail['photos'] }) {
  const theme = useTheme();
  if (photos.length === 0) {
    return (
      <View style={styles.galleryEmpty}>
        <Ionicons name="images-outline" size={40} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.galleryEmptyHint}>
          Aucune photo pour ce trajet. Les photos se prennent pendant l’enregistrement, depuis
          l’écran Enregistrer.
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={styles.galleryGrid}>
      {photos.map((photo) => (
        <Image
          key={photo.uuid}
          source={{ uri: photo.url }}
          style={styles.galleryPhoto}
          contentFit="cover"
          transition={150}
        />
      ))}
    </View>
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

function SectionTitle({ title }: { title: string }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
      {title}
    </ThemedText>
  );
}

function Metric({
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
    <View style={[styles.metric, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.metricHeader}>
        <Ionicons name={icon} size={15} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" style={styles.metricValue}>
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

function ActionPill({
  icon,
  label,
  color,
  textColor,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  textColor: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.actionPill,
        { backgroundColor: color, opacity: pressed || busy ? 0.7 : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Ionicons name={icon} size={20} color={textColor} />
      )}
      <ThemedText type="smallBold" style={{ color: textColor }}>
        {label}
      </ThemedText>
    </Pressable>
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
          {({ points }) => (
            <Line points={points.v} color={color} strokeWidth={2} curveType="monotoneX" />
          )}
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
    const patch: TripPatch = {};
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
            style={{ color: message.isError ? Palette.danger : Palette.success }}>
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
            <ActivityIndicator size="small" color={Palette.accent} />
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
                { backgroundColor: selected ? Palette.accent : theme.backgroundSelected },
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
    paddingBottom: Spacing.four,
  },
  map: {
    height: 280,
  },
  sheet: {
    marginTop: -24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sheetNoMap: {
    marginTop: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerBody: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  title: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  titleEdit: {
    gap: Spacing.one,
  },
  titleInput: {
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 15,
  },
  titleEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.three,
  },
  activityBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  publishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  publishLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  distanceCard: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: 2,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metric: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: 16,
    padding: Spacing.two + 4,
    gap: Spacing.one,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  metricLabel: {
    letterSpacing: 1,
  },
  metricValue: {
    fontSize: 17,
    lineHeight: 22,
  },
  sectionTitle: {
    marginTop: Spacing.three,
    marginLeft: Spacing.two,
    letterSpacing: 1,
  },
  card: {
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  chartCard: {
    borderRadius: 16,
    padding: Spacing.two,
    height: 180,
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 3,
    gap: 3,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 11,
    paddingVertical: Spacing.two,
  },
  notesInput: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  chapoInput: {
    minHeight: 84,
  },
  bodyInput: {
    minHeight: 180,
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  galleryPhoto: {
    flexBasis: '47%',
    flexGrow: 1,
    aspectRatio: 1,
    borderRadius: 16,
  },
  galleryEmpty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  galleryEmptyHint: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
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
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 26,
    height: 52,
  },
  loader: {
    marginTop: Spacing.six,
  },
  error: {
    color: Palette.danger,
  },
});
