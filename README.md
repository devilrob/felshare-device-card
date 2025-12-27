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

## What’s new in v4

- Weekday toggles now show **MON/TUE/WED/THU/FRI/SAT/SUN** above the toggle indicator.
- Numeric device ids are removed from visible names.
- Default header picture set to your provided URL.

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

You can also use the mini card directly:

```yaml
type: custom:felshare-days-row
title: Days
days:
  mon: switch.123_work_day_mon
  tue: switch.123_work_day_tue
  wed: switch.123_work_day_wed
  thu: switch.123_work_day_thu
  fri: switch.123_work_day_fri
  sat: switch.123_work_day_sat
  sun: switch.123_work_day_sun
```
