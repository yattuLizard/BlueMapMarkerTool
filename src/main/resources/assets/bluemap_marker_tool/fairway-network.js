/* Shared-node graph utilities for branching BlueMap fairway corridors. */
(function (root) {
  "use strict";

  // Resolve the helper when validating, not at script evaluation time. BlueMap
  // may load webapp scripts in a different order; caching a missing helper as
  // null would disable *all* Fairway moves and connections for that page.
  const getGeometry = () => root.XYNFairwayGeometry ||
    (typeof require === "function" ? require("./fairway-geometry.js") : null);
  const corridor = item => item?.type === "fairway" && item.geometry !== "polygon" && Array.isArray(item.points);

  function ensureNodeId(point, nextId) {
    if (!point.nodeId) point.nodeId = nextId();
    return point.nodeId;
  }

  // A polygon is an independent region, not a node in the centerline network.
  function detachPolygon(item) {
    if (item?.type !== "fairway" || !Array.isArray(item.points)) return 0;
    let detached = 0;
    for (const point of item.points) {
      if (Object.prototype.hasOwnProperty.call(point, "nodeId")) {
        delete point.nodeId;
        detached++;
      }
    }
    return detached;
  }

  function createBranch(items, item, index, nextId) {
    if (!corridor(item) || !item.points[index]) return null;
    const point = item.points[index], nodeId = ensureNodeId(point, nextId);
    const branch = {
      id: nextId(), type: "fairway", geometry: "corridor",
      title: "Branch of " + (item.title || "Fairway"), subtitle: "",
      color: item.color || "#00bfff", fill: item.fill ?? 0.25,
      width: item.width ?? 40, y: item.y ?? 64,
      points: [{ id: nextId(), nodeId, name: point.name || "", x: Number(point.x), z: Number(point.z) }]
    };
    items.push(branch);
    return branch;
  }

  function findNearbyNode(items, current, screenX, screenY, project, cursorWorld, radius = 14, worldLimit = 32) {
    if (!cursorWorld || !Number.isFinite(cursorWorld.x) || !Number.isFinite(cursorWorld.z)) return null;
    let best = null, distance = radius;
    for (const item of items) {
      if (!corridor(item) || item === current) continue;
      for (const point of item.points) {
        const loc = project(point, item);
        // Perspective projection alone can place behind-camera and off-screen
        // nodes close to a click. Both visibility and real-world reach are required.
        if (!loc || loc.vis !== true || !Number.isFinite(loc.x) || !Number.isFinite(loc.y)) continue;
        if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.z))) continue;
        if (Math.hypot(Number(point.x) - cursorWorld.x, Number(point.z) - cursorWorld.z) > worldLimit) continue;
        const delta = Math.hypot(screenX - loc.x, screenY - loc.y);
        if (delta <= distance) { best = point; distance = delta; }
      }
    }
    return best;
  }

  function connectPoint(items, target, other, nextId) {
    if (!corridor(target) || !other) return null;
    const x = Number(other.x), z = Number(other.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    // Reject *any* repeated junction or coordinate, not just a repeated endpoint.
    // In particular an A -> B -> A path must never erase an existing Fairway.
    if (target.points.some(point =>
      (other.nodeId && point.nodeId === other.nodeId) ||
      Math.hypot(Number(point.x) - x, Number(point.z) - z) < 1e-6
    )) return null;
    const tentative = [...target.points, { x, z }];
    // Validate BEFORE assigning IDs or pushing. Rejection is side-effect free.
    const geometry = getGeometry();
    if (tentative.length >= 2 &&
        (!geometry || !geometry.corridorPolygon(tentative, Number(target.width ?? 40)).length)) return null;
    const nodeId = ensureNodeId(other, nextId);
    const point = { id: nextId(), nodeId, name: other.name || "", x, z };
    target.points.push(point);
    return point;
  }

  // Plan changes in memory and validate *all* affected waterway polygons before
  // mutating a single waypoint. Both drag and numeric coordinate edits use this.
  function moveNode(items, source, x, z) {
    x = Number(x); z = Number(z);
    const geometry = getGeometry();
    if (!Number.isFinite(x) || !Number.isFinite(z) || !geometry) return false;
    if (!items.some(item => corridor(item) && item.points.includes(source))) return false;

    const updates = [];
    for (const item of items) {
      if (!corridor(item)) continue;
      const affected = item.points.filter(point =>
        point === source || (source.nodeId && point.nodeId === source.nodeId));
      if (!affected.length) continue;
      const proposed = item.points.map(point => affected.includes(point)
        ? { ...point, x, z } : point);
      if (proposed.length >= 2 &&
          !geometry.corridorPolygon(proposed, Number(item.width ?? 40)).length) return false;
      updates.push(...affected);
    }
    // No geometry or shared coordinate is modified until every check passes.
    for (const point of updates) { point.x = x; point.z = z; }
    return true;
  }

  // Names are independent of geometry. Coordinates must go through moveNode().
  function propagate(items, source) {
    // Ignore stale nodeIds on legacy polygon entries as well as detached nodes.
    if (!source?.nodeId || !items.some(item => corridor(item) && item.points.includes(source))) return 0;
    let changes = 0;
    for (const item of items) {
      if (!corridor(item)) continue;
      for (const point of item.points) {
        if (point === source || point.nodeId !== source.nodeId) continue;
        point.name = String(source.name || "");
        changes++;
      }
    }
    return changes;
  }

  // Normalized graph view. Legacy point IDs stay local until explicitly linked.
  function buildGraph(items) {
    const nodes = new Map(), edges = [];
    for (const item of items) {
      if (!corridor(item)) continue;
      const ids = item.points.map((point, index) => {
        const id = point.nodeId || "local:" + item.id + ":" + (point.id || index);
        if (!nodes.has(id)) nodes.set(id, {
          id, name: point.name || "", x: Number(point.x), z: Number(point.z)
        });
        return id;
      });
      for (let i = 1; i < ids.length; i++) {
        if (ids[i - 1] === ids[i]) continue;
        edges.push({
          id: item.id + ":" + (i - 1), from: ids[i - 1], to: ids[i],
          fairwayId: item.id, width: Number(item.width) || 40
        });
      }
    }
    return { nodes: [...nodes.values()], edges };
  }

  const api = Object.freeze({ corridor, detachPolygon, ensureNodeId, createBranch, findNearbyNode, connectPoint, moveNode, propagate, buildGraph });
  root.XYNFairwayNetwork = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
