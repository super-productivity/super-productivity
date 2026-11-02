/* global FetchEvent */
// Service worker entry point: Angular's ngsw-worker plus one transport fix.
//
// ngsw answers each prefetched asset with the Response that cache.match()
// returned. Chromium streams that body to the page through a data pipe, and a
// garbage collection in the worker can abort the stream mid-flight: the page
// gets net::ERR_ABORTED, one failed static import fails main.js's whole module
// graph, and the app never leaves the splash screen (#10715). A blob-backed
// copy goes through Chromium's blob path, which a collection does not abort.
//
// Once released, this file must stay deployed: installed clients check it for
// updates, and a missing sw.js leaves them on the old worker.
importScripts('./ngsw-worker.js');

const ngswRespondWith = FetchEvent.prototype.respondWith;

const toBlobBacked = async (response) => {
  // Opaque, partial (206), redirected and body-less responses pass through.
  if (
    !(response instanceof Response) ||
    response.type !== 'basic' ||
    response.status !== 200 ||
    response.redirected ||
    response.body === null
  ) {
    return response;
  }
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

FetchEvent.prototype.respondWith = function (response) {
  return ngswRespondWith.call(this, Promise.resolve(response).then(toBlobBacked));
};
