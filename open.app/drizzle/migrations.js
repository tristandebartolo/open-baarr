// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_fancy_skullbuster.sql';
import m0001 from './0001_high_centennial.sql';
import m0002 from './0002_windy_moonstone.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002
    }
  }
  