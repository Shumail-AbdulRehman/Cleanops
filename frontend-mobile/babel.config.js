module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          jsxImportSource: "nativewind",
          // Force Babel to transpile language features (class private fields, etc.)
          // instead of assuming the Hermes version on the device supports them.
          unstable_transformProfile: "default",
          // Disable babel-preset-expo's auto-injected worklets plugin so we can
          // control plugin ordering manually below.
          worklets: false,
        },
      ],
    ],
    plugins: [
      // NativeWind v4's CSS interop: replaces React.createElement calls so
      // className props are processed. We keep this instead of "nativewind/babel"
      // because that preset injects react-native-reanimated/plugin, which
      // conflicts with Reanimated v4's react-native-worklets/plugin.
      require("react-native-css-interop/dist/babel-plugin").default,
      // Reanimated v4 is built on react-native-worklets and requires this
      // plugin (not the legacy react-native-reanimated/plugin).
      "react-native-worklets/plugin",
    ],
  };
};
