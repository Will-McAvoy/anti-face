const MAIN_CHANNELS = new Set([
  'host:inspect', 'wallpaper:choose', 'settings:load', 'settings:save', 'settings:import', 'settings:export',
  'theme:inspect', 'theme:status', 'theme:apply', 'theme:restore', 'theme:restoreAll', 'theme:targets', 'theme:setAutoRestore',
  'telemetry:state', 'telemetry:setMode', 'telemetry:setTarget',
  'history:getSettings', 'history:setSettings', 'history:query', 'history:export', 'history:cleanup',
  'app:version', 'studio:state', 'editor:session',
  'preview:begin', 'preview:update', 'preview:commit', 'preview:cancel', 'preview:compare', 'preview:flush',
  'library:list', 'library:get', 'library:save', 'library:update', 'library:rename', 'library:copy', 'library:favorite', 'library:reorder', 'library:delete',
  'library:import', 'library:export',
  'wallpaper:update', 'wallpaper:remove', 'wallpaper:palette', 'wallpaper:reset', 'wallpaper:recent',
  'theme:applyDocument',
  'automation:get', 'automation:set', 'automation:pause', 'automation:resume',
  'preferences:get', 'preferences:set',
  'shortcuts:set', 'shortcuts:status',
  'mini:open', 'mini:close', 'mini:status',
  'notify:preview', 'notify:capability', 'notify:set', 'notify:test',
  'preview:resolveClose',
  'readability:analyze', 'readability:adopt',
  'diagnostics:inspect', 'diagnostics:export',
  'scene:watch', 'scene:unwatch', 'scene:poll', 'scene:explain',
  'capture:take', 'capture:list', 'capture:image', 'capture:clear', 'capture:invalidate', 'capture:export',
  'generator:create', 'generator:cancel', 'generator:adopt',
  'bindings:identify', 'bindings:list', 'bindings:save', 'bindings:remove', 'bindings:session', 'bindings:resume',
  'revisions:list', 'revisions:diff', 'revisions:restore', 'revisions:pin', 'revisions:retry', 'revisions:candidates', 'revisions:adopt',
  'catalog:page', 'catalog:get', 'catalog:preview', 'catalog:install',

  // Round 6 新增主窗口通信通道
  'recovery:restoreAll', 'safeMode:status', 'safeMode:enter', 'safeMode:exit',
  'switcher:open', 'switcher:toggle',
  'display:context', 'display:bounds',
  'backup:export', 'backup:inspect', 'backup:preview', 'backup:commit', 'backup:cancel',
  'performance:summary', 'performance:set',

  // Round 7 新增通信通道
  'library:updateTags',
  'theme:copyParts',
  'rotation:chooseFolder', 'rotation:status', 'rotation:set', 'rotation:next', 'rotation:pause', 'rotation:resume', 'rotation:saveToTheme',
  'apply:preview', 'apply:confirm',
  'autoBackup:status', 'autoBackup:set', 'autoBackup:runNow', 'autoBackup:chooseFolder', 'autoBackup:openFolder'
]);

const MINI_CHANNELS = new Set(['mini:snapshot', 'mini:open-main', 'mini:dismiss', 'mini:bounds']);

const SWITCHER_CHANNELS = new Set([
  'switcher:init',
  'switcher:selectTarget',
  'switcher:apply',
  'switcher:resolveConflict',
  'switcher:close'
]);

function authorize(role, channel) {
  if (role === 'main') return MAIN_CHANNELS.has(channel);
  if (role === 'mini') return MINI_CHANNELS.has(channel);
  if (role === 'switcher') return SWITCHER_CHANNELS.has(channel);
  return false;
}

module.exports = { authorize, MAIN_CHANNELS, MINI_CHANNELS, SWITCHER_CHANNELS };
