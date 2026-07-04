const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Migrations drizzle : Metro doit résoudre les fichiers .sql générés par drizzle-kit.
config.resolver.sourceExts.push('sql');

module.exports = config;
