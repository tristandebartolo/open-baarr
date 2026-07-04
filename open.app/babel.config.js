module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Migrations drizzle : import direct des fichiers .sql générés par drizzle-kit.
      ['inline-import', { extensions: ['.sql'] }],
    ],
  };
};
