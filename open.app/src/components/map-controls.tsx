/**
 * Pile de contrôles flottants d'une carte (écran Enregistrer et visionneuse
 * plein écran) : recentrer, orientation Nord/Cap, zoom ±, type de carte.
 * Les préférences (orientation, type, zoom) sont persistées par l'appelant
 * via `services/prefs.ts`.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import type MapView from 'react-native-maps';

import type { MapKind, MapOrientation } from '@/services/prefs';
import { saveMapAltitude } from '@/services/prefs';

const BUTTON_BG = 'rgba(12, 14, 18, 0.55)';
const ICON = '#FFFFFF';

const MAP_KINDS: MapKind[] = ['standard', 'satellite', 'hybrid'];

/** Zoom ± : Apple Maps pilote l'altitude caméra, Google un niveau de zoom. */
export async function zoomMap(map: MapView | null, direction: 'in' | 'out'): Promise<void> {
  if (map === null) {
    return;
  }
  try {
    const camera = await map.getCamera();
    if (camera.zoom != null) {
      map.animateCamera({ zoom: camera.zoom + (direction === 'in' ? 1 : -1) }, { duration: 250 });
    } else if (camera.altitude != null) {
      const altitude = Math.min(
        500000,
        Math.max(100, direction === 'in' ? camera.altitude / 1.8 : camera.altitude * 1.8),
      );
      map.animateCamera({ altitude }, { duration: 250 });
      saveMapAltitude(altitude);
    }
  } catch (e) {
    console.warn('opencar: zoom carte impossible', e);
  }
}

export function MapControls({
  orientation,
  mapType,
  onRecenter,
  onToggleOrientation,
  onCycleMapType,
  onZoom,
}: {
  orientation: MapOrientation;
  mapType: MapKind;
  onRecenter: () => void;
  onToggleOrientation: () => void;
  onCycleMapType: () => void;
  onZoom: (direction: 'in' | 'out') => void;
}) {
  return (
    <View style={styles.stack} pointerEvents="box-none">
      <ControlButton
        icon="locate"
        label="Recentrer"
        onPress={onRecenter}
      />
      <ControlButton
        icon={orientation === 'course' ? 'navigate' : 'compass-outline'}
        label={orientation === 'course' ? 'Orientation : cap' : 'Orientation : nord'}
        onPress={onToggleOrientation}
      />
      <ControlButton icon="add" label="Zoomer" onPress={() => onZoom('in')} />
      <ControlButton icon="remove" label="Dézoomer" onPress={() => onZoom('out')} />
      <ControlButton
        icon="layers-outline"
        label={`Type de carte : ${mapType}`}
        onPress={onCycleMapType}
      />
    </View>
  );
}

/** Type de carte suivant dans le cycle standard → satellite → hybride. */
export function nextMapKind(current: MapKind): MapKind {
  return MAP_KINDS[(MAP_KINDS.indexOf(current) + 1) % MAP_KINDS.length];
}

function ControlButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={20} color={ICON} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    // Sous la boussole native iOS (affichée en haut à droite quand la carte
    // est orientée).
    top: 64,
    right: 12,
    gap: 8,
  },
  button: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BUTTON_BG,
  },
});
