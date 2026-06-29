/** DHIS2 application manifest. Consumed by @dhis2/cli-app-scripts. */
const config = {
  type: 'app',
  name: 'microplan',
  title: 'Outreach Microplan & Coverage',
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
  authorities: ['ALL'],
};

module.exports = config;
