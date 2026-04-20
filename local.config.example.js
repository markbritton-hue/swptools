// ── Local machine configuration ───────────────────────────────────────────
// Copy this file to local.config.js and fill in your own paths.
// local.config.js is gitignored — never commit it.

module.exports = {
  ffmpeg: 'C:/ffmpeg/bin/ffmpeg.exe',

  brave: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',

  apps: {
    // Keys must match the appKey field on equipment cards in Firestore.
    // Add any app you want to be launchable from the dashboard.
    'atem-software-control': 'C:\\Program Files\\Blackmagic Design\\ATEM Software Control\\ATEM Software Control.exe',
    'obs-studio':            'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe',
    // 'my-app':             'C:\\Path\\To\\MyApp.exe',
  },

  // Optional: poll Bitfocus Companion's HTTP API for variables and button values.
  // Requires "Enable HTTP API" to be ON in Companion Settings > Surfaces.
  companion: {
    host: '192.168.x.x',    // IP of the machine running Companion
    port: 8888,             // Companion HTTP API port (default 8888)
    poll: [
      // Variable example — key is what shows up in companionState
      { type: 'variable', connection: 'WebPresenter', variable: 'stream_state',    key: 'stream_state' },
      { type: 'variable', connection: 'WebPresenter', variable: 'stream_duration', key: 'stream_duration' },
      { type: 'variable', connection: 'WebPresenter', variable: 'platform',        key: 'platform' },

      // Button example — reads the text label of button at page/row/col
      // { type: 'button', page: 1, row: 0, col: 0, key: 'my_button_label' },
    ],
  },
};
