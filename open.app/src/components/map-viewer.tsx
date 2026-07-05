/**
 * Visionneuse de tracé plein écran (Modal) : carte librement manipulable
 * (zoom, rotation, inclinaison) avec les mêmes contrôles persistés que
 * l'écran Enregistrer. « Recentrer » recadre sur l'ensemble du tracé.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { MapControls, nextMapKind, zoomMap } from '@/components/map-controls';
import {
  loadMapPrefs,
  saveMapOrientation,
  saveMapType,
  type MapKind,
  type MapOrientation,
} from '@/services/prefs';

export type ViewerSegment = {
  seg: number;
  coords: { latitude: number; longitude: number }[];
};

const EDGE_PADDING = { top: 90, right: 60, bottom: 60, left: 60 };

export function MapViewer({
  visible,
  segments,
  strokeColor,
  onClose,
}: {
  visible: boolean;
  segments: ViewerSegment[];
  strokeColor: string;
  onClose: () => void;
}) {
  const mapRef = useRef<MapView>(null);
  const [orientation, setOrientation] = useState<MapOrientation>('north');
  const [mapType, setMapType] = useState<MapKind>('standard');

  const allCoords = segments.flatMap((segment) => segment.coords);
  const start = allCoords[0] ?? null;
  const end = allCoords.length > 1 ? allCoords[allCoords.length - 1] : null;

  // setState après await uniquement (pas de rendu en cascade).
  useEffect(() => {
    void loadMapPrefs().then((prefs) => {
      setOrientation(prefs.orientation);
      setMapType(prefs.mapType);
    });
  }, []);

  const handleRecenter = () => {
    if (allCoords.length > 0) {
      mapRef.current?.fitToCoordinates(allCoords, {
        edgePadding: EDGE_PADDING,
        animated: true,
      });
    }
  };

  const handleToggleOrientation = () => {
    const next: MapOrientation = orientation === 'north' ? 'course' : 'north';
    setOrientation(next);
    saveMapOrientation(next);
    if (next === 'north') {
      mapRef.current?.animateCamera({ heading: 0 }, { duration: 300 });
    }
  };

  const handleCycleMapType = () => {
    const next = nextMapKind(mapType);
    setMapType(next);
    saveMapType(next);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapType={mapType}
          rotateEnabled
          pitchEnabled
          onMapReady={handleRecenter}>
          {segments.map((segment) =>
            segment.coords.length > 1 ? (
              <Polyline
                key={segment.seg}
                coordinates={segment.coords}
                strokeColor={strokeColor}
                strokeWidth={4}
              />
            ) : null,
          )}
          {start !== null && <Marker coordinate={start} pinColor="green" title="Départ" />}
          {end !== null && <Marker coordinate={end} pinColor="red" title="Arrivée" />}
        </MapView>

        <Pressable
          accessibilityLabel="Fermer la carte"
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>

        <MapControls
          orientation={orientation}
          mapType={mapType}
          onRecenter={handleRecenter}
          onToggleOrientation={handleToggleOrientation}
          onCycleMapType={handleCycleMapType}
          onZoom={(direction) => void zoomMap(mapRef.current, direction)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    top: 64,
    left: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 14, 18, 0.55)',
  },
});
