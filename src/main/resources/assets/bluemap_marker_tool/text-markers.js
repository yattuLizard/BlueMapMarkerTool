/* Keeps BlueMap marker sets stable across live updates and map reloads. */
(function () {
  "use strict";
  if (window.__blueMapMarkerTextSetLoaded) return;
  window.__blueMapMarkerTextSetLoaded = true;

  let model = { items: [] };
  let apiUrl = null;
  let currentManager = null;
  let originalUpdateFromData = null;

  function esc(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hex2rgb(value) {
    const hex = String(value || "#ffffff").replace("#", "");
    const full = hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex.padEnd(6, "f").slice(0, 6);
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16)
    };
  }

  function shapeCenter(points) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    points.forEach((p) => {
      minX = Math.min(minX, Number(p.x) || 0);
      maxX = Math.max(maxX, Number(p.x) || 0);
      minZ = Math.min(minZ, Number(p.z) || 0);
      maxZ = Math.max(maxZ, Number(p.z) || 0);
    });
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  }

  function setModel(data) {
    if (data && Array.isArray(data.items)) model = data;
  }

  function parseModelBody(body) {
    if (typeof body !== "string") return;
    try {
      setModel(JSON.parse(body));
    } catch (error) {
      console.warn("BlueMap Marker Tool could not parse marker update", error);
    }
  }

  function buildAreaSet() {
    const set = {
      label: "Areas",
      toggleable: true,
      defaultHidden: false,
      markers: {}
    };

    model.items.forEach((item) => {
      if (!item || item.type !== "area" || !Array.isArray(item.points) || item.points.length < 3) return;
      const c = hex2rgb(item.color || "#4caf50");
      const center = shapeCenter(item.points);
      const title = item.title || "";
      const subtitle = item.subtitle || "";
      set.markers[item.id] = {
        type: "shape",
        label: title,
        detail: `<b>${esc(title)}</b>` + (subtitle ? `<br>${esc(subtitle)}` : ""),
        position: { x: center.x, y: Number(item.y) || 64, z: center.z },
        shape: item.points.map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 })),
        shapeY: Number(item.y) || 64,
        lineWidth: 3,
        lineColor: { r: c.r, g: c.g, b: c.b, a: 1 },
        fillColor: { r: c.r, g: c.g, b: c.b, a: item.fill != null ? Number(item.fill) : 0.25 },
        depthTest: false,
        listed: true
      };
    });

    return set;
  }

  function buildTextSet() {
    const set = {
      label: "Text Labels",
      toggleable: true,
      defaultHidden: false,
      markers: {}
    };

    model.items.forEach((item) => {
      if (!item || item.type !== "text" || !Array.isArray(item.points) || !item.points.length) return;
      const point = item.points[0];
      const title = item.title || "";
      const subtitle = item.subtitle || "";
      const marker = {
        type: "html",
        label: title.trim() || subtitle.trim() || "Text",
        position: {
          x: Number(point.x) || 0,
          y: Number(item.y) || 64,
          z: Number(point.z) || 0
        },
        anchor: { x: 0, y: 0 },
        html: `<div class="xyn-label" style="color:${esc(item.color || "#ffffff")}"><div class="xyn-title">${esc(title)}</div>${subtitle ? `<div class="xyn-sub">${esc(subtitle)}</div>` : ""}</div>`,
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

  function removeLegacyAreaSet(manager) {
    const root = manager && manager.root;
    if (!root || !root.markerSets || typeof root.remove !== "function") return;
    const legacy = root.markerSets.get("xyn-areas");
    if (legacy) root.remove(legacy);
  }

  function refreshManagedSets() {
    const manager = currentManager;
    if (!manager || !manager.root || typeof manager.root.updateMarkerSetFromData !== "function") return;
    try {
      removeLegacyAreaSet(manager);
      manager.root.updateMarkerSetFromData("areas", buildAreaSet());
      manager.root.updateMarkerSetFromData("labels", buildTextSet());
    } catch (error) {
      console.warn("BlueMap Marker Tool could not refresh managed markers", error);
    }
  }

  function augmentUpdate(data) {
    const incoming = Object.assign({}, data || {});
    delete incoming["xyn-areas"];

    const keys = Object.keys(incoming);
    const localAreaPreview = keys.length === 1 && keys[0] === "areas";

    if (!localAreaPreview) incoming.areas = buildAreaSet();
    incoming.labels = buildTextSet();
    return incoming;
  }

  function installManager(manager) {
    if (!manager || !manager.root) return;
    currentManager = manager;
    removeLegacyAreaSet(manager);

    if (!manager.__xynManagedSetBridge) {
      manager.__xynManagedSetBridge = true;
      const original = manager.updateFromData.bind(manager);
      manager.__xynOriginalUpdateFromData = original;
      manager.updateFromData = function (data) {
        return original(augmentUpdate(data));
      };

      try {
        if (typeof manager.pauseAutoUpdates === "function") manager.pauseAutoUpdates();
      } catch (error) {
        console.warn("BlueMap Marker Tool could not pause marker polling", error);
      }
    }

    originalUpdateFromData = manager.__xynOriginalUpdateFromData || null;
    refreshManagedSets();
  }

  function ensureCurrentManager() {
    const manager = window.bluemap && window.bluemap.markerFileManager;
    if (!manager || !manager.root) return;
    if (manager !== currentManager) installManager(manager);
    else removeLegacyAreaSet(manager);
  }

  function loadModel() {
    if (!apiUrl) return;
    window.fetch(apiUrl)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data) return;
        setModel(data);
        refreshManagedSets();
      })
      .catch(() => {});
  }

  const previousFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const requestUrl = typeof input === "string" ? input : input && input.url ? input.url : "";
    const requestMethod = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

    if (requestMethod === "POST" && requestUrl.includes("/xyn/markers") && init && init.body) {
      parseModelBody(init.body);
      queueMicrotask(refreshManagedSets);
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

  setInterval(ensureCurrentManager, 100);
  ensureCurrentManager();
})();
