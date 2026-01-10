export const isWebDavServerUp = async (
  url: string = 'http://127.0.0.1:2345/',
): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    // We use fetch to check connectivity. Even 401 means it's reachable.
    await fetch(url, {
      method: 'HEAD',
      signal: controller.signal as AbortSignal,
    });
    clearTimeout(timeoutId);
    return true;
  } catch (e) {
    return false;
  }
};
