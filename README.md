# Felshare Device Card (Auto)

A Home Assistant Lovelace **custom card** that auto-detects entities from the **Felshare (Cloud MQTT)** custom integration (`felshare_cloud`) and builds a clean UI **without YAML edits**.

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
```

### Notes

- This card matches entities using **Entity Registry `unique_id` patterns** (robust even if entity_ids differ).
- The card strips the numeric device id from friendly names automatically.
- Default picture is an external URL (you can change it to a local `/local/...` image if you prefer).
