export const isWebDavServerUp = async (
  url: string = 'http://127.0.0.1:2345/',
): Promise<boolean> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
      },
      signal: controller.signal as AbortSignal,
    });
    return response.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};
