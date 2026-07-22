// react-native-worklets/plugin is required by react-native-reanimated 4 (pulled
// in by react-native-keyboard-controller). It MUST be the last plugin.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
