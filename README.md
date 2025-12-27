# Felshare Device Card (Auto)

A Home Assistant Lovelace **custom card** that auto-detects entities and builds a clean UI **without YAML edits**.

✅ Supported integrations:
- `felshare_cloud` (Cloud MQTT)
- `felshare_ble` (Bluetooth / BLE)

## What’s new in v6

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
