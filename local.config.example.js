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
};
