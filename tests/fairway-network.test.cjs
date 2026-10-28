const assert = require("node:assert/strict");
const net = require("../src/main/resources/assets/bluemap_marker_tool/fairway-network.js");
let next = 0; const uid = () => "n" + (++next);
const first = {
  id: "f1", type: "fairway", geometry: "corridor", title: "Main channel",
  width: 40, color: "#00bfff", fill: 0.2, y: 64,
  points: [
    { id: "p1", x: 0, z: 0, name: "" },
    { id: "p2", x: 100, z: 0, name: "Junction" },
    { id: "p3", x: 200, z: 0, name: "" }
  ]
};
const items = [first];
const branch = net.createBranch(items, first, 1, uid);
assert.equal(items.length, 2);
assert.equal(branch.points.length, 1);
assert.equal(branch.points[0].nodeId, first.points[1].nodeId);
assert.equal(branch.points[0].name, "Junction");
const snapped = net.findNearbyNode(items, branch, 101, 0, p => ({ x: p.x, y: p.z, vis: true }), { x: 101, z: 0 });
assert.equal(snapped, first.points[1]);
assert.equal(net.connectPoint(items, branch, snapped, uid), null, "reject coincident connection");
branch.points.push({ id: "end", x: 100, z: 100 });
let graph = net.buildGraph(items);
assert.equal(graph.edges.length, 3);
assert.equal(graph.nodes.length, 4);
assert.equal(graph.edges[0].to, graph.edges[2].from);
assert.equal(graph.edges[1].from, graph.edges[2].from);
assert.equal(graph.edges[2].width, 40);
assert.equal(net.moveNode(items, first.points[1], 110, 0), true);
first.points[1].name = 'East Junction';
assert.equal(net.propagate(items, first.points[1]), 1);
assert.equal(branch.points[0].x, 110);
assert.equal(branch.points[0].name, "East Junction");
const second = {
  id: "f2", type: "fairway", geometry: "corridor", width: 20,
  points: [{ id: "q1", x: 500, z: 0 }]
};
items.push(second);
const join = net.connectPoint(items, second, branch.points[1], uid);
assert(join);
assert.equal(join.x, 100);
assert.equal(join.z, 100);
assert.equal(join.nodeId, branch.points[1].nodeId);
graph = net.buildGraph(items);
assert.equal(graph.edges.length, 4);
assert.equal(graph.nodes.length, 5);
assert.equal(net.moveNode(items, branch.points[1], 100, 150), true);
assert.equal(second.points[1].z, 150);
assert.equal(net.createBranch(items, { type: "fairway", geometry: "polygon", points: [{x:0,z:0}] }, 0, uid), null);

// Regression: all occurrences of a node or position must be checked, not just the last point.
const closed = { id: "closed", type: "fairway", geometry: "corridor", width: 40,
  points: [{ id: "a", x: 0, z: 0 }, { id: "b", x: 100, z: 0 }] };
const oldData = JSON.stringify(closed), external = { id: "external", x: 0, z: 0 };
assert.equal(net.connectPoint([closed], closed, external, uid), null, "reject A->B->A");
assert.equal(JSON.stringify(closed), oldData, "invalid connection must not mutate target");
assert.equal(external.nodeId, undefined, "invalid connection must not assign nodeId to source");

// Regression: a near-reversal with distinct coordinates can still invalidate a corridor.
const nearUTurn = { id: "uturn", type: "fairway", geometry: "corridor", width: 40,
  points: [{ x: 0, z: 0 }, { x: 100, z: 0 }] };
const invalidJoin = { x: 0, z: 1 };
assert.equal(net.connectPoint([], nearUTurn, invalidJoin, uid), null, "reject invalid corridor geometry");
assert.equal(nearUTurn.points.length, 2);
assert.equal(invalidJoin.nodeId, undefined);

// Regression: a point may be near on screen while hidden or very far in world space.
const visibility = [{ id: "v", type: "fairway", geometry: "corridor",
  points: [{ x: 100, z: 0 }, { x: 200, z: 0 }] }];
const cursor = { x: 101, z: 0 };
assert.equal(net.findNearbyNode(visibility, branch, 100, 0,
  p => ({ x: p.x, y: p.z, vis: false }), cursor), null, "reject hidden / behind-camera");
assert.equal(net.findNearbyNode(visibility, branch, 100, 0,
  p => ({ x: 100, y: 0, vis: true }), { x: 10000, z: 0 }), null, "reject geographic distance");
assert.equal(net.findNearbyNode(visibility, branch, 100, 0,
  p => ({ x: p.x, y: p.z, vis: true }), cursor), visibility[0].points[0]);
assert.equal(net.findNearbyNode(visibility, branch, 100, 0,
  p => ({ x: p.x, y: p.z, vis: true }), null), null, "missing world point must fail closed");

// Regression: switching an already-connected centerline to polygon mode detaches only local
// node references, not local waypoint IDs, positions, names, or the other branch.
const polygon = JSON.parse(JSON.stringify(branch));
polygon.type = "fairway"; polygon.geometry = "polygon";
const preserved = polygon.points.map(p => ({ id: p.id, x: p.x, z: p.z, name: p.name }));
assert.equal(net.detachPolygon(polygon), 2);
assert(polygon.points.every(p => !("nodeId" in p)));
assert.deepEqual(polygon.points.map(p => ({ id: p.id, x: p.x, z: p.z, name: p.name })), preserved);
const otherJunctionName = first.points[1].name;
polygon.points[0].name = "Independent polygon waypoint";
assert.equal(net.propagate([polygon, first, branch], polygon.points[0]), 0);
assert.equal(first.points[1].name, otherJunctionName);
assert.equal(net.detachPolygon(polygon), 0, "detach should be idempotent");

// Regression: moving a *shared* junction must validate every touched corridor.
// The main channel A-B-C reverses direction when B is moved past C.
const main = { id: "main", type: "fairway", geometry: "corridor", width: 40,
  points: [{ id: "A", x: 0, z: 0 }, { id: "B", nodeId: "B", x: 100, z: 0 },
           { id: "C", x: 200, z: 0 }] };
const offshoot = { id: "offshoot", type: "fairway", geometry: "corridor", width: 40,
  points: [{ id: "B2", nodeId: "B", x: 100, z: 0 }, { id: "D", x: 100, z: 100 }] };
const graphItems = [main, offshoot], beforeInvalid = JSON.stringify(graphItems);
assert.equal(net.moveNode(graphItems, offshoot.points[0], 210, 0), false);
assert.equal(JSON.stringify(graphItems), beforeInvalid,
  "invalid shared move must reject atomically with no changes");
assert.equal(net.moveNode(graphItems, offshoot.points[0], NaN, 12), false);
assert.equal(JSON.stringify(graphItems), beforeInvalid);
assert.equal(net.moveNode(graphItems, offshoot.points[0], 110, 20), true);
assert.equal(main.points[1].x, 110);
assert.equal(main.points[1].z, 20);
assert.equal(offshoot.points[0].x, 110);
assert.equal(offshoot.points[0].z, 20);
assert.equal(net.moveNode(graphItems, offshoot.points[0], 210, 0), false);
assert.equal(main.points[1].x, 110);
assert.equal(offshoot.points[0].x, 110);

// Single-point branches have no polygon until their second point arrives.
const onePoint = { id: "new", type: "fairway", geometry: "corridor", width: 40,
  points: [{ id: "shared-new", nodeId: "B", x: 110, z: 20 }] };
assert.equal(net.moveNode([...graphItems, onePoint], onePoint.points[0], 120, 10), true);
assert.equal(main.points[1].x, 120);
assert.equal(offshoot.points[0].x, 120);
assert.equal(onePoint.points[0].x, 120);

// Direct map picker can select any visible corridor node, even if the editor
// currently has another marker selected; polygon vertices are not candidates.
const screenItems = [
  { id: "polygon", type: "fairway", geometry: "polygon",
    points: [{ x: 30, z: 30 }] },
  { id: "road", type: "road", points: [{ x: 30, z: 30 }] },
  { id: "visible", type: "fairway", geometry: "corridor",
    points: [{ x: 20, z: 20 }, { x: 25, z: 21 }] },
  { id: "hidden", type: "fairway", geometry: "corridor",
    points: [{ x: 30, z: 30, hidden: true }] }
];
const project = p => ({ x: p.x, y: p.z, vis: !p.hidden });
let pick = net.findScreenNode(screenItems, 24, 21, project);
assert.equal(pick.item.id, "visible");
assert.equal(pick.index, 1);
assert.equal(pick.point, screenItems[2].points[1]);
assert.equal(net.findScreenNode(screenItems, 30, 30, project, 4), null,
  "off-category and invisible points must be excluded");
assert.equal(net.findScreenNode(screenItems, 200, 200, project), null,
  "an empty map click must not pick a distant node");
assert.equal(net.findScreenNode(screenItems, Infinity, 0, project), null,
  "invalid screen coordinates must be rejected");
screenItems[2].points[1].hidden = true;
pick = net.findScreenNode(screenItems, 24, 21, project);
assert.equal(pick.point, screenItems[2].points[0],
  "picker can choose a different visible node when closest is hidden");
console.log("Branching fairway network tests: PASS");
