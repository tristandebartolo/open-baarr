/**
 * Écran Enregistrer : carte plein écran (tracé par segment, couleur de
 * l'activité) et informations en surimpression translucide — la carte reste
 * visible au travers. Stats temps réel lues depuis SQLite, boutons
 * circulaires start/pause/resume/stop + photo, pastille de sync.
 *
 * Les textes de l'overlay sont blancs sur voile sombre quel que soit le
 * thème (ils flottent sur la carte, pas sur le fond de l'app).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import type * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';

import { PhotoFormModal, type PhotoFormValues } from '@/components/photo-form';
import { ThemedView } from '@/components/themed-view';
import {
  ACTIVITY_COLORS,
  ACTIVITY_ICONS,
  ACTIVITY_LABELS,
  ACTIVITY_TYPES,
} from '@/constants/activities';
import { Palette, Spacing } from '@/constants/theme';
import type { ActivityType } from '@/db/schema';
import { queueTripPhoto, takeTripPhoto } from '@/services/photos';
import { useRecordStore } from '@/stores/record-store';
import { useSyncStore } from '@/stores/sync-store';
import { formatDistance, formatDuration, formatSpeed } from '@/utils/format';

/** Voile et textes de la surimpression (indépendants du thème de l'app). */
const OVERLAY_BG = 'rgba(12, 14, 18, 0.45)';
const OVERLAY_ELEMENT = 'rgba(255, 255, 255, 0.18)';
const TEXT = '#FFFFFF';
const TEXT_MUTED = 'rgba(255, 255, 255, 0.78)';

export default function RecordScreen() {
  const mapRef = useRef<MapView>(null);
  const [activityType, setActivityType] = useState<ActivityType>('car');
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  /** Photo capturée en attente de ses métadonnées (modale ouverte). */
  const [pendingPhoto, setPendingPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const phase = useRecordStore((s) => s.phase);
  const trip = useRecordStore((s) => s.trip);
  const error = useRecordStore((s) => s.error);
  const backgroundGranted = useRecordStore((s) => s.backgroundGranted);
  const distanceM = useRecordStore((s) => s.distanceM);
  const movingMs = useRecordStore((s) => s.movingMs);
  const elapsedMs = useRecordStore((s) => s.elapsedMs);
  const speedMs = useRecordStore((s) => s.speedMs);
  const pointCount = useRecordStore((s) => s.pointCount);
  const unsyncedCount = useRecordStore((s) => s.unsyncedCount);
  const segments = useRecordStore((s) => s.segments);
  const lastPoint = useRecordStore((s) => s.lastPoint);
  const start = useRecordStore((s) => s.start);
  const pause = useRecordStore((s) => s.pause);
  const resume = useRecordStore((s) => s.resume);
  const stop = useRecordStore((s) => s.stop);

  const syncing = useSyncStore((s) => s.syncing);

  // La caméra suit le dernier fix pendant l'enregistrement.
  useEffect(() => {
    if (lastPoint !== null && phase === 'recording') {
      mapRef.current?.animateCamera(
        { center: { latitude: lastPoint.lat, longitude: lastPoint.lng } },
        { duration: 700 },
      );
    }
  }, [lastPoint, phase]);

  const active = phase === 'recording' || phase === 'paused';
  const busy = phase === 'starting' || phase === 'stopping';
  const trackColor = trip !== null ? ACTIVITY_COLORS[trip.activityType] : Palette.accent;

  // Photo géolocalisée pendant le trajet : capture (+ pellicule) puis
  // modale de métadonnées → photos_queue (upload par la sync).
  const handlePhoto = async () => {
    if (trip === null) {
      return;
    }
    try {
      const result = await takeTripPhoto();
      if (result.status === 'ok') {
        setPendingPhoto(result.asset);
      } else if (result.status === 'permission-denied') {
        setPhotoMessage('Accès à l’appareil photo refusé.');
      }
    } catch (e) {
      setPhotoMessage(e instanceof Error ? e.message : 'Photo impossible.');
    }
  };

  const handlePhotoMeta = async (values: PhotoFormValues) => {
    if (trip === null || pendingPhoto === null) {
      setPendingPhoto(null);
      return;
    }
    try {
      await queueTripPhoto(
        trip.uuid,
        pendingPhoto,
        lastPoint !== null ? { lat: lastPoint.lat, lng: lastPoint.lng } : null,
        values,
      );
      setPhotoMessage('Photo ajoutée au trajet (envoi à la prochaine sync).');
    } catch (e) {
      setPhotoMessage(e instanceof Error ? e.message : 'Photo impossible.');
    } finally {
      setPendingPhoto(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        showsUserLocation
        initialRegion={{
          latitude: 46.6,
          longitude: 2.4,
          latitudeDelta: 10,
          longitudeDelta: 10,
        }}>
        {segments.map((segment) =>
          segment.coords.length > 1 ? (
            <Polyline
              key={segment.seg}
              coordinates={segment.coords}
              strokeColor={trackColor}
              strokeWidth={4}
            />
          ) : null,
        )}
      </MapView>

      {/* Surimpression translucide : la carte reste visible au travers. */}
      <View style={styles.overlay} pointerEvents="box-none">
        {error !== null && (
          <Text style={[styles.small, styles.error]}>{error}</Text>
        )}

        {active && trip !== null && (
          <>
            <View style={styles.headerRow}>
              <Text style={[styles.smallBold, styles.headerTitle]} numberOfLines={1}>
                {trip.title}
              </Text>
              {phase === 'paused' && (
                <View style={[styles.pill, { backgroundColor: Palette.warning + '40' }]}>
                  <Text style={[styles.small, { color: '#FFD98A' }]}>En pause</Text>
                </View>
              )}
              <SyncPill syncing={syncing} unsyncedCount={unsyncedCount} />
            </View>

            <View style={styles.hero}>
              <Text style={styles.heroValue}>{formatDistance(distanceM)}</Text>
              <Text style={styles.heroLabel}>DISTANCE</Text>
            </View>

            <View style={styles.statsRow}>
              <Stat label="Durée" value={formatDuration(movingMs)} />
              <Stat label="Vitesse" value={formatSpeed(speedMs)} />
              <Stat label="Écoulé" value={formatDuration(elapsedMs)} />
            </View>

            <Text style={[styles.small, styles.muted, styles.centered]}>
              {pointCount} points
            </Text>

            {!backgroundGranted && (
              <Text style={[styles.small, styles.warning]}>
                Localisation « Toujours » refusée : l’enregistrement s’interrompra si l’app passe
                en arrière-plan.
              </Text>
            )}
            {photoMessage !== null && (
              <Text style={[styles.small, styles.muted, styles.centered]}>{photoMessage}</Text>
            )}
          </>
        )}

        {phase === 'idle' && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}>
            {ACTIVITY_TYPES.map((type) => {
              const selected = type === activityType;
              const color = ACTIVITY_COLORS[type];
              return (
                <Pressable
                  key={type}
                  onPress={() => setActivityType(type)}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? color : OVERLAY_ELEMENT },
                  ]}>
                  <Ionicons
                    name={ACTIVITY_ICONS[type] as keyof typeof Ionicons.glyphMap}
                    size={16}
                    color={selected ? '#ffffff' : color}
                  />
                  <Text style={[styles.smallBold, { color: TEXT }]}>
                    {ACTIVITY_LABELS[type]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {phase === 'idle' && (
          <Pressable
            onPress={() => void start(activityType)}
            style={({ pressed }) => [
              styles.startButton,
              {
                backgroundColor: ACTIVITY_COLORS[activityType],
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Ionicons name="radio-button-on" size={22} color="#ffffff" />
            <Text style={[styles.smallBold, styles.startLabel]}>Démarrer</Text>
          </Pressable>
        )}

        {busy && <ActivityIndicator size="large" color="#ffffff" style={styles.busy} />}

        {active && (
          <View style={styles.buttonsRow}>
            {phase === 'recording' && (
              <CircleButton
                icon="pause"
                label="Pause"
                size={64}
                color={OVERLAY_ELEMENT}
                onPress={() => void pause()}
              />
            )}
            {phase === 'paused' && (
              <CircleButton
                icon="play"
                label="Reprendre"
                size={64}
                color={Palette.accent}
                onPress={() => void resume()}
              />
            )}
            <CircleButton
              icon="stop"
              label="Terminer"
              size={64}
              color={Palette.danger}
              onPress={() => void stop()}
            />
            <CircleButton
              icon="camera"
              label="Photo"
              size={48}
              color={OVERLAY_ELEMENT}
              onPress={() => void handlePhoto()}
            />
          </View>
        )}
      </View>

      {pendingPhoto !== null && (
        <PhotoFormModal
          visible
          title="Détails de la photo"
          initial={{ description: null, copyright: null }}
          submitLabel="Enregistrer"
          skipLabel="Passer"
          onSubmit={(values) => void handlePhotoMeta(values)}
          onDismiss={() => void handlePhotoMeta({ description: null, copyright: null })}
        />
      )}
    </ThemedView>
  );
}

function SyncPill({ syncing, unsyncedCount }: { syncing: boolean; unsyncedCount: number }) {
  const [color, label] = syncing
    ? [Palette.accent, 'Synchronisation…']
    : unsyncedCount > 0
      ? ['#FFC107', `${unsyncedCount} en attente`]
      : ['#5BD08F', 'Synchronisé'];
  return (
    <View style={[styles.pill, { backgroundColor: OVERLAY_ELEMENT }]}>
      <View style={[styles.syncDot, { backgroundColor: color }]} />
      <Text style={[styles.small, styles.muted]}>{label}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.small, styles.muted]}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function CircleButton({
  icon,
  label,
  size,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  size: number;
  color: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.circleWrap}>
      <Pressable
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: pressed ? 0.8 : 1,
          },
        ]}>
        <Ionicons name={icon} size={size >= 64 ? 26 : 20} color="#ffffff" />
      </Pressable>
      <Text style={[styles.small, styles.muted, styles.shadowed]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
    borderRadius: 24,
    padding: Spacing.three,
    gap: Spacing.two,
    backgroundColor: OVERLAY_BG,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerTitle: {
    flex: 1,
    color: TEXT_MUTED,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hero: {
    alignItems: 'center',
  },
  heroValue: {
    color: TEXT,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    letterSpacing: 2,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: TEXT,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: TEXT,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: TEXT,
  },
  muted: {
    color: TEXT_MUTED,
  },
  centered: {
    textAlign: 'center',
  },
  shadowed: {
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  chips: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 20,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 26,
    height: 52,
  },
  startLabel: {
    fontSize: 16,
  },
  busy: {
    marginVertical: Spacing.two,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  circleWrap: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#FF8A80',
  },
  warning: {
    color: '#FFD98A',
  },
});
