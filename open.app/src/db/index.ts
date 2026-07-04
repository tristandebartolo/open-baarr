/**
 * Connexion SQLite partagée + migrations drizzle.
 *
 * `getDb()` est le seul point d'entrée : il ouvre la base, active WAL et
 * exécute les migrations au premier accès (mémoïsé). La tâche GPS en
 * arrière-plan comme l'app passent par lui — en contexte headless (app tuée,
 * relance par l'OS), le composant racine ne monte pas, donc pas de hook
 * `useMigrations` : la migration impérative couvre les deux cas.
 */

import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseSync } from 'expo-sqlite';

import migrations from '../../drizzle/migrations';
import * as schema from './schema';

export type Db = ExpoSQLiteDatabase<typeof schema>;

const DB_NAME = 'opencar.db';

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  dbPromise ??= (async () => {
    const sqlite = openDatabaseSync(DB_NAME);
    // WAL : lecteur (écran stats) et écrivain (tâche GPS) ne se bloquent pas.
    await sqlite.execAsync('PRAGMA journal_mode = WAL;');
    await sqlite.execAsync('PRAGMA foreign_keys = ON;');
    const db = drizzle(sqlite, { schema });
    await migrate(db, migrations);
    return db;
  })().catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}
