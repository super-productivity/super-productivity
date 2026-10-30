// AI View Builder: background half. The view-builder UI (index.html) runs in an
// iframe, which cannot reach secret storage, so the API key lives here and the
// UI asks for it over the plugin message channel. Secrets stay on this device:
// they are never synced, exported or backed up.

var API_KEY_SECRET = 'anthropicApiKey';

PluginAPI.onMessage(async function (message) {
  var type = message && message.type;
  if (type === 'getApiKey') {
    return { apiKey: await PluginAPI.getSecret(API_KEY_SECRET) };
  }
  if (type === 'setApiKey') {
    var apiKey = typeof message.apiKey === 'string' ? message.apiKey.trim() : '';
    if (!apiKey) {
      throw new Error('API key must not be empty');
    }
    await PluginAPI.setSecret(API_KEY_SECRET, apiKey);
    return { ok: true };
  }
  if (type === 'clearApiKey') {
    await PluginAPI.deleteSecret(API_KEY_SECRET);
    return { ok: true };
  }
  throw new Error('Unknown message type');
});
