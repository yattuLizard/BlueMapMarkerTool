const assert = require("node:assert/strict");
const fs = require("node:fs");

const script = fs.readFileSync("src/main/resources/assets/bluemap_marker_tool/area-draw.js", "utf8");
const geometry = require("../src/main/resources/assets/bluemap_marker_tool/fairway-geometry.js");
const network = require("../src/main/resources/assets/bluemap_marker_tool/fairway-network.js");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.id = "";
    this.style = {};
    this.children = [];
    this.value = "";
    this.dataset = {};
    this._html = "";
    this.listeners = {};
    this.queries = {};
    this.selectorCache = {};
  }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = value; this.selectorCache = {}; }
  appendChild(x) { this.children.push(x); return x; }
  removeChild(x) { this.children = this.children.filter(y => x !== y); }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  querySelector(selector) { return this.queries[selector] ??= new Element(selector); }
  querySelectorAll(selector) {
    if (this.selectorCache[selector]) return this.selectorCache[selector];
    if (selector === "[data-route-axis]") {
      // Unlike numeric waypoint indices, coordinate-axis values are strings.
      const matches = [...this.innerHTML.matchAll(/<input\b[^>]*data-route-idx="(\d+)"[^>]*data-route-axis="([xyz])"[^>]*>/g)];
      const fields = matches.map(match => {
        const input = new Element("input");
        input.dataset.routeIdx = match[1];
        input.dataset.routeAxis = match[2];
        input.value = match[0].match(/value="([^"]*)"/)?.[1] ?? "";
        return input;
      });
      return this.selectorCache[selector] = fields;
    }
    if (!selector.startsWith("[data-route-")) return [];
    const attr = selector.slice(1, -1);
    const matches = [...this.innerHTML.matchAll(new RegExp(attr + '="(\\d+)"', "g"))];
    const attrKey = attr.slice(5).replace(/-([a-z])/g, (_whole, letter) => letter.toUpperCase());
    const elements = matches.map(match => {
      const input = new Element("input");
      input.dataset[attrKey] = match[1];
      return input;
    });
    return this.selectorCache[selector] = elements;
  }
  contains() { return false; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  remove() {}
}

class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  project() { this.x /= 1000; this.y /= 1000; this.z = 0.5; return this; }
}

async function main() {
  const canvas = new Element("canvas"), viewer = new Element("viewer");
  viewer.querySelector = () => canvas;

  const sets = new Map([["another-plugin", { label: "Unrelated marker set" }]]);
  const markerRoot = {
    markerSets: sets,
    updateMarkerSetFromData(id, value) { sets.set(id, value); },
    remove(value) { for (const [id, markerSet] of sets) if (markerSet === value) sets.delete(id); }
  };
  const mapViewer = {
    rootElement: viewer, markers: markerRoot,
    _camera: { position: { x: 0, y: 200, z: 0 } },
    raycaster: {
      ray: { origin: new Vector(0, 200, 0), direction: { x: 1, y: -1, z: 1 } },
      setFromCamera(v) { this.ray.direction = { x: 1 + v.x, y: -1, z: 1 + v.y }; }
    }
  };
  const body = new Element("body");
  const document = {
    body, head: new Element("head"),
    createElement: tag => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    addEventListener() {}
  };
  const initial = {
    items: [
      { id: "area-1", type: "area", title: "Existing Area", color: "#4caf50", fill: 0.25, y: 64,
        points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 4 }] },
      { id: "text-1", type: "text", title: "Existing Text", color: "#ffffff", y: 70,
        points: [{ x: 1, z: 1 }] }
    ]
  };
  const writes = [];
  let exported = "";
  const fetch = (url, options) => {
    if (url === "/xyn-config.json") return Promise.resolve({ ok: true, json: async () => ({ apiPort: 8034 }) });
    if (options?.method === "POST") {
      writes.push(JSON.parse(options.body));
      return Promise.resolve({ ok: true, status: 200 });
    }
    return Promise.resolve({ ok: true, json: async () => initial });
  };
  const window = {
    XYNFairwayGeometry: geometry,
    XYNFairwayNetwork: network,
    bluemap: { mapViewer, markerFileManager: {} },
    location: { protocol: "https:", origin: "https://example.invalid", hostname: "example.invalid" }
  };
  const navigator = { clipboard: { writeText(value) { exported = value; return Promise.resolve(); } } };
  new Function(
    "window", "document", "fetch", "setTimeout", "requestAnimationFrame",
    "innerWidth", "innerHeight", "navigator", "console", script
  )(
    window, document, fetch, () => {}, () => {}, 800, 600, navigator,
    { log() {}, warn() {} }
  );
  for (let i = 0; i < 12; i++) await Promise.resolve();

  const panel = body.children.find(element => element.id === "xynPanel");
  assert(panel);
  assert(sets.has("areas"));
  assert(sets.has("labels"));

  function clickMap(x, y = 290) {
    const event = { button: 0, clientX: x, clientY: y, target: canvas,
                    stopPropagation() {}, preventDefault() {} };
    for (const listener of canvas.listeners.pointerdown || []) listener(event);
    for (const listener of canvas.listeners.pointerup || []) listener(event);
  }

  for (const name of ["Road", "Sea", "Air"]) {
    const create = panel.querySelector("#xNew" + name);
    assert.equal(typeof create.onclick, "function");
    create.onclick();
    clickMap(320); clickMap(380);
  }

  for (const id of ["roads", "sea_routes", "air_routes"]) {
    assert(sets.has(id), "Missing " + id);
    const markers = Object.values(sets.get(id).markers);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].type, "line");
    assert.equal(markers[0].line.length, 2);
  }

  const newFairway = panel.querySelector("#xNewFairway");
  assert.equal(typeof newFairway.onclick, "function");
  newFairway.onclick();
  clickMap(320); clickMap(380);

  assert(sets.has("fairways"));
  let fairway = Object.values(sets.get("fairways").markers)[0];
  assert.equal(fairway.type, "shape");
  assert.equal(fairway.shape.length, 4);
  assert.equal(sets.has("waypoints"), false);

  let field = panel.querySelector("#xFairwayWidth");
  assert.equal(typeof field.onchange, "function");
  field.onchange({ target: { value: "20" } });
  fairway = Object.values(sets.get("fairways").markers)[0];
  assert.equal(fairway.shape.length, 4);

  // Name the first centerline waypoint. This produces a separate default-hidden
  // native HTML-marker layer, without altering the fairway geometry.
  const editor = panel.querySelector("#xEdit");
  const names = editor.querySelectorAll("[data-route-name]");
  assert.equal(names.length, 2);
  assert.equal(typeof names[0].onchange, "function");
  names[0].value = 'Harbor "North" & East';
  names[0].onchange();

  assert(sets.has("waypoints"));
  assert.equal(sets.get("waypoints").defaultHidden, true);
  const waypointMarker = Object.values(sets.get("waypoints").markers)[0];
  assert.equal(waypointMarker.type, "html");
  assert.equal(waypointMarker.label, names[0].value);
  assert(waypointMarker.html.includes("&amp;"));
  assert(waypointMarker.html.includes('"North"')); // text in HTML content, not an attribute

  // Change corridor to manually drawn polygon and add the third vertex.
  panel.querySelector("#xGeometry").onchange({ target: { value: "polygon" } });
  clickMap(380, 260);
  fairway = Object.values(sets.get("fairways").markers)[0];
  assert.equal(fairway.shape.length, 3);
  assert.equal(sets.get("waypoints").defaultHidden, true);

  for (const id of ["areas", "labels", "roads", "sea_routes", "air_routes", "fairways", "waypoints", "another-plugin"]) {
    assert(sets.has(id), id + " disappeared");
  }

  panel.querySelector("#xExport").onclick();
  for (const id of ["roads", "sea_routes", "air_routes", "fairways", "waypoints"]) {
    assert(exported.includes(id + ": {"), id + " missing from export");
  }
  assert(writes.length >= 8);
  assert.equal(writes.at(-1).items.find(item => item.type === "fairway").points[0].name, names[0].value);
  // A second navigable corridor supports a branch from an existing junction.
  newFairway.onclick();
  clickMap(320); clickMap(380);
  const corridor = writes.at(-1).items.at(-1);
  assert.equal(corridor.geometry, "corridor");
  const branches = editor.querySelectorAll("[data-route-branch]");
  assert.equal(branches.length, 2);
  assert.equal(typeof branches[0].onclick, "function");
  branches[0].onclick();
  let doc = writes.at(-1);
  let child = doc.items.at(-1);
  const parent = doc.items.at(-2);
  assert.equal(child.points.length, 1);
  assert.equal(child.points[0].nodeId, parent.points[0].nodeId);
  clickMap(700); // new branch endpoint
  doc = writes.at(-1); child = doc.items.at(-1);
  assert.equal(child.points.length, 2);
  assert.equal(network.buildGraph(doc.items).edges.length >= 2, true);

  // Renaming the branch junction updates its counterpart on the original fairway.
  const sharedNames = editor.querySelectorAll("[data-route-name]");
  sharedNames[0].value = "River junction";
  sharedNames[0].onchange();
  doc = writes.at(-1);
  assert.equal(doc.items.at(-2).points[0].name, "River junction");
  assert.equal(doc.items.at(-1).points[0].name, "River junction");
  const sharedLabels = Object.keys(sets.get("waypoints").markers).filter(k => k.startsWith("shared-wp-"));
  assert.equal(sharedLabels.length, 1, "Connected node should have just one label");

  // A fresh fairway snaps to the existing second node rather than duplicating it.
  newFairway.onclick();
  clickMap(452, 281); // near the visible second waypoint in the mocked projection
  doc = writes.at(-1);
  assert.equal(doc.items.at(-1).points.length, 1);
  assert(doc.items.at(-1).points[0].nodeId, "expected actual snap, not undefined === undefined");
  assert.equal(doc.items.at(-1).points[0].nodeId, doc.items.at(-3).points[1].nodeId);
  clickMap(730);
  doc = writes.at(-1);
  assert.equal(doc.items.at(-1).points.length, 2);
  assert.equal(network.buildGraph(doc.items).edges.length >= 3, true);
  // Switching an actively connected corridor to Polygon breaks only this
  // fairway's junction links. Local IDs, names and coordinates must survive.
  const beforeSwitch = writes.at(-1).items.at(-1).points
    .map(p => ({ id: p.id, name: p.name, x: p.x, z: p.z }));
  const linkedId = writes.at(-1).items.at(-1).points[0].nodeId;
  assert(linkedId);
  const linkedOriginal = writes.at(-1).items.at(-3).points[1].name;
  panel.querySelector("#xGeometry").onchange({ target: { value: "polygon" } });
  doc = writes.at(-1);
  assert.equal(doc.items.at(-1).geometry, "polygon");
  assert(doc.items.at(-1).points.every(p => !("nodeId" in p)));
  assert.deepEqual(doc.items.at(-1).points.map(p => ({
    id: p.id, name: p.name, x: p.x, z: p.z
  })), beforeSwitch);
  assert.equal(doc.items.at(-3).points[1].nodeId, linkedId);
  const detachedName = editor.querySelectorAll("[data-route-name]")[0];
  detachedName.value = "Independent harbor boundary";
  detachedName.onchange();
  doc = writes.at(-1);
  assert.equal(doc.items.at(-1).points[0].name, detachedName.value);
  assert.equal(doc.items.at(-3).points[1].name, linkedOriginal);
  assert.equal(network.buildGraph(doc.items).nodes.some(node => node.name === detachedName.value), false);

  // Browser regression: two connected centerlines must survive an invalid drag.
  // Use a separate water plane far enough from previous fairways to avoid snapping.
  newFairway.onclick();
  clickMap(320, 450); clickMap(380, 450); clickMap(440, 450);
  let scene = writes.at(-1);
  const mainCorridor = scene.items.at(-1);
  assert.equal(mainCorridor.points.length, 3);
  const mainB = mainCorridor.points[1], mainC = mainCorridor.points[2];
  const fromMain = editor.querySelectorAll("[data-route-branch]");
  assert.equal(fromMain.length, 3);
  fromMain[1].onclick();
  clickMap(500, 520);
  scene = writes.at(-1);
  const branchCorridor = scene.items.at(-1);
  assert.equal(branchCorridor.points.length, 2);
  assert(branchCorridor.points[0].nodeId, "branch must have a real shared node ID");
  assert.equal(branchCorridor.points[0].nodeId, scene.items.at(-2).points[1].nodeId);
  const stable = JSON.stringify(scene.items);
  const writeCount = writes.length;

  panel.querySelector("#xEditM").onclick();
  // Mocked worldToScreen: x=400 + 0.4 * worldX, y=300 - 0.3 * Y.
  const clickJunction = {
    button: 0, clientX: 400 + 0.4 * mainB.x, clientY: 300 - 0.3 * branchCorridor.y,
    target: canvas, stopPropagation() {}, preventDefault() {}
  };
  for (const cb of canvas.listeners.pointerdown || []) cb(clickJunction);
  const invalidDrag = {
    ...clickJunction, clientX: 720, clientY: 450
  };
  for (const cb of canvas.listeners.pointermove || []) cb(invalidDrag);
  assert.equal(JSON.stringify(writes.at(-1).items), stable, "no invalid intermediate save");
  for (const cb of canvas.listeners.pointerup || []) cb(invalidDrag);
  assert.equal(writes.length, writeCount, "failed drag must not persist");
  assert.equal(JSON.stringify(writes.at(-1).items), stable, "failed drag must be atomic");

  // Valid drag must synchronize the same node in main and branch.
  for (const cb of canvas.listeners.pointerdown || []) cb(clickJunction);
  const goodDrag = { ...clickJunction, clientX: 367, clientY: 450 };
  for (const cb of canvas.listeners.pointermove || []) cb(goodDrag);
  for (const cb of canvas.listeners.pointerup || []) cb(goodDrag);
  scene = writes.at(-1);
  assert.equal(scene.items.at(-2).points[1].x, scene.items.at(-1).points[0].x);
  assert.notEqual(scene.items.at(-2).points[1].x, mainB.x, "valid drag should change junction");
  assert.equal(scene.items.at(-2).points[1].z, scene.items.at(-1).points[0].z);

  // Numeric coordinate edit is also atomic, with no save on rejection.
  const coords = editor.querySelectorAll("[data-route-axis]");
  const branchX = coords.find(el => el.dataset.routeIdx === "0" && el.dataset.routeAxis === "x");
  assert(branchX);
  const currentX = scene.items.at(-1).points[0].x;
  const saves = writes.length;
  branchX.value = String(mainC.x + 100);
  branchX.onchange();
  assert.equal(writes.length, saves);
  assert.equal(branchX.value, currentX, "rejected numeric edit must restore input");
  assert.equal(writes.at(-1).items.at(-2).points[1].x, currentX);

  // Direct map branching works from a different Fairway than the selected one.
  const branchMapButton = panel.querySelector("#xBranchMap");
  assert.equal(typeof branchMapButton.onclick, "function");
  const sourceBefore = writes.at(-1).items.at(-2).points[2];
  const originalId = sourceBefore.id;
  const beforeCount = writes.at(-1).items.length;
  branchMapButton.onclick();
  assert(panel.innerHTML.includes("Select a highlighted Fairway waypoint"));

  // A blank click must not create any branch or save anything.
  const priorWrites = writes.length;
  clickMap(790, 580);
  assert.equal(writes.length, priorWrites);
  assert.equal(writes.at(-1).items.length, beforeCount);

  // Clicking the displayed waypoint selects the closest point and starts drawing.
  const mapY = writes.at(-1).items.at(-2).y;
  const pickX = 400 + 0.4 * sourceBefore.x;
  const pickY = 300 - 0.3 * mapY;
  clickMap(pickX, pickY);
  let afterPick = writes.at(-1);
  assert.equal(afterPick.items.length, beforeCount + 1);
  const pickedSource = afterPick.items.at(-3).points[2];
  const pickedBranch = afterPick.items.at(-1);
  assert.equal(pickedSource.id, originalId, "map branching must preserve waypoint ID");
  assert(pickedSource.nodeId, "a new junction must get a node ID");
  assert.equal(pickedBranch.points[0].nodeId, pickedSource.nodeId);
  assert.equal(pickedBranch.points[0].x, pickedSource.x);
  assert.equal(pickedBranch.points[0].z, pickedSource.z);
  assert.equal(pickedBranch.geometry, "corridor");
  clickMap(760, 340);
  afterPick = writes.at(-1);
  assert.equal(afterPick.items.at(-1).points.length, 2, "selected branch should continue in draw mode");

  // Re-activating map mode and canceling it doesn't alter any saved data.
  const savedCount = writes.length;
  branchMapButton.onclick();
  branchMapButton.onclick();
  assert.equal(writes.length, savedCount);

  console.log("Marker editor, map-based branch selection, and network smoke tests: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
