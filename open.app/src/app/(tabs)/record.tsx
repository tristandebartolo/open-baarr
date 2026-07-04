/**
 * Écran Enregistrer : carte live (react-native-maps, tracé par segment),
 * stats temps réel lues depuis SQLite, boutons start/pause/resume/stop.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACTIVITY_ICONS, ACTIVITY_LABELS, ACTIVITY_TYPES } from '@/constants/activities';
import { Spacing } from '@/constants/theme';
import type { ActivityType } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { useRecordStore } from '@/stores/record-store';
import { useSyncStore } from '@/stores/sync-store';
import { formatDistance, formatDuration, formatSpeed } from '@/utils/format';

const ACCENT = '#208AEF';
const DANGER = '#D64545';

export default function RecordScreen() {
  const theme = useTheme();
  const mapRef = useRef<MapView>(null);
  const [activityType, setActivityType] = useState<ActivityType>('car');

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

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
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
              strokeColor={ACCENT}
              strokeWidth={4}
            />
          ) : null,
        )}
      </MapView>

      <View style={[styles.panel, { backgroundColor: theme.background }]}>
        {error !== null && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        {active && trip !== null && (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {trip.title}
              {phase === 'paused' ? ' — en pause' : ''}
            </ThemedText>
            <View style={styles.statsRow}>
              <Stat label="Distance" value={formatDistance(distanceM)} />
              <Stat label="Durée" value={formatDuration(movingMs)} />
              <Stat label="Vitesse" value={formatSpeed(speedMs)} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {pointCount} points · écoulé {formatDuration(elapsedMs)} ·{' '}
              {syncing
                ? 'sync en cours…'
                : unsyncedCount > 0
                  ? `${unsyncedCount} à synchroniser`
                  : 'synchronisé'}
            </ThemedText>
            {!backgroundGranted && (
              <ThemedText type="small" style={styles.warning}>
                Localisation « Toujours » refusée : l’enregistrement s’interrompra si l’app passe
                en arrière-plan.
              </ThemedText>
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
              return (
                <Pressable
                  key={type}
                  onPress={() => setActivityType(type)}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? ACCENT : theme.backgroundElement },
                  ]}>
                  <Ionicons
                    name={ACTIVITY_ICONS[type] as keyof typeof Ionicons.glyphMap}
                    size={16}
                    color={selected ? '#ffffff' : theme.textSecondary}
                  />
                  <ThemedText
                    type="smallBold"
                    style={{ color: selected ? '#ffffff' : theme.text }}>
                    {ACTIVITY_LABELS[type]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.buttonsRow}>
          {phase === 'idle' && (
            <ActionButton
              label="Démarrer"
              icon="radio-button-on"
              color={ACCENT}
              onPress={() => void start(activityType)}
            />
          )}
          {busy && <ActivityIndicator size="large" color={ACCENT} />}
          {phase === 'recording' && (
            <ActionButton
              label="Pause"
              icon="pause"
              color={theme.backgroundSelected}
              textColor={theme.text}
              onPress={() => void pause()}
            />
          )}
          {phase === 'paused' && (
            <ActionButton
              label="Reprendre"
              icon="play"
              color={ACCENT}
              onPress={() => void resume()}
            />
          )}
          {active && (
            <ActionButton
              label="Terminer"
              icon="stop"
              color={DANGER}
              onPress={() => void stop()}
            />
          )}
        </View>
      </View>
    </ThemedView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="subtitle" style={styles.statValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  color,
  textColor = '#ffffff',
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  textColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: color, opacity: pressed ? 0.8 : 1 },
      ]}>
      <Ionicons name={icon} size={20} color={textColor} />
      <ThemedText type="smallBold" style={{ color: textColor }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  panel: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    lineHeight: 30,
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
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 24,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 4,
    minWidth: 130,
  },
  error: {
    color: '#D64545',
  },
  warning: {
    color: '#B8860B',
  },
});
