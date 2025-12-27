/* felshare-device-card.js
 * Felshare Device Card (Auto)
 * - No YAML edits required: auto-detects Felshare (Cloud MQTT) entities via Entity Registry
 * - Builds a clean UI with core cards: tiles + entities
 *
 * Type: custom:felshare-device-card
 */

const CARD_TYPE = "felshare-device-card";

const DEFAULTS = Object.freeze({
  // Entity Registry `platform` values to treat as Felshare.
  // Your custom component domain is "felshare_cloud", and the entity registry platform is typically the same.
  platforms: ["felshare_cloud"],

  title: "Felshare Diffuser",
  picture: "/local/felshare/diffuser-header.jpg",
  show_picture: true,

  // If multiple Felshare devices exist, show a dropdown selector inside the card (still no YAML edits).
  show_device_picker: true,
});

/** Utility helpers */
const endsWithSuffix = (entityId, suffix) => {
  if (!entityId) return false;
  return entityId.toLowerCase().endsWith(`_${suffix.toLowerCase()}`);
};

const findOne = (entities, predicate) => entities.find((e) => predicate(e)) || null;
const findMany = (entities, predicate) => entities.filter((e) => predicate(e));

class FelshareDeviceCard extends HTMLElement {
  static getStubConfig() {
    return { ...DEFAULTS };
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...(config || {}) };
    this._selectedDeviceKey = null;
    this._helpers = null;
    this._loading = null;
    this._entitiesByDeviceKey = new Map();
    this._deviceNameByKey = new Map();

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
        height: 140px;
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
      .content {
        padding: 0 10px 12px 10px;
      }

      /* Make inner cards feel like sections (less "card-in-card") */
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

  _parseNumericDeviceFromEntity(entityId) {
    // Example: switch.229070733364532_fan -> 229070733364532
    const m = String(entityId || "").match(/^[^.]+\.(\d{6,})_/);
    return m ? m[1] : null;
  }

  async _ensureData() {
    if (!this._hass) return;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      // Prefer Entity Registry + Device Registry
      const [entityReg, deviceReg] = await Promise.all([
        this._hass.callWS({ type: "config/entity_registry/list" }),
        this._hass.callWS({ type: "config/device_registry/list" }),
      ]);

      const deviceNameById = new Map();
      for (const d of deviceReg) {
        deviceNameById.set(d.id, d.name_by_user || d.name || d.model || d.id);
      }

      const platforms = new Set(this._config.platforms || DEFAULTS.platforms);
      const felshareEntries = (entityReg || []).filter((e) => platforms.has(e.platform));

      const byKey = new Map(); // key: device_id (preferred) or numeric prefix
      const nameByKey = new Map();

      for (const e of felshareEntries) {
        const entId = e.entity_id;
        const key = e.device_id || this._parseNumericDeviceFromEntity(entId) || "__unknown__";
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(entId);

        if (!nameByKey.has(key)) {
          const nm = e.device_id ? deviceNameById.get(e.device_id) : (this._parseNumericDeviceFromEntity(entId) || "Felshare");
          if (nm) nameByKey.set(key, nm);
        }
      }

      // Fallback: if registry filter finds nothing, scan hass.states for numeric-prefix entities
      if (byKey.size === 0) {
        const pattern = /^(switch|number|select|sensor|text|button|time)\.\d{6,}_/;
        const entIds = Object.keys(this._hass.states || {}).filter((id) => pattern.test(id));
        for (const id of entIds) {
          const key = this._parseNumericDeviceFromEntity(id) || "__unknown__";
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key).push(id);
          if (!nameByKey.has(key)) nameByKey.set(key, key);
        }
      }

      // Normalize list order for stable UI
      for (const [k, list] of byKey.entries()) {
        list.sort((a, b) => a.localeCompare(b));
      }

      this._entitiesByDeviceKey = byKey;
      this._deviceNameByKey = nameByKey;
      this._deviceKeys = Array.from(byKey.keys()).filter((k) => k !== "__unknown__");
      if (this._deviceKeys.length === 0 && byKey.has("__unknown__")) this._deviceKeys = ["__unknown__"];

      if (!this._selectedDeviceKey) this._selectedDeviceKey = this._deviceKeys[0] || null;
    })();

    return this._loading;
  }

  _labelForKey(key) {
    if (!key) return "";
    return this._deviceNameByKey.get(key) || key;
  }

  _buildFelshareModel(entities) {
    // Exact suffixes from your custom component:
    // switches: power, fan, 00_work_schedule, 05_work_day_*, 89_hvac_sync
    // numbers: consumption, capacity, remain_oil, 03_work_run_s, 04_work_stop_s, 94_hvac_sync_on_delay_s, 95_hvac_sync_off_delay_s
    // text: oil_name, 01_work_start, 02_work_end
    // selects: 88_hvac_sync_airflow, 90_hvac_sync_thermostat
    // time: 91_hvac_sync_start, 92_hvac_sync_end
    // sensors: mqtt_status, liquid_level, work_schedule
    const model = {};

    model.power = findOne(entities, (e) => endsWithSuffix(e, "power"));
    model.fan = findOne(entities, (e) => endsWithSuffix(e, "fan"));

    model.work_schedule = findOne(entities, (e) => endsWithSuffix(e, "00_work_schedule"));
    model.work_days = {
      mon: findOne(entities, (e) => endsWithSuffix(e, "05_work_day_mon")),
      tue: findOne(entities, (e) => endsWithSuffix(e, "05_work_day_tue")),
      wed: findOne(entities, (e) => endsWithSuffix(e, "05_work_day_wed")),
      thu: findOne(entities, (e) => endsWithSuffix(e, "05_work_day_thu")),
      fri: findOne(entities, (e) => endsWithSuffix(e, "05_work_day_fri")),
      sat: findOne(entities, (e) => endsWithSuffix(e, "05_work_day_sat")),
      sun: findOne(entities, (e) => endsWithSuffix(e, "05_work_day_sun")),
    };

    model.hvac_sync = findOne(entities, (e) => endsWithSuffix(e, "89_hvac_sync"));
    model.hvac_airflow = findOne(entities, (e) => endsWithSuffix(e, "88_hvac_sync_airflow"));
    model.hvac_thermostat = findOne(entities, (e) => endsWithSuffix(e, "90_hvac_sync_thermostat"));
    model.hvac_start = findOne(entities, (e) => endsWithSuffix(e, "91_hvac_sync_start"));
    model.hvac_end = findOne(entities, (e) => endsWithSuffix(e, "92_hvac_sync_end"));
    model.hvac_on_delay = findOne(entities, (e) => endsWithSuffix(e, "94_hvac_sync_on_delay_s"));
    model.hvac_off_delay = findOne(entities, (e) => endsWithSuffix(e, "95_hvac_sync_off_delay_s"));

    model.consumption = findOne(entities, (e) => endsWithSuffix(e, "consumption"));
    model.work_run = findOne(entities, (e) => endsWithSuffix(e, "03_work_run_s"));
    model.work_stop = findOne(entities, (e) => endsWithSuffix(e, "04_work_stop_s"));

    model.oil_name = findOne(entities, (e) => endsWithSuffix(e, "oil_name"));
    model.capacity = findOne(entities, (e) => endsWithSuffix(e, "capacity"));
    model.remain_oil = findOne(entities, (e) => endsWithSuffix(e, "remain_oil"));

    model.work_start = findOne(entities, (e) => endsWithSuffix(e, "01_work_start"));
    model.work_end = findOne(entities, (e) => endsWithSuffix(e, "02_work_end"));

    // Sensors (no suggested_object_id, but unique_id suffixes are consistent; entity_id ends with same)
    model.mqtt_status = findOne(entities, (e) => endsWithSuffix(e, "mqtt_status"));
    model.liquid_level = findOne(entities, (e) => endsWithSuffix(e, "liquid_level"));
    model.work_schedule_info = findOne(entities, (e) => endsWithSuffix(e, "work_schedule"));

    // Button (unique_id ends _refresh; entity_id usually ends _refresh or _refresh_status)
    model.refresh = findOne(entities, (e) => e.startsWith("button.") && /_refresh(_status)?$/i.test(e));

    // Any other entities (for optional diagnostics section)
    model._others = entities.filter((e) => ![
      model.power, model.fan, model.work_schedule, model.hvac_sync,
      model.hvac_airflow, model.hvac_thermostat, model.hvac_start, model.hvac_end,
      model.hvac_on_delay, model.hvac_off_delay, model.consumption, model.work_run, model.work_stop,
      model.oil_name, model.capacity, model.remain_oil, model.work_start, model.work_end,
      model.mqtt_status, model.liquid_level, model.work_schedule_info, model.refresh,
      ...Object.values(model.work_days)
    ].filter(Boolean).includes(e));

    return model;
  }

  _sectionEntities(title, rows) {
    const entities = rows.filter(Boolean);
    if (entities.length === 0) return null;
    return {
      type: "entities",
      title,
      show_header_toggle: false,
      entities,
    };
  }

  _tile(entity, name, icon) {
    if (!entity) return null;
    const t = { type: "tile", entity };
    if (name) t.name = name;
    if (icon) t.icon = icon;
    return t;
  }

  _buildStackConfigForModel(model) {
    const cards = [];

    // Quick actions
    const quick = [
      this._tile(model.power, "Power", "mdi:power"),
      this._tile(model.fan, "Fan", "mdi:fan"),
      this._tile(model.work_schedule, "Schedule", "mdi:calendar-clock"),
      this._tile(model.hvac_sync, "HVAC Sync", "mdi:hvac"),
      this._tile(model.refresh, "Refresh", "mdi:refresh"),
    ].filter(Boolean);

    if (quick.length) {
      cards.push({
        type: "grid",
        columns: 5,
        square: false,
        cards: quick,
      });
    }

    // Status
    const status = this._sectionEntities("Status", [
      model.mqtt_status && { entity: model.mqtt_status, name: "MQTT status", icon: "mdi:cloud-check" },
      model.liquid_level && { entity: model.liquid_level, name: "Liquid level", icon: "mdi:gauge" },
      model.work_schedule_info && { entity: model.work_schedule_info, name: "Work schedule", icon: "mdi:calendar-clock" },
    ]);
    if (status) cards.push(status);

    // Diffusion
    const diffusion = this._sectionEntities("Diffusion", [
      model.consumption && { entity: model.consumption, name: "Consumption", icon: "mdi:water" },
      model.work_run && { entity: model.work_run, name: "Work run (s)", icon: "mdi:timer-outline" },
      model.work_stop && { entity: model.work_stop, name: "Work stop (s)", icon: "mdi:timer-stop-outline" },
    ]);
    if (diffusion) cards.push(diffusion);

    // Oil
    const oil = this._sectionEntities("Oil", [
      model.oil_name && { entity: model.oil_name, name: "Oil name", icon: "mdi:flower" },
      model.capacity && { entity: model.capacity, name: "Oil capacity (ml)", icon: "mdi:cup-water" },
      model.remain_oil && { entity: model.remain_oil, name: "Remaining oil (ml)", icon: "mdi:cup-water" },
    ]);
    if (oil) cards.push(oil);

    // Schedule
    const schedule = this._sectionEntities("Schedule", [
      model.work_start && { entity: model.work_start, name: "Work start (HH:MM)", icon: "mdi:clock-start" },
      model.work_end && { entity: model.work_end, name: "Work end (HH:MM)", icon: "mdi:clock-end" },
    ]);
    if (schedule) cards.push(schedule);

    const dayTiles = [
      this._tile(model.work_days.mon, "M"),
      this._tile(model.work_days.tue, "T"),
      this._tile(model.work_days.wed, "W"),
      this._tile(model.work_days.thu, "T"),
      this._tile(model.work_days.fri, "F"),
      this._tile(model.work_days.sat, "S"),
      this._tile(model.work_days.sun, "S"),
    ].filter(Boolean);

    if (dayTiles.length) {
      cards.push({
        type: "grid",
        columns: 7,
        square: false,
        cards: dayTiles,
      });
    }

    // HVAC Sync
    const hvac = this._sectionEntities("HVAC Sync", [
      model.hvac_thermostat && { entity: model.hvac_thermostat, name: "Thermostat", icon: "mdi:thermostat" },
      model.hvac_airflow && { entity: model.hvac_airflow, name: "Airflow", icon: "mdi:fan-auto" },
      model.hvac_start && { entity: model.hvac_start, name: "Start time", icon: "mdi:clock-start" },
      model.hvac_end && { entity: model.hvac_end, name: "End time", icon: "mdi:clock-end" },
      model.hvac_on_delay && { entity: model.hvac_on_delay, name: "ON delay (s)", icon: "mdi:timer-play-outline" },
      model.hvac_off_delay && { entity: model.hvac_off_delay, name: "OFF delay (s)", icon: "mdi:timer-stop-outline" },
    ]);
    if (hvac) cards.push(hvac);

    // Optional: show remaining entities if something changes in future releases
    if (model._others && model._others.length) {
      cards.push({
        type: "entities",
        title: "Other entities",
        show_header_toggle: false,
        entities: model._others.slice(0, 10),
      });
    }

    return { type: "vertical-stack", cards };
  }

  async _buildChildCard(deviceKey) {
    if (!this._hass) return null;

    const helpers = await this._ensureHelpers();
    const entities = (this._entitiesByDeviceKey.get(deviceKey) || []).slice();

    if (!entities.length) return null;

    const model = this._buildFelshareModel(entities);
    const stackConfig = this._buildStackConfigForModel(model);

    const el = await helpers.createCardElement(stackConfig);
    el.hass = this._hass;
    return el;
  }

  async _render() {
    if (!this._root || !this._config) return;

    if (this._hass) await this._ensureData();

    const keys = this._deviceKeys || [];
    const hasDevices = keys.length > 0;
    const key = this._selectedDeviceKey;

    const pictureHtml =
      this._config.show_picture && this._config.picture
        ? `<img class="picture" src="${this._config.picture}" />`
        : "";

    const pickerHtml =
      this._config.show_device_picker && hasDevices && keys.length > 1
        ? `
          <div class="picker">
            <select id="devpicker">
              ${keys
                .map((k) => {
                  const sel = k === key ? "selected" : "";
                  return `<option value="${this._escape(k)}" ${sel}>${this._escape(this._labelForKey(k))}</option>`;
                })
                .join("")}
            </select>
          </div>
        `
        : "";

    this._root.innerHTML = `
      <ha-card>
        ${pictureHtml}
        <div class="header">
          <div>
            <div class="title">${this._escape(this._config.title || DEFAULTS.title)}</div>
            <div class="sub">${hasDevices ? this._escape(this._labelForKey(key || "")) : "No Felshare device found"}</div>
          </div>
          ${pickerHtml}
        </div>
        <div class="content" id="content"></div>
        ${!hasDevices ? `<div class="note">No encontré entidades de Felshare. Verifica que la integración esté cargada y que el platform sea: ${(this._config.platforms || DEFAULTS.platforms).join(", ")}.</div>` : ""}
      </ha-card>
    `;

    const picker = this._root.querySelector("#devpicker");
    if (picker) {
      picker.addEventListener("change", async (ev) => {
        this._selectedDeviceKey = ev.target.value;
        this._childCard = null;
        this._childKey = null;
        await this._render();
      });
    }

    const content = this._root.querySelector("#content");
    if (!content || !hasDevices) return;

    if (!this._childCard || this._childKey !== key) {
      this._childKey = key;
      this._childCard = await this._buildChildCard(key);
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

// Show in card picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: "Felshare Device Card (Auto)",
  description: "Auto-detect Felshare Cloud MQTT devices and build a full control UI without YAML edits.",
});

console.info("%cFELSHARE-DEVICE-CARD%c v2 Loaded", "color: white; background: #03a9f4; font-weight: 700;", "color: #03a9f4;");
