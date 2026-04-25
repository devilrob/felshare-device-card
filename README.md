# Felshare Device Card (Auto)

A Home Assistant Lovelace **custom card** that auto-detects entities and builds a clean UI **without YAML edits**.

✅ Supported integrations:
- `felshare_cloud` (Cloud MQTT)
- `felshare_ble` (Bluetooth / BLE)

## What’s new in v7

- **Performance:** `set hass()` is now debounced (50 ms) — eliminates redundant renders on every HA state tick.
- **API upgrade:** Uses the lighter `config/entity_registry/list_for_display` WebSocket endpoint (HA ≥ 2022.9) with automatic fallback to the classic `list` endpoint on older versions. Handles both HA 2023.x compressed field names and full field names transparently.
- **Bug fixes:** error recovery in async data loading (card retries on WS failure instead of locking forever), concurrent render race condition guard, XSS prevention in weekday labels/title.
- **Tests:** 40-test Jest suite added — run with `npm test`.

## What was new in v6

- BLE devices show as **`BLE • 56:D2`** (short MAC) in the device picker.
- Header title automatically appends **`(BLE)`** when a BLE device is selected.
- Entity names are cleaned up (removes leading numeric ids and BLE/MAC prefixes).

## Install (HACS)

1. HACS → ⋮ → **Custom repositories**
2. Add this repository URL
3. Type: **Dashboard**
4. Install

## Add Resource

Settings → Dashboards → Resources → Add:

- URL: `/hacsfiles/<REPO_NAME>/felshare-device-card.js`
- Type: `module`

## Use

Dashboard → Add card → **Felshare Device Card (Auto)**

## Options (optional)

```yaml
type: custom:felshare-device-card
title: Felshare Diffuser
show_picture: true
picture: https://.../image.jpg
show_device_picker: true
show_other_entities: false
max_other_entities: 12
platforms:
  - felshare_cloud
  - felshare_ble
```
