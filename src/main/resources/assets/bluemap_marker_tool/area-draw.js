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
    const mfm = bm.markerFileManager;
    const Vec3 = mv.raycaster.ray.origin.constructor;
    const getCam = () => mv._camera || mv.camera;
    const getCanvas = () => mv.rootElement.querySelector("canvas");
    try { clearInterval(mfm._updateInterval); } catch (e) {}

    // ---- API config (read from xyn-config.json written by the mod) ----
    let API_URL = null; // set after config loads

    fetch("/xyn-config.json")
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (cfg && cfg.apiPort) {
          API_URL = "http://" + window.location.hostname + ":" + cfg.apiPort + "/xyn/markers";
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

    const labelLayer = document.createElement("div");
    labelLayer.id = "xynLabels";
    document.body.appendChild(labelLayer);
    const labelEls = {};


    // ---- model ----
    let model = { items: [] };
    let sel = null;
    let mode = "idle";
    let dragIdx = -1;

    function uid() { return "m" + Math.random().toString(36).slice(2, 8); }
    function slug(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
    function hex2rgb(h) { return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }; }
    function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

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
      return { x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top, vis: v.z < 1 };
    }
    function viewDistance() {
      const c = screenToWorld(innerWidth / 2, innerHeight / 2, 0);
      const cam = getCam();
      return Math.round(Math.hypot(cam.position.x - c.x, cam.position.y, cam.position.z - c.z));
    }

    // ---- BlueMap live preview ----
    function centroid(pts) {
      return { x: Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length), z: Math.round(pts.reduce((s, p) => s + p.z, 0) / pts.length) };
    }
    function buildData() {
      const sets = { areas: { label: "Areas", toggleable: true, defaultHidden: false, markers: {} } };
      model.items.forEach((it) => {
        if (it.type !== "area" || it.points.length < 2) return;
        const c = hex2rgb(it.color);
        const ct = centroid(it.points);
        sets.areas.markers[it.id] = {
          type: "shape", label: it.title,
          detail: `<b>${esc(it.title)}</b>` + (it.subtitle ? `<br>${esc(it.subtitle)}` : ""),
          position: { x: ct.x, y: it.y, z: ct.z },
          shape: it.points.map((p) => ({ x: p.x, z: p.z })),
          shapeY: it.y, lineWidth: 3,
          lineColor: { r: c.r, g: c.g, b: c.b, a: 1 },
          fillColor: { r: c.r, g: c.g, b: c.b, a: it.fill != null ? it.fill : 0.25 },
          depthTest: false, listed: true
        };
      });
      return sets;
    }
    function preview() { try { mfm.updateFromData(buildData()); } catch (e) { console.warn("preview", e); } }

    // ---- text label overlay ----
    function renderLabels() {
      const cam = getCam();
      const seen = {};
      model.items.forEach((it) => {
        if (it.type !== "text" || !it.points.length) return;
        seen[it.id] = 1;
        let el = labelEls[it.id];
        if (!el) { el = document.createElement("div"); el.className = "xyn-ovl"; labelLayer.appendChild(el); labelEls[it.id] = el; }
        const p = it.points[0];
        const dist = Math.hypot(cam.position.x - p.x, cam.position.y - it.y, cam.position.z - p.z);
        const min = it.minDist || 0, max = it.maxDist || 0;
        const visByZoom = dist >= min && (max === 0 || dist <= max);
        const s = worldToScreen(p.x, p.z, it.y);
        if (!s.vis || !visByZoom) { el.style.display = "none"; return; }
        el.style.display = "block"; el.style.left = s.x + "px"; el.style.top = s.y + "px";
        el.innerHTML = `<div class="xyn-label" style="color:${it.color}"><div class="xyn-title">${esc(it.title)}</div>${it.subtitle ? `<div class="xyn-sub">${esc(it.subtitle)}</div>` : ""}</div>`;
      });
      Object.keys(labelEls).forEach((id) => { if (!seen[id]) { labelEls[id].remove(); delete labelEls[id]; } });
    }

    // ---- SVG vertex overlay ----
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.id = "xynSvg";
    Object.assign(svg.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 9998 });
    document.body.appendChild(svg);
    function drawOverlay() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (!sel || mode === "idle") return;
      const scr = sel.points.map((p) => worldToScreen(p.x, p.z, sel.y));
      if (sel.type === "area" && scr.length > 1) {
        const poly = document.createElementNS(NS, mode === "edit" ? "polygon" : "polyline");
        poly.setAttribute("points", scr.map((s) => s.x + "," + s.y).join(" "));
        poly.setAttribute("fill", "none"); poly.setAttribute("stroke", "#fff");
        poly.setAttribute("stroke-dasharray", "5 4"); poly.setAttribute("stroke-width", "1.5");
        svg.appendChild(poly);
      }
      scr.forEach((s, i) => {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", s.x); c.setAttribute("cy", s.y); c.setAttribute("r", i === dragIdx ? 8 : 6);
        c.setAttribute("fill", sel.color); c.setAttribute("stroke", "#000"); c.setAttribute("stroke-width", "2");
        svg.appendChild(c);
      });
    }
    (function loop() { drawOverlay(); renderLabels(); requestAnimationFrame(loop); })();

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
        if (it.type !== "area" || it.points.length < 3) continue;
        const scr = it.points.map((p) => worldToScreen(p.x, p.z, it.y));
        if (pointInPoly(e.clientX, e.clientY, scr)) { hit = it; break; }
      }
      if (hit) {
        tip.querySelector(".t").textContent = hit.title;
        tip.querySelector(".s").textContent = hit.subtitle || "";
        tip.querySelector(".s").style.display = hit.subtitle ? "" : "none";
        tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; tip.style.display = "block";
      } else tip.style.display = "none";
    }

    // ---- canvas pointer handling ----
    let downXY = null;
    function nearestVertex(cx, cy) {
      if (!sel) return -1;
      let best = -1, bd = 12;
      sel.points.forEach((p, i) => { const s = worldToScreen(p.x, p.z, sel.y); const d = Math.hypot(s.x - cx, s.y - cy); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function onDown(e) {
      if (e.button !== 0 || mode === "idle") return;
      downXY = { x: e.clientX, y: e.clientY };
      if (mode === "edit") { const vi = nearestVertex(e.clientX, e.clientY); if (vi >= 0) { dragIdx = vi; e.stopPropagation(); e.preventDefault(); } }
    }
    function onMove(e) {
      if (dragIdx >= 0 && sel) { sel.points[dragIdx] = screenToWorld(e.clientX, e.clientY, sel.y); preview(); e.stopPropagation(); }
    }
    function onUp(e) {
      if (dragIdx >= 0) { dragIdx = -1; persist(); refresh(); e.stopPropagation(); downXY = null; return; }
      if (!downXY || e.button !== 0 || mode === "idle") { downXY = null; return; }
      const moved = Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y); downXY = null;
      if (moved > 6 || e.target !== getCanvas() || !sel) return;
      if (mode === "draw") {
        if (sel.type === "text") { sel.points = [screenToWorld(e.clientX, e.clientY, sel.y)]; mode = "idle"; }
        else sel.points.push(screenToWorld(e.clientX, e.clientY, sel.y));
      } else if (mode === "edit" && sel.type === "area") insertVertexNear(e.clientX, e.clientY);
      persist(); preview(); refresh();
    }
    function insertVertexNear(cx, cy) {
      if (sel.points.length < 2) { sel.points.push(screenToWorld(cx, cy, sel.y)); return; }
      let bestI = 0, bd = Infinity;
      for (let i = 0; i < sel.points.length; i++) {
        const a = worldToScreen(sel.points[i].x, sel.points[i].z, sel.y);
        const b = worldToScreen(sel.points[(i + 1) % sel.points.length].x, sel.points[(i + 1) % sel.points.length].z, sel.y);
        const d = distToSeg(cx, cy, a.x, a.y, b.x, b.y);
        if (d < bd) { bd = d; bestI = i; }
      }
      sel.points.splice(bestI + 1, 0, screenToWorld(cx, cy, sel.y));
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
        if (mode !== "edit" || !sel || sel.type !== "area") return;
        const vi = nearestVertex(e.clientX, e.clientY);
        if (vi >= 0) { sel.points.splice(vi, 1); persist(); preview(); refresh(); e.stopPropagation(); e.preventDefault(); }
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
      const it = {
        id: uid(), type, title: type === "area" ? "New Area" : "New Label", subtitle: "",
        color: type === "area" ? "#4caf50" : "#ffffff", y: 64, points: []
      };
      if (type === "area") it.fill = 0.25;
      else { it.minDist = 0; it.maxDist = 0; }
      model.items.push(it); sel = it; mode = "draw"; persist(); refresh();
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
          <div id="xEdit"></div>
          <div style="font-size:12px;margin:6px 0 3px;color:#9ab">Markers</div>
          <div id="xList" style="max-height:150px;overflow:auto;font-size:12px"></div>
          <button id="xExport" style="width:100%;margin-top:8px;background:#456;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer">📋 Copy BlueMap config</button>
          <div id="xMsg" style="font-size:11px;color:#9cf;min-height:14px;margin-top:5px"></div>
        </div>`;
      $("xMin").onclick = () => { const b = $("xBody"); b.style.display = b.style.display === "none" ? "" : "none"; };
      $("xNewArea").onclick = () => newItem("area");
      $("xNewText").onclick = () => newItem("text");
      $("xExport").onclick = exportConfig;

      const E = $("xEdit");
      if (sel) {
        const isArea = sel.type === "area";
        E.innerHTML = `
          <div style="border:1px solid #333;border-radius:8px;padding:8px;margin-bottom:6px">
            <div style="font-size:11px;color:#9ab;margin-bottom:4px">${isArea ? "AREA" : "TEXT"}</div>
            <input id="xTitle" placeholder="Title (e.g. Xynovia)" value="${(sel.title || "").replace(/"/g, "&quot;")}" style="width:100%;box-sizing:border-box;margin-bottom:5px;background:#111;color:#eee;border:1px solid #444;border-radius:5px;padding:6px">
            <input id="xSub" placeholder="Subtitle (e.g. Claimed by Xywren)" value="${(sel.subtitle || "").replace(/"/g, "&quot;")}" style="width:100%;box-sizing:border-box;margin-bottom:6px;background:#111;color:#eee;border:1px solid #444;border-radius:5px;padding:6px">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
              <label>${isArea ? "Colour" : "Text"} <input id="xColor" type="color" value="${sel.color}" style="vertical-align:middle"></label>
              <label style="flex:1">Y <input id="xY" type="number" value="${sel.y}" style="width:56px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:3px"></label>
            </div>
            ${isArea ? `<label style="display:block;margin-bottom:6px">Fill <input id="xFill" type="range" min="0" max="0.8" step="0.05" value="${sel.fill}" style="vertical-align:middle;width:130px"></label>` : `
            <div style="border-top:1px solid #333;padding-top:6px;margin-bottom:6px">
              <div style="font-size:11px;color:#9ab;margin-bottom:4px">Show only when zoomed out past (blocks). Current: <b id="xDist">–</b></div>
              <label style="display:block;margin-bottom:4px">Min dist <input id="xMinD" type="number" value="${sel.minDist || 0}" style="width:80px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:3px"> <button id="xSetMin" style="background:#444;color:#fff;border:0;border-radius:4px;padding:3px 6px;cursor:pointer">use current</button></label>
              <label style="display:block">Max dist <input id="xMaxD" type="number" value="${sel.maxDist || 0}" style="width:80px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:3px"> <span style="color:#889;font-size:11px">(0 = no limit)</span></label>
            </div>`}
            <div style="display:flex;gap:6px">
              <button id="xDraw" style="flex:1;border:0;border-radius:5px;padding:6px;cursor:pointer;background:${mode === "draw" ? "#396" : "#444"};color:#fff">${isArea ? "✚ Draw" : "✚ Place"}</button>
              <button id="xEditM" style="flex:1;border:0;border-radius:5px;padding:6px;cursor:pointer;background:${mode === "edit" ? "#396" : "#444"};color:#fff">${isArea ? "✎ Edit" : "✎ Move"}</button>
              <button id="xDone" style="flex:1;border:0;border-radius:5px;padding:6px;cursor:pointer;background:#444;color:#fff">✓ Done</button>
            </div>
            <div style="font-size:11px;color:#889;margin-top:5px">${sel.points.length} point${sel.points.length === 1 ? "" : "s"}${mode === "draw" ? (isArea ? " · click map to add corners" : " · click map to place") : mode === "edit" ? (isArea ? " · drag/insert · dbl-click to delete" : " · drag to move") : ""}</div>
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
          <span style="color:#789;font-size:11px">${it.type === "area" ? "Area" : "Text"}</span>
          <span data-del="${it.id}" style="color:#f88;cursor:pointer">✕</span>
        </div>`).join("") || '<i style="color:#778">Nothing yet — add an Area or Text.</i>';
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
          const c = hex2rgb(a.color); const ct = centroid(a.points); const id = slug(a.title) || a.id;
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
      out += "}\n";
      navigator.clipboard.writeText(out).then(() => msg("Config copied ✓"), () => msg("Copy failed — see console"));
      console.log(out);
    }

    refresh();
    preview();
    console.log("XynMarkers v3 loaded. Press Shift+Alt+X to open the editor.");
  }
  boot();
})();
