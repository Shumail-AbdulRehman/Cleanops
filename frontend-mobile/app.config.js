const fs = require("node:fs");
const path = require("node:path");
// EAS file environment variables or an ignored local Firebase client config.
// Server/service-account credentials belong in Expo credentials, never the APK.
module.exports = ({ config }) => {
  const candidate =
    process.env.GOOGLE_SERVICES_JSON ||
    path.join(__dirname, "google-services.json");
  return {
    ...config,
    android: {
      ...config.android,
      ...(fs.existsSync(candidate) ? { googleServicesFile: candidate } : {}),
    },
  };
};
