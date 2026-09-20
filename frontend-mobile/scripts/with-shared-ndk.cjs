// Keep native libraries on the app NDK, including native-library alignment.
const { withProjectBuildGradle } = require('expo/config-plugins');
module.exports = config => withProjectBuildGradle(config, config => {
  const marker = '// HygeneOps shared NDK across native libraries';
  if (!config.modResults.contents.includes(marker)) {
    config.modResults.contents += `\n${marker}\nallprojects { nativeProject ->\n  nativeProject.pluginManager.withPlugin('com.android.library') {\n    if (nativeProject.rootProject.ext.has('ndkVersion')) {\n      nativeProject.extensions.getByName('android').ndkVersion = nativeProject.rootProject.ext.ndkVersion\n    }\n  }\n}\n`;
  }
  return config;
});
