// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // .expo : types de routes générés par expo-router (non maintenus à la main).
    ignores: ["dist/*", ".expo/*"],
  }
]);
