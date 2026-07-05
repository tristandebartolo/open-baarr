/**
 * Baselines : notes géolocalisées. Liste du compte (description masquée si
 * vide, thématiques en chips, switch publier, suppression) + formulaire
 * d'ajout — titre obligatoire, description, coordonnées capturées
 * automatiquement à l'ouverture, thématiques.
 *
 * Création en ligne uniquement (POST direct) : hors-ligne, un message
 * d'erreur clair est affiché — pas de file offline pour les baselines.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';

import { ThematiquesPicker } from '@/components/thematiques-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createBaseline,
  deleteBaseline,
  fetchBaselines,
  patchBaseline,
  type Baseline,
} from '@/services/baselines';
import { formatDateTime } from '@/utils/format';

export default function BaselinesScreen() {
  const theme = useTheme();
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [formVisible, setFormVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetchBaselines({ page: 0, limit: 50 });
      setBaselines(response.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Baselines indisponibles.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleTogglePublished = async (baseline: Baseline, published: boolean) => {
    try {
      const updated = await patchBaseline(baseline.uuid, { published });
      setBaselines((current) => current.map((b) => (b.uuid === updated.uuid ? updated : b)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publication impossible.');
    }
  };

  const handleDelete = (baseline: Baseline) => {
    Alert.alert('Supprimer la baseline', `« ${baseline.title} » sera définitivement supprimée.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteBaseline(baseline.uuid);
              setBaselines((current) => current.filter((b) => b.uuid !== baseline.uuid));
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Suppression impossible.');
            }
          })();
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.flex}>
      <FlatList
        data={baselines}
        keyExtractor={(baseline) => baseline.uuid}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListHeaderComponent={
          <>
            <Pressable
              onPress={() => setFormVisible(true)}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: Palette.accent, opacity: pressed ? 0.85 : 1 },
              ]}>
              <Ionicons name="add" size={20} color="#ffffff" />
              <ThemedText type="smallBold" style={styles.addLabel}>
                Ajouter une baseline
              </ThemedText>
            </Pressable>
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
              <Ionicons name="flag-outline" size={44} color={theme.textSecondary} />
              <ThemedText>Aucune baseline</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Une baseline est une note géolocalisée : un titre, une description, des
                thématiques — enregistrée à l’endroit où vous êtes.
              </ThemedText>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <BaselineRow
            baseline={item}
            onTogglePublished={(published) => void handleTogglePublished(item, published)}
            onDelete={() => handleDelete(item)}
          />
        )}
      />

      {formVisible && (
        <BaselineForm
          onCreated={(baseline) => {
            setBaselines((current) => [baseline, ...current]);
            setFormVisible(false);
          }}
          onDismiss={() => setFormVisible(false)}
        />
      )}
    </ThemedView>
  );
}

function BaselineRow({
  baseline,
  onTogglePublished,
  onDelete,
}: {
  baseline: Baseline;
  onTogglePublished: (published: boolean) => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const description = baseline.body?.trim() ?? '';
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleBlock}>
          <ThemedText type="smallBold">{baseline.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDateTime(baseline.created)}
            {baseline.coordinates !== null ? ' · 📍' : ''}
          </ThemedText>
        </View>
        <Pressable accessibilityLabel="Supprimer" onPress={onDelete} hitSlop={8}>
          <Ionicons name="trash-outline" size={18} color={Palette.danger} />
        </Pressable>
      </View>

      {/* Description masquée quand elle est vide. */}
      {description !== '' && <ThemedText type="small">{description}</ThemedText>}

      {baseline.thematiques.length > 0 && (
        <View style={styles.chips}>
          {baseline.thematiques.map((term) => (
            <View key={term.id} style={[styles.chip, { backgroundColor: Palette.accent + '22' }]}>
              <ThemedText type="small" style={{ color: Palette.accent }}>
                {term.name}
              </ThemedText>
            </View>
          ))}
        </View>
      )}

      <View style={styles.publishRow}>
        <ThemedText type="small" themeColor="textSecondary">
          {baseline.published ? 'Publiée sur le site' : 'Non publiée'}
        </ThemedText>
        <Switch
          value={baseline.published}
          onValueChange={onTogglePublished}
          trackColor={{ true: Palette.success }}
        />
      </View>
    </View>
  );
}

/** Formulaire d'ajout : coordonnées capturées automatiquement à l'ouverture. */
function BaselineForm({
  onCreated,
  onDismiss,
}: {
  onCreated: (baseline: Baseline) => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [thematiques, setThematiques] = useState<string[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Capture automatique de la position à l'ouverture (non bloquante :
  // permission refusée ou GPS muet → baseline sans coordonnées).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.granted) {
            const location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            if (!cancelled) {
              setPosition({ lat: location.coords.latitude, lng: location.coords.longitude });
            }
          }
        } catch (e) {
          console.warn('opencar: position de la baseline indisponible', e);
        } finally {
          if (!cancelled) {
            setLocating(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') {
      setFormError('Le titre est obligatoire.');
      return;
    }
    setSaving(true);
    try {
      const baseline = await createBaseline({
        uuid: Crypto.randomUUID(),
        title: trimmedTitle,
        ...(body.trim() !== '' ? { body: body.trim() } : {}),
        ...(position !== null ? { lat: position.lat, lng: position.lng } : {}),
        ...(thematiques.length > 0 ? { thematiques } : {}),
      });
      onCreated(baseline);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold">Nouvelle baseline</ThemedText>

          <ThemedText type="small" themeColor="textSecondary">
            Titre *
          </ThemedText>
          <TextInput
            style={inputStyle}
            value={title}
            onChangeText={setTitle}
            maxLength={255}
            placeholder="Ce que vous voulez retenir d’ici…"
            placeholderTextColor={theme.textSecondary}
            editable={!saving}
          />

          <ThemedText type="small" themeColor="textSecondary">
            Description
          </ThemedText>
          <TextInput
            style={[inputStyle, styles.bodyInput]}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={10000}
            placeholder="Optionnelle."
            placeholderTextColor={theme.textSecondary}
            editable={!saving}
          />

          <ThemedText type="small" themeColor="textSecondary">
            Thématiques
          </ThemedText>
          <ThematiquesPicker value={thematiques} onChange={setThematiques} disabled={saving} />

          <View style={styles.positionRow}>
            <Ionicons
              name={position !== null ? 'location' : 'location-outline'}
              size={16}
              color={position !== null ? Palette.success : theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {locating
                ? 'Localisation en cours…'
                : position !== null
                  ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} (automatique)`
                  : 'Position indisponible — baseline sans coordonnées.'}
            </ThemedText>
          </View>

          {formError !== null && (
            <ThemedText type="small" style={styles.error}>
              {formError}
            </ThemedText>
          )}

          <View style={styles.formActions}>
            <Pressable
              onPress={onDismiss}
              disabled={saving}
              style={({ pressed }) => [
                styles.formButton,
                { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
              ]}>
              <ThemedText type="smallBold">Annuler</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => void handleSave()}
              disabled={saving}
              style={({ pressed }) => [
                styles.formButton,
                { backgroundColor: Palette.accent, opacity: pressed || saving ? 0.7 : 1 },
              ]}>
              {saving ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" style={styles.saveLabel}>
                  Enregistrer
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 26,
    height: 52,
    marginBottom: Spacing.two,
  },
  addLabel: {
    color: '#ffffff',
    fontSize: 16,
  },
  card: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  cardTitleBlock: {
    flex: 1,
    gap: 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one + 2,
  },
  chip: {
    borderRadius: 14,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
  },
  publishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.three,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  bodyInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  formButton: {
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 2,
    minWidth: 110,
    alignItems: 'center',
  },
  saveLabel: {
    color: '#ffffff',
  },
  error: {
    color: Palette.danger,
  },
});
