/* felshare-device-card.js
 * Felshare Device Card (Auto) - v3
 * - 100% automatic (no entity IDs in YAML)
 * - Uses Entity Registry unique_id patterns from your custom component felshare_cloud
 * - Removes the numeric device id from visible names (friendly-name cleanup)
 *
 * Type: custom:felshare-device-card
 */

const CARD_TYPE = "felshare-device-card";

const DEFAULTS = Object.freeze({
  // Entity Registry `platform` values to treat as Felshare.
  platforms: ["felshare_cloud"],

  title: "Felshare Diffuser",

  // Default picture requested by you (external URL).
  picture: "https://s.alicdn.com/@sc04/kf/H517180dda7c84f708a6cd9ab9475a103u.jpg",
  show_picture: true,

  // If multiple Felshare devices exist, show a dropdown selector inside the card.
  show_device_picker: true,

  // Optional diagnostics section
  show_other_entities: false,
  max_other_entities: 12,
});

/** Helpers */
const uidEnds = (entry, suffix) => {
  const u = (entry?.unique_id || "").toLowerCase();
  return u.endsWith(`_${String(suffix).toLowerCase()}`);
};

const entEnds = (entry, suffix) => {
  const e = (entry?.entity_id || "").toLowerCase();
  return e.endsWith(`_${String(suffix).toLowerCase()}`);
};

const first = (list, pred) => list.find(pred) || null;
const many = (list, pred) => list.filter(pred);

function isDigitsOnly(s) {
  return /^[0-9]+$/.test(String(s || ""));
}

function stripLeadingDeviceId(name) {
  // Friendly name example: "229070733364532 HVAC sync airflow"
  // -> "HVAC sync airflow"
  return String(name || "").replace(/^\s*\d{6,}\s*[-_:]?\s*/g, "");
}

class FelshareDeviceCard extends HTMLElement {
  static getStubConfig() {
    return { ...DEFAULTS };
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...(config || {}) };
    this._selectedKey = null;
    this._helpers = null;
    this._loading = null;

    this._entriesByKey = new Map();    // key -> [{entity_id, unique_id, device_id, platform, original_name}]
    this._labelByKey = new Map();      // key -> pretty label
    this._keys = [];

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.appendChild(this._style());
      this._root = document.createElement("div");
      this.shadowRoot.appendChild(this._root);
    }

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._childCard) this._childCard.hass = hass;
    this._ensureData().then(() => this._render());
  }

  getCardSize() {
    return 7;
  }

  _style() {
    const s = document.createElement("style");
    s.textContent = `
      :host { display:block; }
      ha-card { overflow:hidden; }

      .picture {
        width: 100%;
        height: 160px;
        object-fit: cover;
        display: block;
      }
      .header {
        display:flex;
        gap: 12px;
        align-items:center;
        padding: 14px 16px 10px 16px;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        line-height: 1.2;
      }
      .sub {
        font-size: 12px;
        opacity: 0.75;
        margin-top: 2px;
      }
      .picker { margin-left:auto; }
      select {
        font: inherit;
        padding: 6px 8px;
        border-radius: 10px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        color: var(--primary-text-color);
        outline: none;
      }
      .content { padding: 0 10px 12px 10px; }

      /* Make inner cards look like sections (less “card-in-card”) */
      .content ha-card {
        box-shadow: none !important;
        background: transparent !important;
        border: 0 !important;
      }
      .content .card-content {
        padding-left: 6px !important;
        padding-right: 6px !important;
      }

      .note {
        padding: 14px 16px 18px 16px;
        opacity: 0.8;
      }
    `;
    return s;
  }

  async _ensureHelpers() {
    if (!this._helpers) this._helpers = await window.loadCardHelpers();
    return this._helpers;
  }

  _escape(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  _deviceIdFromEntityId(entityId) {
    // Example: switch.229070733364532_fan -> 229070733364532
    const m = String(entityId || "").match(/^[^.]+\.(\d{6,})_/);
    return m ? m[1] : null;
  }

  _friendlyName(entityId, fallback) {
    const st = this._hass?.states?.[entityId];
    const fn = st?.attributes?.friendly_name;
    return stripLeadingDeviceId(fn || fallback || entityId);
  }

  _state(entityId) {
    const st = this._hass?.states?.[entityId];
    return st?.state ?? "";
  }

  async _ensureData() {
    if (!this._hass) return;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      const [entityReg, deviceReg] = await Promise.all([
        this._hass.callWS({ type: "config/entity_registry/list" }),
        this._hass.callWS({ type: "config/device_registry/list" }),
      ]);

      const deviceNameById = new Map();
      for (const d of deviceReg || []) {
        deviceNameById.set(d.id, d.name_by_user || d.name || d.model || d.id);
      }

      const platforms = new Set(this._config.platforms || DEFAULTS.platforms);
      const felshare = (entityReg || []).filter((e) => platforms.has(e.platform));

      const byKey = new Map();
      const labelByKey = new Map();

      // Prefer HA device_id as grouping key; fallback to numeric device id from entity_id
      for (const e of felshare) {
        const key = e.device_id || this._deviceIdFromEntityId(e.entity_id) || "__unknown__";
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({
          entity_id: e.entity_id,
          unique_id: e.unique_id,
          platform: e.platform,
          device_id: e.device_id,
          original_name: e.original_name || e.name || null,
        });

        if (!labelByKey.has(key)) {
          let label = null;
          if (e.device_id) {
            label = deviceNameById.get(e.device_id);
          } else {
            label = this._deviceIdFromEntityId(e.entity_id);
          }
          labelByKey.set(key, label || "Felshare Diffuser");
        }
      }

      // Fallback: scan hass.states for numeric-prefix entities
      if (byKey.size === 0) {
        const pattern = /^(switch|number|select|sensor|text|button|time)\.\d{6,}_/;
        const ids = Object.keys(this._hass.states || {}).filter((id) => pattern.test(id));
        for (const id of ids) {
          const key = this._deviceIdFromEntityId(id) || "__unknown__";
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key).push({ entity_id: id, unique_id: null, platform: null, device_id: null, original_name: null });
          if (!labelByKey.has(key)) labelByKey.set(key, key);
        }
      }

      // Sort for stable UI
      for (const [k, list] of byKey.entries()) {
        list.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
      }

      // Build pretty labels: if the device name is only digits, show "Diffuser • 4532"
      const prettyLabel = (key) => {
        const raw = labelByKey.get(key) || key;
        const asStr = String(raw || "");
        if (isDigitsOnly(asStr)) return `Diffuser • ${asStr.slice(-4)}`;
        if (isDigitsOnly(String(key))) return `Diffuser • ${String(key).slice(-4)}`;
        return stripLeadingDeviceId(asStr) || "Felshare Diffuser";
      };

      this._entriesByKey = byKey;
      this._labelByKey = new Map(Array.from(byKey.keys()).map((k) => [k, prettyLabel(k)]));
      this._keys = Array.from(byKey.keys()).filter((k) => k !== "__unknown__");
      if (this._keys.length === 0 && byKey.has("__unknown__")) this._keys = ["__unknown__"];

      if (!this._selectedKey) this._selectedKey = this._keys[0] || null;
    })();

    return this._loading;
  }

  _matchModel(entries) {
    // Match using unique_id suffixes from felshare_cloud integration
    const model = {};

    // Switches
    model.power = first(entries, (x) => uidEnds(x, "power") || entEnds(x, "power"))?.entity_id || null;
    model.fan = first(entries, (x) => uidEnds(x, "fan") || entEnds(x, "fan"))?.entity_id || null;

    model.work_enabled = first(entries, (x) => uidEnds(x, "work_enabled") || entEnds(x, "00_work_schedule") || entEnds(x, "work_enabled"))?.entity_id || null;

    const dayMap = {
      mon: ["work_day_mon", "05_work_day_mon"],
      tue: ["work_day_tue", "05_work_day_tue"],
      wed: ["work_day_wed", "05_work_day_wed"],
      thu: ["work_day_thu", "05_work_day_thu"],
      fri: ["work_day_fri", "05_work_day_fri"],
      sat: ["work_day_sat", "05_work_day_sat"],
      sun: ["work_day_sun", "05_work_day_sun"],
    };
    model.work_days = {};
    for (const [k, suffixes] of Object.entries(dayMap)) {
      const ent = first(entries, (x) => suffixes.some((s) => uidEnds(x, s) || entEnds(x, s)));
      model.work_days[k] = ent?.entity_id || null;
    }

    model.hvac_sync_enabled = first(entries, (x) => uidEnds(x, "hvac_sync_enabled") || entEnds(x, "89_hvac_sync") || entEnds(x, "hvac_sync_enabled"))?.entity_id || null;

    // Selects
    model.hvac_thermostat = first(entries, (x) => uidEnds(x, "hvac_sync_thermostat") || entEnds(x, "90_hvac_sync_thermostat") || entEnds(x, "hvac_sync_thermostat"))?.entity_id || null;
    model.hvac_airflow = first(entries, (x) => uidEnds(x, "hvac_sync_airflow_mode") || entEnds(x, "88_hvac_sync_airflow") || entEnds(x, "hvac_sync_airflow_mode"))?.entity_id || null;

    // Time
    model.hvac_start = first(entries, (x) => uidEnds(x, "hvac_sync_start") || entEnds(x, "91_hvac_sync_start") || entEnds(x, "hvac_sync_start"))?.entity_id || null;
    model.hvac_end = first(entries, (x) => uidEnds(x, "hvac_sync_end") || entEnds(x, "92_hvac_sync_end") || entEnds(x, "hvac_sync_end"))?.entity_id || null;

    // Numbers
    model.consumption = first(entries, (x) => uidEnds(x, "consumption") || entEnds(x, "consumption"))?.entity_id || null;
    model.capacity = first(entries, (x) => uidEnds(x, "capacity") || entEnds(x, "capacity"))?.entity_id || null;
    model.remain_oil = first(entries, (x) => uidEnds(x, "remain_oil") || entEnds(x, "remain_oil"))?.entity_id || null;

    model.work_run_s = first(entries, (x) => uidEnds(x, "work_run_s") || entEnds(x, "03_work_run_s") || entEnds(x, "work_run_s"))?.entity_id || null;
    model.work_stop_s = first(entries, (x) => uidEnds(x, "work_stop_s") || entEnds(x, "04_work_stop_s") || entEnds(x, "work_stop_s"))?.entity_id || null;

    model.hvac_on_delay_s = first(entries, (x) => uidEnds(x, "hvac_sync_on_delay_s") || entEnds(x, "94_hvac_sync_on_delay_s") || entEnds(x, "hvac_sync_on_delay_s"))?.entity_id || null;
    model.hvac_off_delay_s = first(entries, (x) => uidEnds(x, "hvac_sync_off_delay_s") || entEnds(x, "95_hvac_sync_off_delay_s") || entEnds(x, "hvac_sync_off_delay_s"))?.entity_id || null;

    // Text
    model.oil_name = first(entries, (x) => uidEnds(x, "oil_name") || entEnds(x, "oil_name"))?.entity_id || null;
    model.work_start = first(entries, (x) => uidEnds(x, "work_start") || entEnds(x, "01_work_start") || entEnds(x, "work_start"))?.entity_id || null;
    model.work_end = first(entries, (x) => uidEnds(x, "work_end") || entEnds(x, "02_work_end") || entEnds(x, "work_end"))?.entity_id || null;

    // Sensors
    model.mqtt_status = first(entries, (x) => uidEnds(x, "mqtt_status") || entEnds(x, "mqtt_status"))?.entity_id || null;
    model.liquid_level = first(entries, (x) => uidEnds(x, "liquid_level") || entEnds(x, "liquid_level"))?.entity_id || null;
    model.work_schedule = first(entries, (x) => uidEnds(x, "work_schedule") || entEnds(x, "work_schedule"))?.entity_id || null;

    // Button
    model.refresh = first(entries, (x) => uidEnds(x, "refresh") || /_refresh$/i.test(x.entity_id))?.entity_id || null;

    // Track used entities
    const used = new Set(
      Object.values(model.work_days || {})
        .concat([
          model.power, model.fan, model.work_enabled, model.hvac_sync_enabled,
          model.hvac_thermostat, model.hvac_airflow, model.hvac_start, model.hvac_end,
          model.consumption, model.capacity, model.remain_oil,
          model.work_run_s, model.work_stop_s, model.hvac_on_delay_s, model.hvac_off_delay_s,
          model.oil_name, model.work_start, model.work_end,
          model.mqtt_status, model.liquid_level, model.work_schedule, model.refresh,
        ])
        .filter(Boolean)
    );

    model._other_entries = entries.filter((e) => !used.has(e.entity_id));
    return model;
  }

  _buildHeaderSubtitle(model) {
    // Show a clean subtitle without numeric device id
    const parts = [];
    if (model?.mqtt_status) parts.push(`MQTT: ${this._state(model.mqtt_status)}`);
    if (model?.liquid_level) parts.push(`Level: ${this._state(model.liquid_level)}%`);
    if (parts.length) return parts.join(" · ");
    return "Ready";
  }

  _entitiesCard(title, rows) {
    const entities = rows.filter(Boolean);
    if (!entities.length) return null;
    return { type: "entities", title, show_header_toggle: false, entities };
  }

  _buttonCard(entity, name, icon, tap_action) {
    if (!entity) return null;
    return {
      type: "button",
      entity,
      name,
      icon,
      show_state: false,
      tap_action: tap_action || { action: "toggle" },
    };
  }

  async _buildChildCard(key) {
    const helpers = await this._ensureHelpers();
    const entries = (this._entriesByKey.get(key) || []).slice();
    if (!entries.length) return null;

    const model = this._matchModel(entries);

    const quick = [
      this._buttonCard(model.power, "Power", "mdi:power"),
      this._buttonCard(model.fan, "Fan", "mdi:fan"),
      this._buttonCard(model.work_enabled, "Schedule", "mdi:calendar-clock"),
      this._buttonCard(model.hvac_sync_enabled, "HVAC", "mdi:hvac"),
      model.refresh
        ? this._buttonCard(
            model.refresh,
            "Refresh",
            "mdi:refresh",
            { action: "call-service", service: "button.press", target: { entity_id: model.refresh } }
          )
        : null,
    ].filter(Boolean);

    const cards = [];

    if (quick.length) {
      cards.push({ type: "grid", columns: 5, square: false, cards: quick });
    }

    const status = this._entitiesCard("Status", [
      model.mqtt_status && { entity: model.mqtt_status, name: "MQTT status", icon: "mdi:cloud-check" },
      model.liquid_level && { entity: model.liquid_level, name: "Liquid level", icon: "mdi:gauge" },
      model.work_schedule && { entity: model.work_schedule, name: "Work schedule", icon: "mdi:calendar-clock" },
    ]);
    if (status) cards.push(status);

    const diffusion = this._entitiesCard("Diffusion", [
      model.consumption && { entity: model.consumption, name: "Consumption (ml/h)", icon: "mdi:water" },
      model.work_run_s && { entity: model.work_run_s, name: "Work run (s)", icon: "mdi:timer-outline" },
      model.work_stop_s && { entity: model.work_stop_s, name: "Work stop (s)", icon: "mdi:timer-stop-outline" },
    ]);
    if (diffusion) cards.push(diffusion);

    const oil = this._entitiesCard("Oil", [
      model.oil_name && { entity: model.oil_name, name: "Oil name", icon: "mdi:flower" },
      model.capacity && { entity: model.capacity, name: "Capacity (ml)", icon: "mdi:cup-water" },
      model.remain_oil && { entity: model.remain_oil, name: "Remaining (ml)", icon: "mdi:cup-water" },
    ]);
    if (oil) cards.push(oil);

    const schedule = this._entitiesCard("Schedule", [
      model.work_start && { entity: model.work_start, name: "Work start", icon: "mdi:clock-start" },
      model.work_end && { entity: model.work_end, name: "Work end", icon: "mdi:clock-end" },
    ]);
    if (schedule) cards.push(schedule);

    const dayTiles = [
      model.work_days?.mon && { type: "tile", entity: model.work_days.mon, name: "M", hide_state: true },
      model.work_days?.tue && { type: "tile", entity: model.work_days.tue, name: "T", hide_state: true },
      model.work_days?.wed && { type: "tile", entity: model.work_days.wed, name: "W", hide_state: true },
      model.work_days?.thu && { type: "tile", entity: model.work_days.thu, name: "T", hide_state: true },
      model.work_days?.fri && { type: "tile", entity: model.work_days.fri, name: "F", hide_state: true },
      model.work_days?.sat && { type: "tile", entity: model.work_days.sat, name: "S", hide_state: true },
      model.work_days?.sun && { type: "tile", entity: model.work_days.sun, name: "S", hide_state: true },
    ].filter(Boolean);
    if (dayTiles.length) cards.push({ type: "grid", columns: 7, square: false, cards: dayTiles });

    const hvac = this._entitiesCard("HVAC Sync", [
      model.hvac_thermostat && { entity: model.hvac_thermostat, name: "Thermostat", icon: "mdi:thermostat" },
      model.hvac_airflow && { entity: model.hvac_airflow, name: "Airflow", icon: "mdi:fan-auto" },
      model.hvac_start && { entity: model.hvac_start, name: "Start time", icon: "mdi:clock-start" },
      model.hvac_end && { entity: model.hvac_end, name: "End time", icon: "mdi:clock-end" },
      model.hvac_on_delay_s && { entity: model.hvac_on_delay_s, name: "ON delay (s)", icon: "mdi:timer-play-outline" },
      model.hvac_off_delay_s && { entity: model.hvac_off_delay_s, name: "OFF delay (s)", icon: "mdi:timer-stop-outline" },
    ]);
    if (hvac) cards.push(hvac);

    if (this._config.show_other_entities && model._other_entries?.length) {
      const rows = model._other_entries.slice(0, this._config.max_other_entities || DEFAULTS.max_other_entities).map((e) => ({
        entity: e.entity_id,
        name: this._friendlyName(e.entity_id, e.original_name),
      }));
      cards.push({
        type: "entities",
        title: "Other entities",
        show_header_toggle: false,
        entities: rows,
      });
    }

    const stackConfig = { type: "vertical-stack", cards };
    const el = await helpers.createCardElement(stackConfig);
    el.hass = this._hass;

    // Save for header subtitle
    this._lastModel = model;
    return el;
  }

  async _render() {
    if (!this._root || !this._config) return;

    if (this._hass) await this._ensureData();

    const keys = this._keys || [];
    const hasDevices = keys.length > 0;
    const key = this._selectedKey;

    const pictureHtml =
      this._config.show_picture && this._config.picture
        ? `<img class="picture" src="${this._escape(this._config.picture)}" />`
        : "";

    const pickerHtml =
      this._config.show_device_picker && hasDevices && keys.length > 1
        ? `
          <div class="picker">
            <select id="devpicker">
              ${keys
                .map((k) => {
                  const sel = k === key ? "selected" : "";
                  return `<option value="${this._escape(k)}" ${sel}>${this._escape(this._labelByKey.get(k) || k)}</option>`;
                })
                .join("")}
            </select>
          </div>
        `
        : "";

    const subtitle = this._lastModel ? this._buildHeaderSubtitle(this._lastModel) : (hasDevices ? "Ready" : "No device found");

    this._root.innerHTML = `
      <ha-card>
        ${pictureHtml}
        <div class="header">
          <div>
            <div class="title">${this._escape(this._config.title || DEFAULTS.title)}</div>
            <div class="sub">${this._escape(subtitle)}</div>
          </div>
          ${pickerHtml}
        </div>
        <div class="content" id="content"></div>
        ${
          !hasDevices
            ? `<div class="note">No encontré entidades de Felshare. Verifica que la integración esté cargada y que el platform sea: ${(this._config.platforms || DEFAULTS.platforms).join(", ")}.</div>`
            : ""
        }
      </ha-card>
    `;

    const picker = this._root.querySelector("#devpicker");
    if (picker) {
      picker.addEventListener("change", async (ev) => {
        this._selectedKey = ev.target.value;
        this._childCard = null;
        this._childKey = null;
        this._lastModel = null;
        await this._render();
      });
    }

    const content = this._root.querySelector("#content");
    if (!content || !hasDevices) return;

    if (!this._childCard || this._childKey !== key) {
      this._childKey = key;
      this._childCard = await this._buildChildCard(key);
      // Re-render header subtitle after model is known
      await this._render();
      return;
    }

    content.innerHTML = "";
    if (this._childCard) {
      this._childCard.hass = this._hass;
      content.appendChild(this._childCard);
    } else {
      content.innerHTML = `<div class="note">No hay entidades para este dispositivo.</div>`;
    }
  }
}

customElements.define(CARD_TYPE, FelshareDeviceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: "Felshare Device Card (Auto)",
  description: "Auto-detect Felshare devices/entities and build a full control UI without YAML edits.",
});

console.info("%cFELSHARE-DEVICE-CARD%c v3 Loaded", "color: white; background: #03a9f4; font-weight: 700;", "color: #03a9f4;");
