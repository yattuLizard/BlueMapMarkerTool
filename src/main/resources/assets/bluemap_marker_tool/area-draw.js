/* XynMarkers – in-webapp marker editor. Loaded via BlueMap webapp `scripts`. */
(function () {
  "use strict";
  if (window.__xynMarkersLoaded) return;

  function boot() {
    const bm = window.bluemap;
    if (!bm || !bm.mapViewer || !bm.markerFileManager || !bm.mapViewer._camera) {
      return setTimeout(boot, 400);
    }
    window.__xynMarkersLoaded = true;

    const mv = bm.mapViewer;
    const Vec3 = mv.raycaster.ray.origin.constructor;
    const getCam = () => mv._camera || mv.camera;
    const getCanvas = () => mv.rootElement.querySelector("canvas");

    // ---- API config (read from xyn-config.json written by the mod) ----
    let API_URL = null; // set after config loads

    fetch("/xyn-config.json")
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (cfg && cfg.apiPort) {
          API_URL = window.location.protocol === "https:"
            ? window.location.origin + "/xyn/markers"
            : "http://" + window.location.hostname + ":" + cfg.apiPort + "/xyn/markers";
          loadFromServer();
        }
      })
      .catch(() => {});

    function loadFromServer() {
      if (!API_URL) return;
      fetch(API_URL)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && Array.isArray(data.items)) {
            model = data;
            preview();
            refresh();
          }
        })
        .catch(() => {});
    }

    function saveToServer() {
      if (!API_URL) return;
      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model)
      })
        .then(r => {
          if (r.status === 403) msg("✗ Wrong password — not saved");
          else if (r.ok) msg("✓ Saved to server");
          else msg("✗ Server error " + r.status);
        })
        .catch(() => msg("✗ Could not reach server"));
    }

    function persist() {
      saveToServer();
    }

    // ---- injected styles ----
    const style = document.createElement("style");
    style.textContent = `
      .xyn-label{transform:translate(-50%,-50%);text-align:center;pointer-events:none;white-space:nowrap;
        font-family:system-ui,sans-serif;text-shadow:0 1px 3px #000,0 0 6px #000}
      .xyn-label .xyn-title{font-weight:800;font-size:19px;letter-spacing:.5px;line-height:1.1}
      .xyn-label .xyn-sub{font-size:12px;font-weight:600;opacity:.9;line-height:1.2}
      #xynLabels{position:fixed;inset:0;pointer-events:none;z-index:9997;overflow:hidden}
      #xynLabels .xyn-ovl{position:absolute}
      #xynTip{position:fixed;z-index:10001;pointer-events:none;display:none;max-width:240px;
        background:rgba(20,22,28,.94);color:#fff;border:1px solid rgba(255,255,255,.15);
        border-radius:12px;padding:8px 12px;font-family:system-ui,sans-serif;
        box-shadow:0 8px 28px rgba(0,0,0,.5);transform:translate(-50%,calc(-100% - 14px))}
      #xynTip .t{font-weight:800;font-size:14px}
      #xynTip .s{font-size:12px;opacity:.82;margin-top:2px}
      #xynTip:after{content:"";position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);
        border:7px solid transparent;border-top-color:rgba(20,22,28,.94);border-bottom:0}
      #xynPanel input,#xynPanel select,#xynPanel textarea{font-family:inherit}
    `;
    document.head.appendChild(style);

    const tip = document.createElement("div");
    tip.id = "xynTip";
    tip.innerHTML = '<div class="t"></div><div class="s"></div>';
    document.body.appendChild(tip);


    // ---- model ----
    let model = { items: [] };
    let sel = null;
    let mode = "idle";
    let dragIdx = -1;

    function uid() { return "m" + Math.random().toString(36).slice(2, 8); }
    function slug(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
    function hex2rgb(h) { return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }; }
    function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function escAttr(s) { return esc(s).replace(/"/g, "&quot;").replace(/\x27/g, "&#39;"); }

    // ---- coordinate transforms ----
    function screenToWorld(cx, cy, y) {
      const r = getCanvas().getBoundingClientRect();
      const nx = ((cx - r.left) / r.width) * 2 - 1;
      const ny = -(((cy - r.top) / r.height) * 2 - 1);
      mv.raycaster.setFromCamera({ x: nx, y: ny }, getCam());
      const o = mv.raycaster.ray.origin, d = mv.raycaster.ray.direction;
      const t = (y - o.y) / d.y;
      return { x: Math.round(o.x + t * d.x), z: Math.round(o.z + t * d.z) };
    }
    function worldToScreen(x, z, y) {
      const v = new Vec3(x, y, z); v.project(getCam());
      const r = getCanvas().getBoundingClientRect();
      return { x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top, vis: v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
    }
    function viewDistance() {
      const c = screenToWorld(innerWidth / 2, innerHeight / 2, 0);
      const cam = getCam();
      return Math.round(Math.hypot(cam.position.x - c.x, cam.position.y, cam.position.z - c.z));
    }

    // ---- BlueMap live preview ----
    const ROUTE_TYPES = Object.freeze({
      road: { setId: "roads", label: "Roads", name: "Road", color: "#efa53a", width: 5, defaultY: 70 },
      sea: { setId: "sea_routes", label: "Sea Routes", name: "Sea Route", color: "#259cfa", width: 4, defaultY: 63 },
      air: { setId: "air_routes", label: "Air Routes", name: "Air Route", color: "#bf85f7", width: 3, defaultY: 160 }
    });
    const network = window.XYNFairwayNetwork;
    const TOOL_SETS = ["areas", "labels", "roads", "sea_routes", "air_routes", "fairways", "waypoints"];
    function isRoute(type) { return Object.prototype.hasOwnProperty.call(ROUTE_TYPES, type); }
    function isWaypointType(type) { return isRoute(type) || type === "fairway"; }
    function isOpenLine(item) { return isRoute(item.type) || (item.type === "fairway" && item.geometry !== "polygon"); }
    function fairwayShape(item) {
      const geometry = window.XYNFairwayGeometry;
      if (!geometry || !Array.isArray(item.points)) return [];
      if (item.geometry === "polygon") {
        return item.points.length >= 3 && !geometry.hasSelfIntersection(item.points)
          ? item.points : [];
      }
      const width = Number(item.width ?? 40);
      if (!Number.isFinite(width) || width <= 0) return [];
      return geometry.corridorPolygon(item.points, Math.min(4096, width));
    }

    function heightAt(point, item) {
      return point.y !== undefined && Number.isFinite(Number(point.y)) ? Number(point.y) : Number(item.y) || 64;
    }
    function bboxCenter(points) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    }
    function safeHex(value, fallback = "#ffffff") {
      return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
    }
    function buildData() {
      const sets = {
        areas: { label: "Areas", toggleable: true, defaultHidden: false, markers: {} },
        labels: { label: "Text Labels", toggleable: true, defaultHidden: false, markers: {} },
        fairways: { label: "Fairways", toggleable: true, defaultHidden: false, markers: {} },
        waypoints: { label: "Waypoints", toggleable: true, defaultHidden: true, markers: {} }
      };
      for (const type of Object.keys(ROUTE_TYPES)) {
        const route = ROUTE_TYPES[type];
        sets[route.setId] = { label: route.label, toggleable: true, defaultHidden: false, markers: {} };
      }
      for (const it of model.items) {
        if (!it || !Array.isArray(it.points)) continue;
        const points = it.points;
        if (it.type === "area") {
          if (points.length < 3) continue;
          const c = hex2rgb(safeHex(it.color, "#4caf50"));
          const ct = bboxCenter(points.map(p => ({ x: Number(p.x) || 0, y: Number(it.y) || 64, z: Number(p.z) || 0 })));
          const title = String(it.title || ""), subtitle = String(it.subtitle || "");
          sets.areas.markers[it.id] = {
            type: "shape", label: title,
            detail: esc(title) + (subtitle ? "<br><i>" + esc(subtitle) + "</i>" : ""),
            position: ct,
            shape: points.map(p => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 })),
            shapeY: Number(it.y) || 64, lineWidth: 3,
            lineColor: { r: c.r, g: c.g, b: c.b, a: 1 },
            fillColor: { r: c.r, g: c.g, b: c.b, a: it.fill != null ? Number(it.fill) : 0.25 },
            depthTest: false, listed: true
          };
        } else if (it.type === "text") {
          if (points.length < 1) continue;
          const p = points[0], title = String(it.title || ""), subtitle = String(it.subtitle || "");
          const marker = {
            type: "html", label: title.trim() || subtitle.trim() || "Text",
            position: { x: Number(p.x) || 0, y: Number(it.y) || 64, z: Number(p.z) || 0 },
            anchor: { x: 0, y: 0 },
            html: '<div class="xyn-label" style="color:' + safeHex(it.color) + '"><div class="xyn-title">' + esc(title) + '</div>' +
              (subtitle ? '<div class="xyn-sub">' + esc(subtitle) + '</div>' : "") + "</div>",
            classes: ["xyn-text-marker"], listed: true,
            minDistance: Math.max(0, Number(it.minDist) || 0)
          };
          if (Number(it.maxDist) > 0) marker.maxDistance = Number(it.maxDist);
          sets.labels.markers[it.id] = marker;
        } else if (it.type === "fairway") {
          const shape = fairwayShape(it);
          if (shape.length >= 3) {
            const c = hex2rgb(safeHex(it.color, "#00bfff"));
            const y = Number(it.y) || 64;
            const center = bboxCenter(shape.map(p => ({ x: Number(p.x) || 0, y, z: Number(p.z) || 0 })));
            const title = String(it.title || ""), subtitle = String(it.subtitle || "");
            sets.fairways.markers[it.id] = {
              type: "shape", label: title.trim() || "Fairway",
              detail: esc(title) + (subtitle ? "<br><i>" + esc(subtitle) + "</i>" : ""),
              position: center,
              shape: shape.map(p => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 })),
              shapeY: y, lineWidth: 2,
              lineColor: { r: c.r, g: c.g, b: c.b, a: 1 },
              fillColor: { r: c.r, g: c.g, b: c.b, a: Math.max(0, Math.min(1, Number(it.fill ?? 0.25))) },
              depthTest: false, listed: true
            };
          }
        } else if (isRoute(it.type)) {
          if (points.length < 2) continue;
          const route = ROUTE_TYPES[it.type];
          const line = points.map(p => ({ x: Number(p.x) || 0, y: heightAt(p, it), z: Number(p.z) || 0 }));
          const c = hex2rgb(safeHex(it.color, route.color));
          const title = String(it.title || ""), subtitle = String(it.subtitle || "");
          const marker = {
            type: "line", label: title.trim() || route.name,
            detail: esc(title) + (subtitle ? "<br><i>" + esc(subtitle) + "</i>" : ""),
            position: bboxCenter(line), line,
            lineWidth: Math.min(30, Math.max(1, Math.round(Number(it.lineWidth) || route.width))),
            lineColor: { r: c.r, g: c.g, b: c.b, a: 1 },
            depthTest: false, listed: true,
            minDistance: Math.max(0, Number(it.minDist) || 0)
          };
          if (Number(it.maxDist) > 0) marker.maxDistance = Number(it.maxDist);
          sets[route.setId].markers[it.id] = marker;
        }

        if (isWaypointType(it.type)) {
          points.forEach((p, index) => {
            const name = String(p.name || "").trim();
            if (!name) return;
            const y = isRoute(it.type) ? heightAt(p, it) : Number(it.y) || 64;
            const id = String(p.id || index).replace(/[^a-zA-Z0-9_-]/g, "_");
            const html = '<span style="display:inline-block;transform:translate(-50%,-100%);' +
              'white-space:nowrap;color:white;background:#123b50df;border:1px solid #85c5e0;' +
              'border-radius:5px;padding:3px 6px;font:12px system-ui,sans-serif;' +
              'text-shadow:0 1px 2px #000;pointer-events:none">' +
              '<span style="color:#a9e3ff">●</span> ' + esc(name) + '</span>';
            const markerId = it.type === "fairway" && it.geometry !== "polygon" && p.nodeId
              ? "shared-wp-" + String(p.nodeId).replace(/[^a-zA-Z0-9_-]/g, "_")
              : String(it.id) + "-wp-" + id;
            sets.waypoints.markers[markerId] = {
              type: "html", label: name,
              position: { x: Number(p.x) || 0, y, z: Number(p.z) || 0 },
              anchor: { x: 0, y: 0 }, html, classes: [],
              listed: true, minDistance: 0
            };
          });
        }
      }
      return sets;
    }
    function preview() {
      const root = bm.mapViewer && bm.mapViewer.markers;
      if (!root || typeof root.updateMarkerSetFromData !== "function") return;
      const sets = buildData();
      try {
        for (const id of TOOL_SETS) {
          if (Object.keys(sets[id].markers).length) {
            root.updateMarkerSetFromData(id, sets[id]);
          } else {
            const emptySet = root.markerSets && root.markerSets.get(id);
            if (emptySet) root.remove(emptySet);
          }
        }
      } catch (e) { console.warn("preview", e); }
    }

    // ---- SVG vertex overlay ----
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.id = "xynSvg";
    Object.assign(svg.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 9998 });
    document.body.appendChild(svg);
    let branchHover = null;
    const screenNode = (x, y) => network?.findScreenNode(model.items, x, y,
      (point, item) => worldToScreen(point.x, point.z, item.y));
    function drawOverlay() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (mode === "branch") {
        // Show candidates in every corridor, even when another marker is selected.
        for (const item of model.items) {
          if (!network?.corridor(item)) continue;
          item.points.forEach((point, index) => {
            const screen = worldToScreen(point.x, point.z, item.y);
            if (!screen.vis) return;
            const highlighted = branchHover?.item === item && branchHover.index === index;
            const circle = document.createElementNS(NS, "circle");
            circle.setAttribute("cx", screen.x);
            circle.setAttribute("cy", screen.y);
            circle.setAttribute("r", highlighted ? 10 : 7);
            circle.setAttribute("fill", highlighted ? "#fff1a4" : point.nodeId ? "#ffd166" : "#23d5e9");
            circle.setAttribute("stroke", "#14304a");
            circle.setAttribute("stroke-width", "2.5");
            svg.appendChild(circle);
          });
        }
        return;
      }
      if (!sel || mode === "idle") return;
      const scr = sel.points.map((p) => worldToScreen(p.x, p.z, isRoute(sel.type) ? heightAt(p, sel) : sel.y));
      if ((sel.type === "area" || isWaypointType(sel.type)) && scr.length > 1) {
        const poly = document.createElementNS(NS, mode === "edit" && !isOpenLine(sel) ? "polygon" : "polyline");
        poly.setAttribute("points", scr.map((s) => s.x + "," + s.y).join(" "));
        poly.setAttribute("fill", "none"); poly.setAttribute("stroke", "#fff");
        poly.setAttribute("stroke-dasharray", "5 4"); poly.setAttribute("stroke-width", "1.5");
        svg.appendChild(poly);
      }
      scr.forEach((s, i) => {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", s.x); c.setAttribute("cy", s.y); c.setAttribute("r", i === dragIdx ? 8 : 6);
        c.setAttribute("fill", sel.points[i].nodeId ? "#ffd166" : sel.color); c.setAttribute("stroke", "#000"); c.setAttribute("stroke-width", "2");
        svg.appendChild(c);
      });
    }
    (function loop() { drawOverlay(); requestAnimationFrame(loop); })();

    // ---- hover tooltip ----
    function pointInPoly(px, py, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    }
    function onHover(e) {
      if (mode !== "idle") { tip.style.display = "none"; return; }
      let hit = null;
      for (let k = model.items.length - 1; k >= 0; k--) {
        const it = model.items[k];
        if (!["area", "fairway"].includes(it.type) ||
            (!String(it.title || "").trim() && !String(it.subtitle || "").trim())) continue;
        const polygon = it.type === "fairway" ? fairwayShape(it) : it.points;
        if (polygon.length < 3) continue;
        const scr = polygon.map((p) => worldToScreen(p.x, p.z, it.y));
        if (pointInPoly(e.clientX, e.clientY, scr)) { hit = it; break; }
      }
      if (hit) {
        tip.querySelector(".t").textContent = hit.title || "";
        tip.querySelector(".t").style.display = String(hit.title || "").trim() ? "" : "none";
        tip.querySelector(".s").textContent = hit.subtitle || "";
        tip.querySelector(".s").style.display = hit.subtitle ? "" : "none";
        tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; tip.style.display = "block";
      } else tip.style.display = "none";
    }

    // ---- canvas pointer handling ----
    let downXY = null;
    let dragStart = null, dragDirty = false, dragRejected = false;
    function nearestVertex(cx, cy) {
      if (!sel) return -1;
      let best = -1, bd = 12;
      sel.points.forEach((p, i) => { const s = worldToScreen(p.x, p.z, isRoute(sel.type) ? heightAt(p, sel) : sel.y); const d = Math.hypot(s.x - cx, s.y - cy); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function onDown(e) {
      if (e.button !== 0 || mode === "idle") return;
      downXY = { x: e.clientX, y: e.clientY };
      if (mode === "branch") {
        if (screenNode(e.clientX, e.clientY)) {
          e.stopPropagation(); e.preventDefault();
        }
        return;
      }
      if (mode === "edit") {
        const vi = nearestVertex(e.clientX, e.clientY);
        if (vi >= 0) {
          dragIdx = vi;
          const point = sel.points[vi];
          dragStart = { x: point.x, z: point.z };
          dragDirty = false; dragRejected = false;
          e.stopPropagation(); e.preventDefault();
        }
      }
    }
    function onMove(e) {
      if (mode === "branch") {
        branchHover = screenNode(e.clientX, e.clientY);
        return;
      }
      if (dragIdx >= 0 && sel) {
        e.stopPropagation();
        if (dragRejected) return;
        const old = sel.points[dragIdx];
        const y = isRoute(sel.type) ? heightAt(old, sel) : sel.y;
        const pos = screenToWorld(e.clientX, e.clientY, y);
        if (sel.type === "fairway" && sel.geometry !== "polygon" && network) {
          if (!network.moveNode(model.items, old, pos.x, pos.z)) {
            // An invalid drag cancels the entire gesture, including previously
            // valid intermediate positions; never persist a partial movement.
            if (dragDirty && dragStart) network.moveNode(model.items, old, dragStart.x, dragStart.z);
            dragDirty = false;
            dragRejected = true;
            preview();
            msg("Junction movement rejected: another Fairway would become invalid");
            return;
          }
        } else {
          // Preserve waypoint IDs, names and altitude in non-network markers.
          sel.points[dragIdx] = { ...old, x: pos.x, z: pos.z };
        }
        dragDirty = true;
        preview();
      }
    }
    function onUp(e) {
      if (dragIdx >= 0) {
        dragIdx = -1;
        if (dragDirty && !dragRejected) persist();
        dragStart = null; dragDirty = false; dragRejected = false;
        refresh(); e.stopPropagation(); downXY = null; return;
      }
      if (!downXY || e.button !== 0 || mode === "idle") { downXY = null; return; }
      const moved = Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y); downXY = null;
      if (moved > 6 || e.target !== getCanvas()) return;
      if (mode === "branch") {
        const selected = screenNode(e.clientX, e.clientY);
        if (!selected) return;
        e.stopPropagation(); e.preventDefault();
        const branch = network.createBranch(model.items, selected.item, selected.index, uid);
        if (!branch) return;
        sel = branch; mode = "draw"; branchHover = null;
        persist(); preview(); refresh();
        msg("Branch started — click the map to add points; click another node to connect.");
        return;
      }
      if (!sel) return;
      if (mode === "draw") {
        if (sel.type === "text") { sel.points = [screenToWorld(e.clientX, e.clientY, sel.y)]; mode = "idle"; }
        else {
          const pos = screenToWorld(e.clientX, e.clientY, sel.y);
          const point = isRoute(sel.type) ? { ...pos, y: sel.y } : pos;
          if (sel.type === "fairway" && sel.geometry !== "polygon" && network) {
            const nearby = network.findNearbyNode(model.items, sel, e.clientX, e.clientY,
              (p, item) => worldToScreen(p.x, p.z, item.y), pos);
            if (nearby) {
              if (!network.connectPoint(model.items, sel, nearby, uid))
                msg("Connection rejected: duplicate node or invalid corridor");
            }
            else sel.points.push({ ...point, id: uid(), name: "" });
          } else sel.points.push(isWaypointType(sel.type) ? { ...point, id: uid(), name: "" } : point);
        }
      } else if (mode === "edit" && (sel.type === "area" || isWaypointType(sel.type))) insertVertexNear(e.clientX, e.clientY);
      persist(); preview(); refresh();
    }
    function insertVertexNear(cx, cy) {
      if (sel.points.length < 2) return;
      let bestI = -1, bd = isOpenLine(sel) ? 24 : Infinity;
      const segments = isOpenLine(sel) ? sel.points.length - 1 : sel.points.length;
      for (let i = 0; i < segments; i++) {
        const p0 = sel.points[i], p1 = sel.points[(i + 1) % sel.points.length];
        const a = worldToScreen(p0.x, p0.z, isRoute(sel.type) ? heightAt(p0, sel) : sel.y);
        const b = worldToScreen(p1.x, p1.z, isRoute(sel.type) ? heightAt(p1, sel) : sel.y);
        const d = distToSeg(cx, cy, a.x, a.y, b.x, b.y);
        if (d < bd) { bd = d; bestI = i; }
      }
      if (bestI < 0) return;
      const p0 = sel.points[bestI], p1 = sel.points[(bestI + 1) % sel.points.length];
      const midY = isRoute(sel.type) ? Math.round((heightAt(p0, sel) + heightAt(p1, sel)) / 2) : sel.y;
      const pos = screenToWorld(cx, cy, midY);
      const point = isRoute(sel.type) ? { x: pos.x, y: midY, z: pos.z } : pos;
      sel.points.splice(bestI + 1, 0, isWaypointType(sel.type) ? { ...point, id: uid(), name: "" } : point);
    }
    function distToSeg(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
    (function bind() {
      const cv = getCanvas();
      cv.addEventListener("pointerdown", onDown, true);
      cv.addEventListener("pointermove", onMove, true);
      cv.addEventListener("pointerup", onUp, true);
      cv.addEventListener("pointermove", onHover, false);
      cv.addEventListener("dblclick", (e) => {
        if (mode !== "edit" || !sel || (sel.type !== "area" && !isWaypointType(sel.type))) return;
        const vi = nearestVertex(e.clientX, e.clientY);
        const minimum = isOpenLine(sel) ? 2 : 3;
        if (vi >= 0 && sel.points.length > minimum) { sel.points.splice(vi, 1); persist(); preview(); refresh(); e.stopPropagation(); e.preventDefault(); }
      }, true);
    })();

    // Space+Tab toggles the editor panel
    let spaceHeld = false;
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.target.matches("input,textarea")) spaceHeld = true;
      if (e.code === "Tab" && spaceHeld) {
        e.preventDefault();
        P.style.display = P.style.display === "none" ? "" : "none";
      }
    });
    document.addEventListener("keyup", (e) => { if (e.code === "Space") spaceHeld = false; });

    // ---- UI panel ----
    const P = document.createElement("div");
    P.id = "xynPanel";
    Object.assign(P.style, {
      position: "fixed", top: "70px", left: "12px", zIndex: 9999, width: "280px",
      background: "rgba(18,20,24,.95)", color: "#eee", font: "13px system-ui,sans-serif",
      padding: "10px 12px", borderRadius: "10px", boxShadow: "0 6px 24px rgba(0,0,0,.5)",
      display: "none"  // hidden until unlocked
    });
    ["keydown", "keyup", "keypress"].forEach((ev) => P.addEventListener(ev, (e) => e.stopPropagation()));
    document.body.appendChild(P);
    const $ = (id) => P.querySelector("#" + id);

    function newItem(type) {
      const route = ROUTE_TYPES[type];
      const isFairway = type === "fairway";
      const label = route ? "New " + route.name : isFairway ? "New Fairway" : type === "area" ? "New Area" : "New Label";
      const it = {
        id: uid(), type, title: label, subtitle: "",
        color: route ? route.color : isFairway ? "#00bfff" : type === "area" ? "#4caf50" : "#ffffff",
        y: route ? route.defaultY : isFairway ? 64 : 64, points: []
      };
      if (type === "area" || isFairway) it.fill = 0.25;
      if (type === "text" || route) { it.minDist = 0; it.maxDist = 0; }
      if (route) it.lineWidth = route.width;
      if (isFairway) { it.geometry = "corridor"; it.width = 40; }
      model.items.push(it);
      sel = it; mode = "draw";
      persist(); preview(); refresh();
    }

    function routePointEditorHtml(item) {
      if (!isWaypointType(item.type)) return "";
      const route = ROUTE_TYPES[item.type];
      let options = "";
      if (route) {
        const width = Math.max(1, Math.min(30, Number(item.lineWidth) || route.width));
        options = '<label>Line width (px) <input id="xWidth" type="number" min="1" max="30" step="1" value="' + width +
          '" style="width:65px;background:#111;color:#eee;border:1px solid #444;padding:3px"></label>';
      } else {
        const corridor = item.geometry !== "polygon";
        options = '<label>Fairway shape <select id="xGeometry" style="background:#111;color:#eee;border:1px solid #444;padding:3px">' +
          '<option value="corridor"' + (corridor ? " selected" : "") + '>Centerline + width</option>' +
          '<option value="polygon"' + (!corridor ? " selected" : "") + '>Polygon</option></select></label>' +
          (corridor ? '<label style="display:block;margin-top:5px">Width (blocks) <input id="xFairwayWidth" type="number" min="1" step="1" value="' +
            (Number(item.width) || 40) +
            '" style="width:75px;background:#111;color:#eee;border:1px solid #444;padding:3px"></label>' : "");
      }
      const points = item.points.map((p, idx) => {
        let html = '<div style="border-bottom:1px solid #333;padding:4px 0">';
        html += '<div style="display:flex;align-items:center;gap:3px"><span style="width:18px;color:#9ab">' + (idx + 1) + '</span>';
        for (const axis of (route ? ["x", "y", "z"] : ["x", "z"])) {
          const val = axis === "y" ? heightAt(p, item) : Number(p[axis]) || 0;
          html += '<label style="font-size:10px;min-width:0;flex:1">' + axis.toUpperCase() +
            '<input data-route-idx="' + idx + '" data-route-axis="' + axis +
            '" type="number" step="1" value="' + val +
            '" style="width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:3px"></label>';
        }
        html += '<button data-route-up="' + idx + '" title="Move waypoint up">↑</button>';
        html += '<button data-route-down="' + idx + '" title="Move waypoint down">↓</button>';
        html += '<button data-route-del="' + idx + '" title="Delete waypoint">×</button>';
        if (item.type === "fairway" && item.geometry !== "polygon") {
          html += '<button data-route-branch="' + idx + '" title="Draw a branch from this waypoint">Branch</button>';
          if (p.nodeId) html += '<span title="Shared junction" style="color:#ffd166">●</span>';
        }
        html += "</div>";
        html += '<label style="display:block;margin:4px 0 0 18px;font-size:11px;color:#9ab">Name ' +
          '<input data-route-name="' + idx + '" placeholder="Optional waypoint name" value="' +
          escAttr(p.name || "") +
          '" style="width:75%;background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:3px"></label>';
        return html + "</div>";
      }).join("");
      return '<div style="border-top:1px solid #333;padding-top:6px;margin-bottom:7px">' +
        options +
        '<div style="font-size:11px;color:#9ab;margin-top:6px">Waypoints (' +
        (route ? "X / Y / Z" : "X / Z") + '). Order defines the path.</div>' +
        '<div style="max-height:180px;overflow:auto">' + points + '</div>' +
        (item.type === "fairway" && item.geometry !== "polygon" && item.points.length >= 2 && !fairwayShape(item).length ?
          '<div style="color:#f99;font-size:11px">Invalid corridor shape: simplify the bend or use Polygon.</div>' : "") +
        '</div>';
    }

    function refresh() {
      P.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <b>✏️ Marker Editor</b><span id="xMin" style="cursor:pointer;color:#9cf" title="Minimise">▁</span>
        </div>
        <div id="xBody">
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button id="xNewArea" style="flex:1;background:#396;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer">▰ New Area</button>
            <button id="xNewText" style="flex:1;background:#37c;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer">T New Text</button>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button id="xNewRoad" style="flex:1;background:#8a5a20;color:#fff;border:0;border-radius:6px;padding:7px 2px;cursor:pointer">Road</button>
            <button id="xNewSea" style="flex:1;background:#136bac;color:#fff;border:0;border-radius:6px;padding:7px 2px;cursor:pointer">Sea Route</button>
            <button id="xNewAir" style="flex:1;background:#764aad;color:#fff;border:0;border-radius:6px;padding:7px 2px;cursor:pointer">Air Route</button>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button id="xNewFairway" style="flex:1;background:#067e92;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer">▱ New Fairway</button>
            <button id="xBranchMap" style="flex:1;background:${mode === "branch" ? "#b78323" : "#43535e"};color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer" title="Click any visible centerline waypoint on the map to start a branch">↳ Branch on map</button>
          </div>
          ${mode === "branch" ? '<div style="font-size:11px;color:#ffd166;margin-bottom:7px">Select a highlighted Fairway waypoint on the map (or click Branch on map again to cancel).</div>' : ""}
          <div id="xEdit"></div>
          <div style="font-size:12px;margin:6px 0 3px;color:#9ab">Markers</div>
          <div id="xList" style="max-height:150px;overflow:auto;font-size:12px"></div>
          <button id="xGraphExport" style="width:100%;margin-top:5px;background:#345;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer">Copy Fairway Graph JSON</button>
          <button id="xExport" style="width:100%;margin-top:8px;background:#456;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer">📋 Copy BlueMap config</button>
          <div id="xMsg" style="font-size:11px;color:#9cf;min-height:14px;margin-top:5px"></div>
        </div>`;
      $("xMin").onclick = () => { const b = $("xBody"); b.style.display = b.style.display === "none" ? "" : "none"; };
      $("xNewArea").onclick = () => newItem("area");
      $("xNewText").onclick = () => newItem("text");
      $("xNewRoad").onclick = () => newItem("road");
      $("xNewSea").onclick = () => newItem("sea");
      $("xNewAir").onclick = () => newItem("air");
      $("xNewFairway").onclick = () => newItem("fairway");
      $("xBranchMap").onclick = () => {
        mode = mode === "branch" ? "idle" : "branch";
        branchHover = null;
        refresh();
      };
      $("xExport").onclick = exportConfig;
      $("xGraphExport").onclick = () => {
        if (!network) return msg("Network helper is unavailable");
        navigator.clipboard.writeText(JSON.stringify(network.buildGraph(model.items), null, 2))
          .then(() => msg("Graph copied ✓"), () => msg("Graph copy failed"));
      };

      const E = $("xEdit");
      if (sel) {
        const isArea = sel.type === "area";
        const isFairway = sel.type === "fairway";
        E.innerHTML = `
          <div style="border:1px solid #333;border-radius:8px;padding:8px;margin-bottom:6px">
            <div style="font-size:11px;color:#9ab;margin-bottom:4px">${isArea ? "AREA" : isFairway ? "FAIRWAY" : isRoute(sel.type) ? ROUTE_TYPES[sel.type].name.toUpperCase() : "TEXT"}</div>
            <input id="xTitle" placeholder="Title (e.g. Xynovia)" value="${escAttr(sel.title || "")}" style="width:100%;box-sizing:border-box;margin-bottom:5px;background:#111;color:#eee;border:1px solid #444;border-radius:5px;padding:6px">
            <input id="xSub" placeholder="Subtitle (e.g. Claimed by Xywren)" value="${escAttr(sel.subtitle || "")}" style="width:100%;box-sizing:border-box;margin-bottom:6px;background:#111;color:#eee;border:1px solid #444;border-radius:5px;padding:6px">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
              <label>${isArea || isFairway ? "Colour" : isRoute(sel.type) ? "Line" : "Text"} <input id="xColor" type="color" value="${sel.color}" style="vertical-align:middle"></label>
              <label style="flex:1">${isRoute(sel.type) ? "Next Y" : "Y"} <input id="xY" type="number" value="${sel.y}" style="width:56px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:3px"></label>
            </div>
            ${isArea || isFairway ? `<label style="display:block;margin-bottom:6px">Fill <input id="xFill" type="range" min="0" max="0.8" step="0.05" value="${sel.fill}" style="vertical-align:middle;width:130px"></label>` : `
            <div style="border-top:1px solid #333;padding-top:6px;margin-bottom:6px">
              <div style="font-size:11px;color:#9ab;margin-bottom:4px">Show only when zoomed out past (blocks). Current: <b id="xDist">–</b></div>
              <label style="display:block;margin-bottom:4px">Min dist <input id="xMinD" type="number" value="${sel.minDist || 0}" style="width:80px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:3px"> <button id="xSetMin" style="background:#444;color:#fff;border:0;border-radius:4px;padding:3px 6px;cursor:pointer">use current</button></label>
              <label style="display:block">Max dist <input id="xMaxD" type="number" value="${sel.maxDist || 0}" style="width:80px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:3px"> <span style="color:#889;font-size:11px">(0 = no limit)</span></label>
            </div>`}
            ${routePointEditorHtml(sel)}
            <div style="display:flex;gap:6px">
              <button id="xDraw" style="flex:1;border:0;border-radius:5px;padding:6px;cursor:pointer;background:${mode === "draw" ? "#396" : "#444"};color:#fff">${isArea ? "✚ Draw" : isWaypointType(sel.type) ? "✚ Points" : "✚ Place"}</button>
              <button id="xEditM" style="flex:1;border:0;border-radius:5px;padding:6px;cursor:pointer;background:${mode === "edit" ? "#396" : "#444"};color:#fff">${isArea ? "✎ Edit" : isWaypointType(sel.type) ? "✎ Path" : "✎ Move"}</button>
              <button id="xDone" style="flex:1;border:0;border-radius:5px;padding:6px;cursor:pointer;background:#444;color:#fff">✓ Done</button>
            </div>
            <div style="font-size:11px;color:#889;margin-top:5px">${sel.points.length} point${sel.points.length === 1 ? "" : "s"}${mode === "draw" ? (isArea ? " · click map to add corners" : isWaypointType(sel.type) ? " · click map to add waypoints" : " · click map to place") : mode === "edit" ? (isArea || isWaypointType(sel.type) ? " · drag/insert · dbl-click to delete" : " · drag to move") : ""}</div>
          </div>`;
        const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
        on("xTitle", "oninput", (e) => { sel.title = e.target.value; persist(); preview(); renderList(); });
        on("xSub", "oninput", (e) => { sel.subtitle = e.target.value; persist(); preview(); });
        on("xColor", "oninput", (e) => { sel.color = e.target.value; persist(); preview(); renderList(); });
        on("xY", "onchange", (e) => { sel.y = parseInt(e.target.value) || 64; persist(); preview(); });
        on("xFill", "oninput", (e) => { sel.fill = parseFloat(e.target.value); persist(); preview(); });
        on("xMinD", "onchange", (e) => { sel.minDist = parseInt(e.target.value) || 0; persist(); preview(); });
        on("xMaxD", "onchange", (e) => { sel.maxDist = parseInt(e.target.value) || 0; persist(); preview(); });
        on("xSetMin", "onclick", () => { sel.minDist = viewDistance(); persist(); preview(); refresh(); });
        if (isFairway) {
          on("xGeometry", "onchange", (e) => {
            const newGeometry = e.target.value === "polygon" ? "polygon" : "corridor";
            if (newGeometry === "polygon" && sel.geometry !== "polygon" && network)
              network.detachPolygon(sel);
            sel.geometry = newGeometry;
            persist(); preview(); refresh();
          });
          on("xFairwayWidth", "onchange", (e) => {
            const value = Number(e.target.value);
            if (!Number.isFinite(value) || value <= 0) return;
            sel.width = Math.min(4096, Math.max(1, value));
            persist(); preview(); refresh();
          });
        }
        if (isWaypointType(sel.type)) {
          on("xWidth", "onchange", (e) => {
            if (!isRoute(sel.type)) return;
            sel.lineWidth = Math.max(1, Math.min(30, Math.round(Number(e.target.value) || ROUTE_TYPES[sel.type].width)));
            e.target.value = sel.lineWidth;
            persist(); preview();
          });
          E.querySelectorAll("[data-route-axis]").forEach((input) => {
            input.onchange = () => {
              const idx = Number(input.dataset.routeIdx);
              const axis = input.dataset.routeAxis;
              if (!sel.points[idx] || !["x", "y", "z"].includes(axis)) return;
              const n = Number(input.value);
              if (!Number.isFinite(n)) return;
              const point = sel.points[idx];
              if ((axis === "x" || axis === "z") &&
                  sel.type === "fairway" && sel.geometry !== "polygon" && network) {
                const x = axis === "x" ? n : Number(point.x);
                const z = axis === "z" ? n : Number(point.z);
                if (!network.moveNode(model.items, point, x, z)) {
                  input.value = point[axis];
                  msg("Junction movement rejected: another Fairway would become invalid");
                  return;
                }
              } else point[axis] = n;
              persist(); preview();
            };
          });
          E.querySelectorAll("[data-route-name]").forEach((input) => {
            input.onchange = () => {
              const idx = Number(input.dataset.routeName);
              const point = sel.points[idx];
              if (!point) return;
              if (!point.id) point.id = uid();
              point.name = input.value;
              if (sel.type === "fairway" && network) network.propagate(model.items, point);
              persist(); preview();
            };
          });
          if (sel.type === "fairway" && sel.geometry !== "polygon" && network) {
            E.querySelectorAll("[data-route-branch]").forEach((btn) => {
              btn.onclick = () => {
                const index = Number(btn.dataset.routeBranch);
                const branch = network.createBranch(model.items, sel, index, uid);
                if (!branch) return;
                sel = branch; mode = "draw";
                persist(); preview(); refresh();
                msg("Click map to continue branch; click near a waypoint to connect.");
              };
            });
          }
          for (const action of ["up", "down", "del"]) {
            E.querySelectorAll("[data-route-" + action + "]").forEach((btn) => {
              btn.onclick = () => {
                const i = Number(btn.dataset["route" + action[0].toUpperCase() + action.slice(1)]);
                if (!Number.isInteger(i) || !sel.points[i]) return;
                if (action === "del") {
                  const minimum = isOpenLine(sel) ? 2 : 3;
                  if (sel.points.length <= minimum) return;
                  sel.points.splice(i, 1);
                }
                else {
                  const j = i + (action === "up" ? -1 : 1);
                  if (j < 0 || j >= sel.points.length) return;
                  [sel.points[i], sel.points[j]] = [sel.points[j], sel.points[i]];
                }
                persist(); preview(); refresh();
              };
            });
          }
        }

        on("xDraw", "onclick", () => { mode = "draw"; refresh(); });
        on("xEditM", "onclick", () => { mode = "edit"; refresh(); });
        on("xDone", "onclick", () => { mode = "idle"; refresh(); });
        if (!isArea) { const d = $("xDist"); if (d) { const upd = () => { if (!document.body.contains(d)) return; d.textContent = viewDistance(); requestAnimationFrame(upd); }; upd(); } }
      } else E.innerHTML = "";
      renderList();
    }
    function renderList() {
      const L = $("xList"); if (!L) return;
      L.innerHTML = model.items.map((it) =>
        `<div data-id="${it.id}" style="display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;cursor:pointer;background:${sel && sel.id === it.id ? "#2a3340" : "transparent"}">
          <span style="width:11px;height:11px;border-radius:${it.type === "area" ? "2px" : "50%"};background:${it.color};display:inline-block;border:1px solid #0006"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</span>
          <span style="color:#789;font-size:11px">${it.type === "area" ? "Area" : it.type === "fairway" ? "Fairway" : isRoute(it.type) ? ROUTE_TYPES[it.type].name : "Text"}</span>
          <span data-del="${it.id}" style="color:#f88;cursor:pointer">✕</span>
        </div>`).join("") || '<i style="color:#778">Nothing yet — add an Area, Text, or Route.</i>';
      L.querySelectorAll("[data-id]").forEach((el) => el.onclick = (ev) => {
        if (ev.target.dataset.del) return;
        sel = model.items.find((a) => a.id === el.dataset.id); mode = "idle"; refresh();
      });
      L.querySelectorAll("[data-del]").forEach((el) => el.onclick = () => {
        model.items = model.items.filter((a) => a.id !== el.dataset.del);
        if (sel && sel.id === el.dataset.del) sel = null;
        persist(); preview(); refresh();
      });
    }
    function msg(t) { const m = $("xMsg"); if (m) m.textContent = t; }

    function exportConfig() {
      const areas = model.items.filter((i) => i.type === "area");
      const texts = model.items.filter((i) => i.type === "text");
      let out = "marker-sets: {\n";
      if (areas.length) {
        out += `  areas: {\n    label: "Areas"\n    toggleable: true\n    markers: {\n`;
        areas.forEach((a) => {
          const c = hex2rgb(a.color); const ct = bboxCenter(a.points.map(p => ({ x: Number(p.x) || 0, y: Number(a.y) || 64, z: Number(p.z) || 0 }))); const id = slug(a.title) || a.id;
          const detail = esc(a.title) + (a.subtitle ? "<br>" + esc(a.subtitle) : "");
          out += `      ${id}: {\n        type: "shape"\n        label: "${a.title.replace(/"/g, '\\"')}"\n        detail: "${detail.replace(/"/g, '\\"')}"\n        position: { x: ${ct.x}, y: ${a.y}, z: ${ct.z} }\n        shape: [\n${a.points.map((p) => `          { x: ${p.x}, z: ${p.z} }`).join("\n")}\n        ]\n        shape-y: ${a.y}\n        line-width: 3\n        line-color: { r: ${c.r}, g: ${c.g}, b: ${c.b}, a: 1.0 }\n        fill-color: { r: ${c.r}, g: ${c.g}, b: ${c.b}, a: ${a.fill} }\n        depth-test: false\n      }\n`;
        });
        out += "    }\n  }\n";
      }
      if (texts.length) {
        out += `  labels: {\n    label: "Text Labels"\n    toggleable: true\n    markers: {\n`;
        texts.forEach((t) => {
          const p = t.points[0] || { x: 0, z: 0 }; const id = slug(t.title) || t.id;
          const html = `<div class=\\"xyn-label\\" style=\\"color:${t.color}\\"><div class=\\"xyn-title\\">${esc(t.title)}</div>${t.subtitle ? `<div class=\\"xyn-sub\\">${esc(t.subtitle)}</div>` : ""}</div>`;
          out += `      ${id}: {\n        type: "html"\n        label: "${t.title.replace(/"/g, '\\"')}"\n        position: { x: ${p.x}, y: ${t.y}, z: ${p.z} }\n        anchor: { x: 0, y: 0 }\n        html: "${html}"\n        min-distance: ${t.minDist || 0}\n${t.maxDist ? `        max-distance: ${t.maxDist}\n` : ""}      }\n`;
        });
        out += "    }\n  }\n";
      }
      for (const type of Object.keys(ROUTE_TYPES)) {
        const route = ROUTE_TYPES[type];
        const items = model.items.filter(i => i.type === type && Array.isArray(i.points) && i.points.length >= 2);
        if (!items.length) continue;
        out += "  " + route.setId + ": {\n    label: " + JSON.stringify(route.label) + "\n    toggleable: true\n    markers: {\n";
        for (const it of items) {
          const line = it.points.map(p => ({ x: Number(p.x) || 0, y: heightAt(p, it), z: Number(p.z) || 0 }));
          const pos = bboxCenter(line);
          const c = hex2rgb(safeHex(it.color, route.color));
          const detail = esc(it.title || "") + (it.subtitle ? "<br><i>" + esc(it.subtitle) + "</i>" : "");
          const width = Math.min(30, Math.max(1, Math.round(Number(it.lineWidth) || route.width)));
          out += "      " + JSON.stringify(it.id) + ": {\n" +
            "        type: \"line\"\n" +
            "        label: " + JSON.stringify(it.title || route.name) + "\n" +
            "        detail: " + JSON.stringify(detail) + "\n" +
            "        position: { x: " + pos.x + ", y: " + pos.y + ", z: " + pos.z + " }\n" +
            "        line: [\n" +
            line.map(p => "          { x: " + p.x + ", y: " + p.y + ", z: " + p.z + " }").join("\n") + "\n" +
            "        ]\n" +
            "        line-width: " + width + "\n" +
            "        line-color: { r: " + c.r + ", g: " + c.g + ", b: " + c.b + ", a: 1.0 }\n" +
            "        depth-test: false\n" +
            "        min-distance: " + Math.max(0, Number(it.minDist) || 0) + "\n" +
            (Number(it.maxDist) > 0 ? "        max-distance: " + Number(it.maxDist) + "\n" : "") +
            "      }\n";
        }
        out += "    }\n  }\n";
      }
      // Export the generated fairways and named waypoint labels using the
      // same marker data that BlueMap receives for live previews.
      const generated = buildData();
      for (const id of ["fairways", "waypoints"]) {
        const set = generated[id];
        const entries = Object.entries(set.markers);
        if (!entries.length) continue;
        out += "  " + id + ": {\n    label: " + JSON.stringify(set.label) +
          "\n    toggleable: true\n" +
          (set.defaultHidden ? "    default-hidden: true\n" : "") +
          "    markers: {\n";
        for (const [markerId, marker] of entries) {
          const p = marker.position;
          out += "      " + JSON.stringify(markerId) + ": {\n" +
              "        type: " + JSON.stringify(marker.type) + "\n" +
              "        label: " + JSON.stringify(marker.label) + "\n" +
              "        position: { x: " + p.x + ", y: " + p.y + ", z: " + p.z + " }\n";
          if (marker.type === "shape") {
            const c = marker.lineColor, fc = marker.fillColor;
            out += "        detail: " + JSON.stringify(marker.detail) + "\n" +
                "        shape: [\n" +
                marker.shape.map(pt => "          { x: " + pt.x + ", z: " + pt.z + " }").join("\n") + "\n" +
                "        ]\n        shape-y: " + marker.shapeY +
                "\n        line-width: " + marker.lineWidth +
                "\n        line-color: { r: " + c.r + ", g: " + c.g + ", b: " + c.b + ", a: " + c.a + " }" +
                "\n        fill-color: { r: " + fc.r + ", g: " + fc.g + ", b: " + fc.b + ", a: " + fc.a + " }" +
                "\n        depth-test: false\n";
          } else {
            out += "        anchor: { x: 0, y: 0 }\n" +
                "        html: " + JSON.stringify(marker.html) + "\n";
          }
          out += "      }\n";
        }
        out += "    }\n  }\n";
      }
      out += "}\n";
      navigator.clipboard.writeText(out).then(() => msg("Config copied ✓"), () => msg("Copy failed — see console"));
      console.log(out);
    }

    refresh();
    // The server owns the initial marker sets; preview begins only after marker JSON loads.
    console.log("XynMarkers v3 loaded. Press Shift+Alt+X to open the editor.");
  }
  boot();
})();
