# BlueMap Marker Tool

A NeoForge server-side mod that adds a click-to-draw marker editor directly inside the [BlueMap](https://github.com/BlueMap-Minecraft/BlueMap) web interface.

Draw area polygons and text labels on the live map. Markers are saved to the server and visible to every viewer — no client mod required.

---

## Requirements

- Minecraft 1.21.1
- NeoForge 21.1.x
- [BlueMap NeoForge mod](https://github.com/BlueMap-Minecraft/BlueMap) installed on the same server
- An open port for the marker API (separate from BlueMap's web port)

---

## Installation

1. Drop `BlueMapMarkerTool-1.0.jar` into your server's `mods/` folder alongside BlueMap.
2. Start the server. The mod auto-generates its config and deploys the editor script into BlueMap's webroot — no manual file copying needed.
3. Open `config/bluemap-marker-tool.toml` and set `api_port` to a port that is open and reachable on your server (see below).
4. Restart the server.
5. Open the BlueMap web interface in your browser.

> **Port note:** The marker editor communicates with the server via a small REST API running on a separate port.  
> You must allocate an open port on your host and set `api_port` in the config to match.  
> On managed hosts (e.g. PebbleHost) this is done via the "Additional Ports" panel.  
> The default is `8048` — change it to whatever port your host has assigned you.

---

## Controls

| Action | How |
|---|---|
| **Open / close editor** | Hold `Space`, then press `Tab` |
| **New area marker** | Click **▰ New Area** in the panel, then click the map to place corners |
| **New text label** | Click **T New Text** in the panel, then click the map to place it |
| **Finish drawing** | Click **✓ Done** |
| **Edit / move vertices** | Select a marker, click **✎ Edit**, then drag vertices on the map |
| **Insert a vertex** | In Edit mode, click on the outline between two existing vertices |
| **Delete a vertex** | In Edit mode, double-click a vertex |
| **Delete a marker** | Click **✕** next to it in the marker list |
| **Set text zoom threshold** | Use **Min dist** / **Max dist** fields (camera distance in blocks at which the label appears/disappears) |
| **Copy BlueMap HOCON config** | Click **📋 Copy BlueMap config** to copy a static marker-sets block for `overworld.conf` |

Markers are saved to the server automatically after every edit and are immediately visible to all viewers.

---

## Config (`config/bluemap-marker-tool.toml`)

```toml
# Port for the marker REST API. Must be open/reachable on your server.
# Change this to match the port your host has allocated.
api_port = 8048

# BlueMap map ID to push area markers to (matches the folder name under bluemap/maps/).
map_id = "overworld"
```

---

## How it works

On startup the mod:
- Extracts `area-draw.js` from the jar into BlueMap's webroot
- Registers it with BlueMap's webapp API so it loads automatically in every browser
- Writes `xyn-config.json` to the webroot so the editor knows which port to talk to
- Starts a lightweight HTTP server on `api_port`

Marker data is stored in `config/xynovia/markers.json` and pushed to BlueMap's live marker API on every save so viewers see updates without a page refresh.

---

## Credits

Built on top of [BlueMap](https://github.com/BlueMap-Minecraft/BlueMap) by [BlueColored](https://github.com/TBlueF).
