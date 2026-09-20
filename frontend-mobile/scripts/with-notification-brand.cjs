// Expo SDK 54 reads this metadata for the full-color logo beside an alert.
// Keep the small status-bar icon separate: Android requires a white silhouette.
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = config => {
  config = withAndroidManifest(config, mod => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const name = 'expo.modules.notifications.large_notification_icon';
    app['meta-data'] = (app['meta-data'] || []).filter(item => item.$['android:name'] !== name);
    app['meta-data'].push({ $: {
      'android:name': name,
      'android:resource': '@drawable/hygene_notification_brand',
    } });
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const root = mod.modRequest.projectRoot;
    for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
      const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res', `drawable-${density}`);
      const { source } = await generateImageAsync({ projectRoot: root, cacheType: 'hygene-notification-brand' }, {
        src: path.resolve(root, mod.icon || './assets/hygene-ops-icon.png'),
        width: 64 * scale,
        height: 64 * scale,
        resizeMode: 'contain',
        backgroundColor: 'transparent',
      });
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'hygene_notification_brand.png'), source);
    }
    return mod;
  }]);
};
