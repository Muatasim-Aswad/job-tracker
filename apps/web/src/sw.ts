/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
  type PrecacheEntry,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

registerRoute(
  ({ url }) => url.origin === self.location.origin && ["/", "/index.html"].includes(url.pathname),
  new NetworkOnly({
    plugins: [
      { handlerDidError: async () => (await matchPrecache("/index.html")) ?? Response.error() },
    ],
  }),
);

precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [] });
cleanupOutdatedCaches();
