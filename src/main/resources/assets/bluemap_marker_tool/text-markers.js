/* Exposes text labels through BlueMap's native marker set UI. */
(function () {
  "use strict";
  if (window.__blueMapMarkerTextSetLoaded) return;
  window.__blueMapMarkerTextSetLoaded = true;

  const SET_ID = "labels";
  let textItems = [];
  let markerFileManager = null;
  let originalUpdateFromData = null;
  let lastMarkerData = {};
  let apiUrl = null;

  function esc(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setModel(data) {
    if (!data || !Array.isArray(data.items)) return;
    textItems = data.items.filter((item) => item && item.type === "text");
  }

  function parseModelBody(body) {
    if (typeof body !== "string") return;
    try {
      setModel(JSON.parse(body));
    } catch (error) {
      console.warn("BlueMap Marker Tool could not parse marker update", error);
    }
  }

  function buildTextMarkerSet() {
    const set = {
      label: "Text Labels",
      toggleable: true,
      defaultHidden: false,
      markers: {}
    };

    textItems.forEach((item) => {
      if (!Array.isArray(item.points) || !item.points.length) return;
      const point = item.points[0];
      const marker = {
        type: "html",
        label: item.title || "Text",
        position: {
          x: Number(point.x) || 0,
          y: Number(item.y) || 64,
          z: Number(point.z) || 0
        },
        anchor: { x: 0, y: 0 },
        html: `<div class="xyn-label" style="color:${esc(item.color || "#ffffff")}"><div class="xyn-title">${esc(item.title)}</div>${item.subtitle ? `<div class="xyn-sub">${esc(item.subtitle)}</div>` : ""}</div>`,
        classes: ["xyn-text-marker"],
        listed: true,
        minDistance: Number(item.minDist) || 0
      };

      const maxDistance = Number(item.maxDist) || 0;
      if (maxDistance > 0) marker.maxDistance = maxDistance;
      set.markers[item.id] = marker;
    });

    return set;
  }

  function withTextMarkerSet(data) {
    const merged = Object.assign({}, data || {});
    merged[SET_ID] = buildTextMarkerSet();
    return merged;
  }

  function refreshMarkerSets() {
    if (!originalUpdateFromData) return;
    try {
      originalUpdateFromData(withTextMarkerSet(lastMarkerData));
    } catch (error) {
      console.warn("BlueMap Marker Tool could not refresh text markers", error);
    }
  }

  function installMarkerSetBridge() {
    const bm = window.bluemap;
    if (!bm || !bm.markerFileManager) {
      setTimeout(installMarkerSetBridge, 250);
      return;
    }

    markerFileManager = bm.markerFileManager;
    if (markerFileManager.__xynTextMarkerSetBridge) return;
    markerFileManager.__xynTextMarkerSetBridge = true;

    originalUpdateFromData = markerFileManager.updateFromData.bind(markerFileManager);
    markerFileManager.updateFromData = function (data) {
      lastMarkerData = data || {};
      return originalUpdateFromData(withTextMarkerSet(lastMarkerData));
    };

    loadModel();
  }

  function loadModel() {
    if (!apiUrl) return;
    window.fetch(apiUrl)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data) return;
        setModel(data);
        refreshMarkerSets();
      })
      .catch(() => {});
  }

  const previousFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const requestUrl = typeof input === "string" ? input : input && input.url ? input.url : "";
    const requestMethod = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

    if (requestMethod === "POST" && requestUrl.includes("/xyn/markers") && init && init.body) {
      parseModelBody(init.body);
      queueMicrotask(refreshMarkerSets);
    }

    return previousFetch(input, init);
  };

  const style = document.createElement("style");
  style.textContent = "#xynLabels{display:none!important}";
  document.head.appendChild(style);

  let tooltipCheckScheduled = false;
  window.addEventListener("pointermove", () => {
    if (tooltipCheckScheduled) return;
    tooltipCheckScheduled = true;
    requestAnimationFrame(() => {
      tooltipCheckScheduled = false;
      const tip = document.getElementById("xynTip");
      if (!tip || tip.style.display === "none") return;
      const title = tip.querySelector(".t")?.textContent?.trim() || "";
      const subtitle = tip.querySelector(".s")?.textContent?.trim() || "";
      if (!title && !subtitle) tip.style.display = "none";
    });
  }, true);

  window.fetch("/xyn-config.json")
    .then((response) => response.ok ? response.json() : null)
    .then((config) => {
      if (!config || !config.apiPort) return;
      apiUrl = window.location.protocol === "https:"
        ? "/xyn/markers"
        : "http://" + window.location.hostname + ":" + config.apiPort + "/xyn/markers";
      loadModel();
    })
    .catch(() => {});

  installMarkerSetBridge();
})();
