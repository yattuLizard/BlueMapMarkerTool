# BlueMap Marker Tool

A server-side marker editor for BlueMap on Minecraft 1.21.1 / NeoForge 21.1.x.
Draw and edit areas, text labels and 3D routes from the BlueMap administrator menu.

## Marker types

| Editor type | BlueMap set ID | Marker tab label | Appearance |
| --- | --- | --- | --- |
| Area | `areas` | Areas | Filled polygon |
| Text | `labels` | Text Labels | HTML text label |
| Road | `roads` | Roads | Orange line, 5 px by default |
| Sea Route | `sea_routes` | Sea Routes | Blue line, 4 px by default |
| Air Route | `air_routes` | Air Routes | Purple line, 3 px by default |
| Fairway | `fairways` | Fairways | Centerline-width corridor or manual polygon |
| Named Waypoint | `waypoints` | Waypoints (hidden by default) | Named point label |

Each set is independently toggleable in BlueMap's marker tab. Road, sea and air routes are open 3D polylines backed by BlueMap's native `LineMarker`. The three route categories use the same waypoint model. Fairways are native BlueMap `ShapeMarker` polygons, and named waypoints are HTML markers in their own layer.

## Requirements

- Minecraft 1.21.1
- NeoForge 21.1.x
- BlueMap with BlueMapAPI 2.7-compatible marker support
- JDK 21 for building the mod

## Installation

Build the jar with `./gradlew build`, or use the jar from a matching release. Place one version in the server's `mods/` directory and restart the server. The mod deploys its JavaScript into BlueMap's webroot automatically.

Edit the server config `config/bluemap-marker-tool.toml`:

```toml
api_port = 8034
map_id = "overworld"
secret = "replace-with-your-own-password"
```

Change the default password before exposing the editor. The marker API runs on a separate port; do not expose it publicly without access controls. For BlueMap served through Cloudflare Tunnel over HTTPS, route the same-origin `/xyn/markers` path internally to the marker API and serve all other paths from BlueMap. Keep the marker API bound to a trusted network or host.

After an upgrade, hard-reload BlueMap. If Cloudflare caches `settings.json` or the injected scripts, purge those paths so the browser receives the new versioned scripts.

## Administrator editor

Open **Administrator** from the BlueMap menu and log in.

- Choose **New Area**, **New Text**, **Road**, **Sea Route**, **Air Route**, or **New Fairway**.
- Click the map to add vertices or route waypoints. Routes become visible once at least two waypoints have been placed.
- Use **Done** to stop drawing, or **Edit / Path** to move existing points.
- Drag a vertex to move it horizontally. Click near a segment in edit mode to insert a vertex.
- Double-click a vertex to delete it.
- For routes, edit each waypoint's **X / Y / Z** numerically; for fairways, edit **X / Z**. Waypoints can be reordered with arrow buttons and deleted with the cross button. Existing waypoint IDs and names survive dragging or reordering.
- Any route or fairway waypoint can have an optional **Name**. Named points appear in the independent, initially hidden **Waypoints** layer.
- Set **Next Y** to control the elevation for newly added route points; existing point Y values remain unchanged.
- Set the route **line width**, color, title, subtitle, and minimum/maximum display distances in the editor.
- For **Fairway**, choose **Centerline + width** (a width in Minecraft blocks, expanded on both sides of the open centerline) or **Polygon** (a manually drawn, closed boundary). Control fairway width, fill opacity and color. A valid corridor needs at least two non-identical centerline points, and a polygon needs three vertices.
- All changes are saved to `config/xynovia/markers.json`. BlueMap also receives native marker updates server-side.

Fairways are 2D horizontal outlines at a fixed Y, not navigable volumes. Corridor geometry rejects near-U-turns and self-crossing outlines; add intermediate points or switch to Polygon for complex fairways. The tool does not calculate collision-free ship routes or follow water depth.

Roads and sea routes do **not** automatically follow terrain, water height, or the seabed. Enter appropriate Y values for each waypoint. BlueMap's built-in line marker does not provide a dashed-line option in this implementation.

## Saved data

All types share the same `items` array in `config/xynovia/markers.json`. Route items use one of `road`, `sea`, or `air` as their `type`:

```json
{
  "items": [
    {
      "id": "road-1",
      "type": "road",
      "title": "Main Road",
      "subtitle": "",
      "color": "#efa53a",
      "lineWidth": 5,
      "y": 70,
      "minDist": 0,
      "maxDist": 0,
      "points": [{ "x": 100, "y": 70, "z": 200 }, { "x": 200, "y": 75, "z": 230 }]
    }
  ]
}
```

A centerline fairway is saved as a separate item, with a width in blocks and optional names on each point:

```json
{
  "items": [
    {
      "id": "fairway-harbor-channel",
      "type": "fairway",
      "geometry": "corridor",
      "title": "Harbor Channel",
      "subtitle": "West entrance",
      "color": "#00bfff",
      "y": 64,
      "fill": 0.25,
      "width": 40,
      "points": [
        { "id": "wp-west", "name": "West entrance", "x": 100, "z": 200 },
        { "id": "wp-east", "name": "East channel", "x": 300, "z": 220 }
      ]
    }
  ]
}
```

Use `"geometry": "polygon"` to interpret the fairway's point array as the boundary instead of a centerline; `width` is then ignored. Older Area, Text, Road, Sea Route and Air Route records remain compatible. BlueMap's standard marker sets are generated by the server, while the browser previews changes only to the seven sets owned by the mod.

## Credits

Uses [BlueMap](https://github.com/BlueMap-Minecraft/BlueMap) by BlueColored and contributors.


## Branching fairway network (experimental)

Fairway **Centerline + width** can now form a connected, branching waterway
network instead of requiring a single continuous stroke.

1. Create a **New Fairway**, draw at least two points and name junctions if needed.
2. To branch directly from the map, click **Branch on map** in the editor. Visible
   centerline waypoints appear as cyan/gold dots; click one to start drawing a
   connected branch. The selection works across all Fairways, regardless of
   the currently selected marker. Click **Branch on map** again to cancel.
3. Alternatively, in a Fairway's waypoint list, click **Branch** next to any waypoint. This makes a new
   Fairway corridor starting at that exact point, retaining the parent channel's
   width, color and Y setting.
4. Click the map to add more points. Clicking within ~14 screen pixels of an
   existing centerline Fairway waypoint connects the new corridor to that node
   instead of adding an unrelated point.
5. Shared junctions are highlighted in gold when editing. Moving or renaming a
   connected waypoint updates the corresponding points in other corridor
   Fairways. The Waypoints layer renders a shared named junction only once.
6. Use **Copy Fairway Graph JSON** to export an adjacency-ready collection of
   `nodes` and `edges` including the source Fairway IDs and channel widths.

New connections use a `nodeId` field on the existing `points` records. The
original per-point `id`, name, coordinates and existing marker JSON format are
preserved. Older unconnected corridors stay separate until joined explicitly;
polygon Fairways remain independent navigable regions. Segments are independent
Fairway records, allowing branches to have different widths and styles. Deleting
a point or a branch only removes its occurrence in that particular Fairway.

**Limitations:** This is a geometric and topological map annotation, not a
route-finding or navigational safety model. No automatic detection of water depth,
shore collision, or line-to-line crossing is performed. Crossed lines are only
connected when they explicitly share a junction node. A shared point currently
synchronizes X/Z position and name; the rendering height is still set per
Fairway. If two existing channels merely overlap, use the Branch or snap action
to link them intentionally.
