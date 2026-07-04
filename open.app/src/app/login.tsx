import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/stores/auth-store';

// Surchargeable au build : EXPO_PUBLIC_SERVER_URL=https://open.baarr.fr npx expo run:ios ...
const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://open.baarr.ddev.site';

export default function LoginScreen() {
  const theme = useTheme();
  const signIn = useAuthStore((state) => state.signIn);

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !submitting && serverUrl.trim() !== '' && username.trim() !== '' && password !== '';

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signIn(serverUrl, username, password);
      // Succès : le guard de _layout bascule vers les tabs.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion impossible.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundElement, color: theme.text },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle" style={styles.title}>
            Open
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.intro}>
            Connectez-vous avec votre compte Drupal.
          </ThemedText>

          <ThemedText type="smallBold" style={styles.label}>
            Serveur
          </ThemedText>
          <TextInput
            style={inputStyle}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://open.baarr.fr"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!submitting}
          />

          <ThemedText type="smallBold" style={styles.label}>
            Identifiant
          </ThemedText>
          <TextInput
            style={inputStyle}
            value={username}
            onChangeText={setUsername}
            placeholder="Nom d’utilisateur"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            editable={!submitting}
          />

          <ThemedText type="smallBold" style={styles.label}>
            Mot de passe
          </ThemedText>
          <TextInput
            style={inputStyle}
            value={password}
            onChangeText={setPassword}
            placeholder="Mot de passe"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            textContentType="password"
            editable={!submitting}
            onSubmitEditing={canSubmit ? handleSubmit : undefined}
          />

          {error !== null && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            accessibilityRole="button"
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}>
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                Se connecter
              </ThemedText>
            )}
          </Pressable>
        </ScrollView>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  intro: {
    textAlign: 'center',
    marginBottom: Spacing.five,
  },
  label: {
    marginBottom: Spacing.one,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: Spacing.three,
  },
  error: {
    color: '#d64545',
    marginBottom: Spacing.three,
  },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: Spacing.two,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: '#ffffff',
  },
});
