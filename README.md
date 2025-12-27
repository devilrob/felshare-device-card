# Felshare Device Card (Auto)

A Home Assistant Lovelace **custom card** that auto-detects entities from the **Felshare (Cloud MQTT)** custom integration (`felshare_cloud`) and builds a full UI **without YAML edits**.

## Install (HACS)

1. HACS → ⋮ → **Custom repositories**
2. Add this repository URL
3. Type: **Dashboard**
4. Install

## Add Resource

Settings → Dashboards → Resources → Add:

- URL: `/hacsfiles/<REPO_NAME>/felshare-device-card.js`
- Type: `module`

> `<REPO_NAME>` is the GitHub repo name as it appears in HACS (e.g. `felshare-device-card`).

## Use

Dashboard → Add card → **Felshare Device Card (Auto)**

No entity ids, no copy/paste YAML.

## Notes

- If you have multiple Felshare devices, the card shows a device picker dropdown automatically.
- The card expects the Entity Registry platform to be `felshare_cloud` (default). If yours differs, you can override:

```yaml
type: custom:felshare-device-card
platforms:
  - felshare_cloud
  - felshare
```

- Default header image path:
  - `/config/www/felshare/diffuser-header.jpg`
  - Then use `/local/felshare/diffuser-header.jpg` in the card config (default).

