/**
 * Mini-formulaire des métadonnées d'une photo de trajet (description,
 * copyright) — présenté en modale à l'ajout d'une photo, et réutilisé pour
 * la modification d'une photo existante dans la galerie.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PhotoFormValues = {
  description: string | null;
  copyright: string | null;
};

export function PhotoFormModal({
  visible,
  title,
  initial,
  submitLabel,
  skipLabel,
  busy = false,
  onSubmit,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  initial: PhotoFormValues;
  submitLabel: string;
  /** Libellé du bouton secondaire (ex. « Passer ») ; masqué si null. */
  skipLabel: string | null;
  busy?: boolean;
  onSubmit: (values: PhotoFormValues) => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const [description, setDescription] = useState(initial.description ?? '');
  const [copyright, setCopyright] = useState(initial.copyright ?? '');

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundSelected, color: theme.text },
  ];

  const handleSubmit = () => {
    const trimmedDescription = description.trim();
    const trimmedCopyright = copyright.trim();
    onSubmit({
      description: trimmedDescription === '' ? null : trimmedDescription.slice(0, 1000),
      copyright: trimmedCopyright === '' ? null : trimmedCopyright.slice(0, 255),
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold">{title}</ThemedText>

          <ThemedText type="small" themeColor="textSecondary">
            Description
          </ThemedText>
          <TextInput
            style={[inputStyle, styles.descriptionInput]}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={1000}
            placeholder="Ce que montre la photo…"
            placeholderTextColor={theme.textSecondary}
            editable={!busy}
          />

          <ThemedText type="small" themeColor="textSecondary">
            Copyright
          </ThemedText>
          <TextInput
            style={inputStyle}
            value={copyright}
            onChangeText={setCopyright}
            maxLength={255}
            placeholder="© …"
            placeholderTextColor={theme.textSecondary}
            editable={!busy}
          />

          <View style={styles.actions}>
            {skipLabel !== null && (
              <Pressable
                onPress={onDismiss}
                disabled={busy}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
                ]}>
                <ThemedText type="smallBold">{skipLabel}</ThemedText>
              </Pressable>
            )}
            <Pressable
              onPress={handleSubmit}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: Palette.accent, opacity: pressed || busy ? 0.7 : 1 },
              ]}>
              {busy ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" style={styles.submitLabel}>
                  {submitLabel}
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
  descriptionInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 2,
    minWidth: 110,
    alignItems: 'center',
  },
  submitLabel: {
    color: '#ffffff',
  },
});
