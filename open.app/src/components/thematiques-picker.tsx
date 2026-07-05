/**
 * Sélecteur de thématiques (partagé baseline + détail trajet) :
 * chips des termes choisis (toucher la croix pour retirer), recherche avec
 * debounce dans le vocabulaire Drupal, création d'un nouveau terme quand
 * aucun ne correspond exactement.
 *
 * `value` est la liste des noms — l'appelant l'envoie telle quelle à l'API
 * (remplacement complet du champ côté serveur).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { searchThematiques, type Thematique } from '@/services/baselines';

export function ThematiquesPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Thematique[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nettoyage du debounce au démontage.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Recherche avec debounce (~300 ms), déclenchée par la saisie ;
  // hors-ligne → suggestions vides, la création par saisie libre reste
  // possible.
  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    if (text.trim() === '') {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      searchThematiques(text.trim())
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 300);
  };

  const has = (name: string) => value.some((v) => v.toLowerCase() === name.toLowerCase());

  const add = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === '' || has(trimmed)) {
      setQuery('');
      return;
    }
    onChange([...value, trimmed]);
    setQuery('');
    setSuggestions([]);
  };

  const remove = (name: string) => {
    onChange(value.filter((v) => v !== name));
  };

  const visibleSuggestions = suggestions.filter((s) => !has(s.name));
  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === query.trim().toLowerCase());
  const canCreate = query.trim() !== '' && !exactMatch && !has(query);

  return (
    <View style={styles.container}>
      {value.length > 0 && (
        <View style={styles.chips}>
          {value.map((name) => (
            <View key={name} style={[styles.chip, { backgroundColor: Palette.accent + '22' }]}>
              <ThemedText type="small" style={{ color: Palette.accent }}>
                {name}
              </ThemedText>
              {!disabled && (
                <Pressable
                  accessibilityLabel={`Retirer ${name}`}
                  onPress={() => remove(name)}
                  hitSlop={6}>
                  <Ionicons name="close" size={14} color={Palette.accent} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      <TextInput
        style={[styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }]}
        value={query}
        onChangeText={handleQueryChange}
        placeholder="Rechercher ou créer une thématique…"
        placeholderTextColor={theme.textSecondary}
        editable={!disabled}
        maxLength={255}
        onSubmitEditing={() => add(query)}
        returnKeyType="done"
      />

      {(visibleSuggestions.length > 0 || canCreate) && (
        <View style={[styles.suggestions, { backgroundColor: theme.backgroundElement }]}>
          {visibleSuggestions.map((term) => (
            <Pressable
              key={term.id}
              onPress={() => add(term.name)}
              style={({ pressed }) => [styles.suggestion, { opacity: pressed ? 0.6 : 1 }]}>
              <Ionicons name="pricetag-outline" size={14} color={Palette.accent} />
              <ThemedText type="small">{term.name}</ThemedText>
            </Pressable>
          ))}
          {canCreate && !searching && (
            <Pressable
              onPress={() => add(query)}
              style={({ pressed }) => [styles.suggestion, { opacity: pressed ? 0.6 : 1 }]}>
              <Ionicons name="add" size={15} color={Palette.success} />
              <ThemedText type="small" style={{ color: Palette.success }}>
                Créer « {query.trim()} »
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one + 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 14,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 5,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  suggestions: {
    borderRadius: 12,
    paddingVertical: Spacing.one,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
