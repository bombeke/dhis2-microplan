/** DHIS2 application manifest. Consumed by @dhis2/cli-app-scripts. */
const config = {
  type: 'app',
  name: 'microplanv2',
  title: 'Outreach Microplan & Coverage v2',
  description:
    'Team-by-ward outreach planning, settlement coverage maps, and out-of-bounds data-point flagging.',

  entryPoints: {
    app: './src/App.tsx',
  },

  // Minimum DHIS2 version exercising the analytics/tracker APIs we rely on.
  minDHIS2Version: '2.40',

  // App Platform v12+ builds with Vite. Extra Vite config (worker format,
  // path alias, dependency pre-bundling) lives in the file below and is
  // merged into the platform's own Vite config.
  viteConfigExtensions: './vite.config.extensions.mts',

  // Custom authorities can be declared here if you gate features by role.
  customAuthorities: [
    'F_VIEW_MICROPLAN',
    'F_ADD_MICROPLAN',
    'F_DELETE_MICROPLAN',
    'F_DOWNLOAD_MICROPLAN',
    'F_ADMIN_MICROPLAN',
    'F_READ_GPS_MICROPLAN',
    'F_CREATE_MICROPLAN',
    'F_APPROVE_MICROPLAN',
    // Manage Settlements (settlement GPS / polygon curation)
    'F_CREATE_GPS_MICROPLAN',
    'F_APPROVE_GPS_MICROPLAN',
    'F_VIEW_GPS_ALL_MICROPLAN',
    'F_CREATE_GPS_ALL_MICROPLAN',
    'F_APPROVE_GPS_ALL_MICROPLAN',
    // Manage Duplicates (tracked-entity duplicate review and merge)
    'F_REVIEW_DUPLICATES_MICROPLAN',
    'F_APPROVE_DUPLICATES_MICROPLAN',
    'F_REVIEW_DUPLICATES_ALL_MICROPLAN',
    'F_APPROVE_DUPLICATES_ALL_MICROPLAN',
  ],
};

module.exports = config;
