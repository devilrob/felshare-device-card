# Felshare Device Card (Auto)

A Home Assistant Lovelace **custom card** that auto-detects Felshare entities and builds a full control UI **without YAML edits**.

## Install (HACS)

1. HACS → **⋮** → **Custom repositories**
2. Add this repository URL
3. Type: **Dashboard**
4. Install

## Add resource

Settings → Dashboards → Resources → Add:

- URL: `/hacsfiles/felshare-device-card/felshare-device-card.js`
- Type: `module`

## Use

Add card → **Felshare Device Card (Auto)**

No entity IDs, no YAML edits.

## Notes

- The card uses the Entity Registry + Device Registry. It groups entities by `device_id` when available.
- If no `device_id` is present, it falls back to parsing numeric prefixes like `switch.229070733364532_fan`.
- You can adjust the detected platforms in YAML config if needed, e.g.:

```yaml
type: custom:felshare-device-card
platforms:
  - felshare_cloud
  - felshare
```
