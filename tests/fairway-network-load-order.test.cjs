const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Simulate BlueMap's browser environment (no CommonJS require): the network
// script arrives before the geometry helper. A late script must still work.
const assets = "src/main/resources/assets/bluemap_marker_tool/";
const networkJs = fs.readFileSync(assets + "fairway-network.js", "utf8");
const geometryJs = fs.readFileSync(assets + "fairway-geometry.js", "utf8");
const context = vm.createContext({ window: {} });
vm.runInContext(networkJs, context, { filename: "fairway-network.js" });
const net = context.window.XYNFairwayNetwork;
assert(net && typeof net.moveNode === "function");
assert.equal(context.window.XYNFairwayGeometry, undefined);

const makeCorridor = () => ({
  type: "fairway", geometry: "corridor", width: 40,
  points: [{ id: "A", x: 0, z: 0 }, { id: "B", x: 100, z: 0 }]
});
const fairway = makeCorridor();
assert.equal(net.moveNode([fairway], fairway.points[0], 5, 5), false,
  "fail safely until the geometry script is available");
assert.equal(fairway.points[0].x, 0, "no mutation before validator is available");

vm.runInContext(geometryJs, context, { filename: "fairway-geometry.js" });
const geometry = context.window.XYNFairwayGeometry;
assert.equal(geometry.corridorPolygon(
  [{ x: 5, z: 5 }, { x: 100, z: 0 }], 40
).length, 4);
assert.equal(net.moveNode([fairway], fairway.points[0], 5, 5), true,
  "late-loaded geometry helper must be picked up by the existing network instance");
assert.equal(fairway.points[0].x, 5);
assert.equal(fairway.points[0].z, 5);

// Connection validation must also resolve the late helper at call time.
const remote = { x: 150, z: 0, id: "endpoint" };
let seq = 0;
const linked = net.connectPoint([fairway], fairway, remote, () => "generated-" + (++seq));
assert(linked, "connection must succeed after geometry arrives");
assert.equal(linked.x, 150);
assert.equal(fairway.points.length, 3);
assert.equal(linked.nodeId, remote.nodeId);

// Never weaken the shared-node safety guard when changing load order.
const invalid = net.moveNode([fairway], fairway.points[1], 200, 0);
assert.equal(invalid, false, "a reversed corridor remains invalid");
assert.equal(fairway.points[1].x, 100, "invalid move remains atomic");

console.log("Late-loaded Fairway geometry tests: PASS");
