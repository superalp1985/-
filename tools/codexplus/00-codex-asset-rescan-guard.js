// Portable copy for Codex++ user scripts.
// Stop Codex++ 1.3.0 (diag-20260518-1) from repeatedly rescanning app assets
// on Codex 26.917.9434.0. Remove this workaround after an official fix.
(() => {
  const affectedVersion = "1.3.0";
  const affectedBuild = "diag-20260518-1";
  const guardVersion = "1";

  if (window.__CODEX_PLUS_VERSION__ !== affectedVersion) return;
  if (window.__CODEX_PLUS_BUILD__ !== affectedBuild) return;
  if (window.__codexAssetRescanGuard?.version === guardVersion) return;
  if (typeof window.fetch !== "function") return;

  const nativeFetch = window.fetch;
  const markers = {
    appServer: "7",
    serviceTier: "9",
    dictation: "1",
  };
  let blockedRequests = 0;
  let markerTimer = 0;
  let markerStopTimer = 0;

  const isAssetScript = (url) =>
    /^app:\/\/-\/assets\/.*\.js(?:[?#].*)?$/i.test(String(url || ""));

  const isAffectedRescan = () => {
    const stack = String(new Error().stack || "");
    return stack.includes("codexAppAssetUrlFromScriptText");
  };

  const guardedFetch = function (input, init) {
    let url = "";
    try {
      url = typeof input === "string" ? input : input?.url || String(input);
    } catch {}

    if (isAssetScript(url) && isAffectedRescan()) {
      blockedRequests += 1;
      if (window.__codexAssetRescanGuard) {
        window.__codexAssetRescanGuard.blockedRequests = blockedRequests;
        window.__codexAssetRescanGuard.lastBlockedUrl = url;
      }
      return Promise.resolve(new Response("", {
        status: 200,
        headers: { "content-type": "text/javascript; charset=utf-8" },
      }));
    }
    return nativeFetch.apply(this, arguments);
  };

  const installMarkers = () => {
    window.__codexPlusAppServerModelRequestPatchInstalled = markers.appServer;
    window.__codexServiceTierRequestOverrideInstalled = markers.serviceTier;
    window.__codexDictationSupportPatched = markers.dictation;
  };

  const restore = () => {
    if (window.fetch === guardedFetch) window.fetch = nativeFetch;
    clearInterval(markerTimer);
    clearTimeout(markerStopTimer);
  };

  window.fetch = guardedFetch;
  installMarkers();
  markerTimer = window.setInterval(installMarkers, 250);
  markerStopTimer = window.setTimeout(() => {
    clearInterval(markerTimer);
    markerTimer = 0;
  }, 10000);

  window.__codexAssetRescanGuard = {
    version: guardVersion,
    enabled: true,
    affectedVersion,
    affectedBuild,
    blockedRequests,
    lastBlockedUrl: "",
    restore,
  };

  window.__codexPlusUserScripts?.registerCleanup?.(restore);
})();
