/* felshare-device-card.js
 * Felshare Device Card (Auto) - v6
 *
 * Supports:
 * - felshare_cloud (Cloud MQTT)
 * - felshare_ble   (Bluetooth / BLE)
 *
 * Improvements (requested):
 * - If the selected device is BLE, the header title shows "(BLE)" automatically
 * - Device picker shows BLE devices as "BLE • 56:D2" (MAC short), not the full name
 *
 * Main card type: custom:felshare-device-card
 * Days row type: custom:felshare-days-row
 */

const MAIN_CARD_TYPE = "felshare-device-card";
const DAYS_ROW_TYPE = "felshare-days-row";

const DEFAULTS = Object.freeze({
  platforms: ["felshare_cloud", "felshare_ble"],

  title: "Felshare Diffuser",
  picture: "https://s.alicdn.com/@sc04/kf/H517180dda7c84f708a6cd9ab9475a103u.jpg",
  show_picture: true,
  show_device_picker: true,

  show_other_entities: false,
  max_other_entities: 12,
});

function isDigitsOnly(s) {
  return /^[0-9]+$/.test(String(s || ""));
}

function findMac(text) {
  const m = String(text || "").match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i);
  return m ? m[1].toUpperCase() : null;
}

function macShort(mac) {
  // "34:CD:B0:AF:56:D2" -> "56:D2" (last 5 chars incl colon)
  if (!mac) return null;
  return mac.slice(-5);
}

function stripLeadingDeviceId(name) {
  // "229070733364532 HVAC sync airflow" -> "HVAC sync airflow"
  return String(name || "").replace(/^\s*\d{6,}\s*[-_:]?\s*/g, "");
}

function stripBlePrefix(name) {
  // Remove common BLE-friendly-name prefixes:
  // "Felshare Diffuser (BLE) - 34:CD:B0:AF:56:D2 Power" -> "Power"
  // "34:CD:B0:AF:56:D2 Power" -> "Power"
  const mac = findMac(name);
  let out = String(name || "");
  if (mac) {
    const re1 = new RegExp(`^\\s*(?:Felshare.*?\\s*-\\s*)?${mac.replaceAll(":", "\\:")}\\s*[-_:]?\\s*`, "i");
    out = out.replace(re1, "");
  }
  // Also remove a leading "Felshare Diffuser (BLE)" without MAC if present
  out = out.replace(/^\s*Felshare\s+Diffuser\s*\(BLE\)\s*[-_:]?\s*/i, "");
  return out;
}

function prettyEntityName(raw) {
  let s = String(raw || "");
  s = stripLeadingDeviceId(s);
  s = stripBlePrefix(s);
  return s.trim();
}

// unique_id forms:
// - Cloud: "<deviceid>_power" (underscore)
// - BLE:   "<mac>-power_on" (dash)
const uidEnds = (entry, suffix) => {
  const u = String(entry?.unique_id || "").toLowerCase();
  const s = String(suffix || "").toLowerCase();
  return u.endsWith(`_${s}`) || u.endsWith(`-${s}`);
};

const entEnds = (entry, suffix) =>
  String(entry?.entity_id || "").toLowerCase().endsWith(`_${String(suffix || "").toLowerCase()}`);

const first = (list, pred) => list.find(pred) || null;

/** ---------- Days Row Mini Card ---------- */
class FelshareDaysRow extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
        :host { display:block; }
        ha-card { box-shadow:none !important; border:0 !important; background:transparent !important; }
        .wrap { padding: 6px 10px 2px 10px; }
        .title { font-weight: 700; font-size: 14px; margin: 4px 2px 8px 2px; opacity: .9; }
        .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
        .cell {
          display:flex; flex-direction: column; align-items:center; justify-content:center;
          padding: 8px 6px 10px 6px;
          border-radius: 14px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          cursor: pointer;
          user-select: none;
        }
        .lbl {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .6px;
          opacity: .85;
          margin-bottom: 6px;
        }
        .dot {
          width: 12px; height: 12px;
          border-radius: 50%;
          border: 2px solid var(--primary-text-color);
          opacity: .45;
        }
        .cell.on .dot {
          opacity: 1;
          border-color: var(--primary-color);
          background: var(--primary-color);
        }
      `;
      this.shadowRoot.appendChild(style);
      this._root = document.createElement("div");
      this.shadowRoot.appendChild(this._root);
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 1;
  }

  _state(entityId) {
    return this._hass?.states?.[entityId]?.state ?? "unknown";
  }

  _toggle(entityId) {
    if (!entityId || !this._hass) return;
    const [domain] = entityId.split(".");
    this._hass.callService(domain, "toggle", { entity_id: entityId });
  }

  _render() {
    if (!this._root || !this._config) return;

    const days = this._config.days || {};
    const labels = this._config.labels || {
      mon: "MON", tue: "TUE", wed: "WED", thu: "THU", fri: "FRI", sat: "SAT", sun: "SUN",
    };

    const order = ["mon","tue","wed","thu","fri","sat","sun"];
    const cells = order.map((k) => {
      const ent = days[k];
      if (!ent) return `<div></div>`;
      const on = this._state(ent) === "on";
      const cls = on ? "cell on" : "cell";
      const lbl = labels[k] || k.toUpperCase();
      return `
        <div class="${cls}" data-entity="${ent}">
          <div class="lbl">${lbl}</div>
          <div class="dot" aria-hidden="true"></div>
        </div>
      `;
    }).join("");

    const title = this._config.title ? `<div class="title">${this._config.title}</div>` : "";

    this._root.innerHTML = `
      <ha-card>
        <div class="wrap">
          ${title}
          <div class="grid">${cells}</div>
        </div>
      </ha-card>
    `;

    this._root.querySelectorAll(".cell").forEach((el) => {
      el.addEventListener("click", () => this._toggle(el.getAttribute("data-entity")));
    });
  }
}

customElements.define(DAYS_ROW_TYPE, FelshareDaysRow);

/** ---------- Main Auto Card ---------- */
class FelshareDeviceCard extends HTMLElement {
  static getStubConfig() {
    return { ...DEFAULTS };
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...(config || {}) };
    this._selectedKey = null;
    this._helpers = null;
    this._loading = null;

    this._entriesByKey = new Map();
    this._labelByKey = new Map();
    this._isBleByKey = new Map();
    this._macByKey = new Map();
    this._keys = [];
    this._lastModel = null;

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
      .picture { width: 100%; height: 160px; object-fit: cover; display: block; }
      .header { display:flex; gap: 12px; align-items:center; padding: 14px 16px 10px 16px; }
      .title { font-size: 16px; font-weight: 700; line-height: 1.2; }
      .sub { font-size: 12px; opacity: 0.75; margin-top: 2px; }
      .picker { margin-left:auto; }
      select {
        font: inherit; padding: 6px 8px; border-radius: 10px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        color: var(--primary-text-color);
        outline: none;
      }
      .content { padding: 0 10px 12px 10px; }
      .content ha-card { box-shadow: none !important; background: transparent !important; border: 0 !important; }
      .content .card-content { padding-left: 6px !important; padding-right: 6px !important; }
      .note { padding: 14px 16px 18px 16px; opacity: 0.8; }
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
    const m = String(entityId || "").match(/^[^.]+\.(\d{6,})_/);
    return m ? m[1] : null;
  }

  _state(entityId) {
    return this._hass?.states?.[entityId]?.state ?? "";
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
      const rawLabelByKey = new Map();
      const isBleByKey = new Map();
      const macByKey = new Map();

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

        // Track BLE by platform
        if (!isBleByKey.has(key)) isBleByKey.set(key, false);
        if (e.platform === "felshare_ble") isBleByKey.set(key, true);

        // Raw label (from device registry) to extract MAC
        if (!rawLabelByKey.has(key)) {
          let label = null;
          if (e.device_id) label = deviceNameById.get(e.device_id);
          else label = this._deviceIdFromEntityId(e.entity_id);
          rawLabelByKey.set(key, label || "Felshare Diffuser");
        }
      }

      // Determine MAC per key (from raw label or from any entry unique_id)
      for (const [k, entries] of byKey.entries()) {
        const raw = rawLabelByKey.get(k) || "";
        let mac = findMac(raw);
        if (!mac) {
          // Try unique_id
          for (const en of entries) {
            mac = findMac(en.unique_id);
            if (mac) break;
          }
        }
        if (mac) macByKey.set(k, mac);
      }

      // Registry fallback: scan hass.states for numeric cloud entities
      if (byKey.size === 0) {
        const pattern = /^(switch|number|select|sensor|text|button|time)\.\d{6,}_/;
        const ids = Object.keys(this._hass.states || {}).filter((id) => pattern.test(id));
        for (const id of ids) {
          const key = this._deviceIdFromEntityId(id) || "__unknown__";
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key).push({ entity_id: id, unique_id: null, platform: null, device_id: null, original_name: null });
          if (!rawLabelByKey.has(key)) rawLabelByKey.set(key, key);
          if (!isBleByKey.has(key)) isBleByKey.set(key, false);
        }
      }

      // Sort
      for (const [k, list] of byKey.entries()) list.sort((a, b) => a.entity_id.localeCompare(b.entity_id));

      const prettyLabel = (key) => {
        const raw = String(rawLabelByKey.get(key) || key || "");
        const isBle = Boolean(isBleByKey.get(key));
        const mac = macByKey.get(key) || findMac(raw);

        if (isBle && mac) return `BLE • ${macShort(mac)}`;
        if (isDigitsOnly(raw)) return `Cloud • ${raw.slice(-4)}`;
        if (isDigitsOnly(String(key))) return `Cloud • ${String(key).slice(-4)}`;
        return prettyEntityName(raw) || "Felshare Diffuser";
      };

      this._entriesByKey = byKey;
      this._labelByKey = new Map(Array.from(byKey.keys()).map((k) => [k, prettyLabel(k)]));
      this._isBleByKey = isBleByKey;
      this._macByKey = macByKey;

      this._keys = Array.from(byKey.keys()).filter((k) => k !== "__unknown__");
      if (this._keys.length === 0 && byKey.has("__unknown__")) this._keys = ["__unknown__"];

      if (!this._selectedKey) this._selectedKey = this._keys[0] || null;
    })();

    return this._loading;
  }

  _matchModel(entries) {
    const model = {};

    // Switches
    model.power = first(entries, (x) => uidEnds(x, "power") || uidEnds(x, "power_on") || entEnds(x, "power"))?.entity_id || null;
    model.fan = first(entries, (x) => uidEnds(x, "fan") || uidEnds(x, "fan_on") || entEnds(x, "fan"))?.entity_id || null;

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

    // Cloud HVAC group
    model.hvac_sync_enabled = first(entries, (x) => uidEnds(x, "hvac_sync_enabled") || entEnds(x, "89_hvac_sync") || entEnds(x, "hvac_sync_enabled"))?.entity_id || null;
    model.hvac_thermostat = first(entries, (x) => uidEnds(x, "hvac_sync_thermostat") || entEnds(x, "90_hvac_sync_thermostat") || entEnds(x, "hvac_sync_thermostat"))?.entity_id || null;
    model.hvac_airflow = first(entries, (x) => uidEnds(x, "hvac_sync_airflow_mode") || entEnds(x, "88_hvac_sync_airflow") || entEnds(x, "hvac_sync_airflow_mode"))?.entity_id || null;
    model.hvac_start = first(entries, (x) => uidEnds(x, "hvac_sync_start") || entEnds(x, "91_hvac_sync_start") || entEnds(x, "hvac_sync_start"))?.entity_id || null;
    model.hvac_end = first(entries, (x) => uidEnds(x, "hvac_sync_end") || entEnds(x, "92_hvac_sync_end") || entEnds(x, "hvac_sync_end"))?.entity_id || null;
    model.hvac_on_delay_s = first(entries, (x) => uidEnds(x, "hvac_sync_on_delay_s") || entEnds(x, "94_hvac_sync_on_delay_s") || entEnds(x, "hvac_sync_on_delay_s"))?.entity_id || null;
    model.hvac_off_delay_s = first(entries, (x) => uidEnds(x, "hvac_sync_off_delay_s") || entEnds(x, "95_hvac_sync_off_delay_s") || entEnds(x, "hvac_sync_off_delay_s"))?.entity_id || null;

    // Numbers
    model.consumption = first(entries, (x) => uidEnds(x, "consumption") || uidEnds(x, "oil_consumption_mlph") || entEnds(x, "consumption"))?.entity_id || null;
    model.capacity = first(entries, (x) => uidEnds(x, "capacity") || uidEnds(x, "oil_capacity_ml") || entEnds(x, "capacity"))?.entity_id || null;
    model.remain_oil = first(entries, (x) => uidEnds(x, "remain_oil") || uidEnds(x, "oil_remain_ml") || entEnds(x, "remain_oil"))?.entity_id || null;
    model.work_run_s = first(entries, (x) => uidEnds(x, "work_run_s") || entEnds(x, "03_work_run_s") || entEnds(x, "work_run_s"))?.entity_id || null;
    model.work_stop_s = first(entries, (x) => uidEnds(x, "work_stop_s") || entEnds(x, "04_work_stop_s") || entEnds(x, "work_stop_s"))?.entity_id || null;

    // Cloud delays
    model.hvac_on_delay_s = model.hvac_on_delay_s;
    model.hvac_off_delay_s = model.hvac_off_delay_s;

    // Text/Time
    model.oil_name = first(entries, (x) => uidEnds(x, "oil_name") || entEnds(x, "oil_name"))?.entity_id || null;
    model.work_start = first(entries, (x) => uidEnds(x, "work_start") || entEnds(x, "01_work_start") || entEnds(x, "work_start"))?.entity_id || null;
    model.work_end = first(entries, (x) => uidEnds(x, "work_end") || entEnds(x, "02_work_end") || entEnds(x, "work_end"))?.entity_id || null;

    // Sensors
    model.mqtt_status = first(entries, (x) => uidEnds(x, "mqtt_status") || entEnds(x, "mqtt_status"))?.entity_id || null;
    model.liquid_level = first(entries, (x) => uidEnds(x, "liquid_level") || uidEnds(x, "oil_level_pct") || entEnds(x, "liquid_level"))?.entity_id || null;
    model.work_schedule = first(entries, (x) => uidEnds(x, "work_schedule") || entEnds(x, "work_schedule"))?.entity_id || null;
    model.device_time = first(entries, (x) => uidEnds(x, "device_time"))?.entity_id || null; // BLE only

    // Buttons
    model.refresh = first(entries, (x) => uidEnds(x, "refresh") || uidEnds(x, "request_status") || /_refresh$/i.test(x.entity_id))?.entity_id || null;
    model.read_schedule = first(entries, (x) => uidEnds(x, "request_bulk"))?.entity_id || null;
    model.power_safe = first(entries, (x) => uidEnds(x, "power_on_safe"))?.entity_id || null;

    const used = new Set(
      Object.values(model.work_days || {})
        .concat([
          model.power, model.fan, model.work_enabled,
          model.hvac_sync_enabled, model.hvac_thermostat, model.hvac_airflow, model.hvac_start, model.hvac_end,
          model.hvac_on_delay_s, model.hvac_off_delay_s,
          model.consumption, model.capacity, model.remain_oil, model.work_run_s, model.work_stop_s,
          model.oil_name, model.work_start, model.work_end,
          model.mqtt_status, model.liquid_level, model.work_schedule, model.device_time,
          model.refresh, model.read_schedule, model.power_safe,
        ].filter(Boolean))
    );

    model._other_entries = entries.filter((e) => !used.has(e.entity_id));
    return model;
  }

  _buildHeaderSubtitle(model, isBle, mac) {
    const parts = [];
    if (isBle) {
      parts.push(mac ? `BLE • ${macShort(mac)}` : "BLE");
    } else if (model?.mqtt_status) {
      parts.push(`MQTT: ${this._state(model.mqtt_status)}`);
    } else {
      parts.push("Cloud");
    }
    if (model?.liquid_level) parts.push(`Level: ${this._state(model.liquid_level)}%`);
    return parts.join(" · ");
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
    this._lastModel = model;

    const quick = [
      this._buttonCard(model.power, "Power", "mdi:power"),
      this._buttonCard(model.fan, "Fan", "mdi:fan"),
      this._buttonCard(model.work_enabled, "Schedule", "mdi:calendar-clock"),
      model.hvac_sync_enabled ? this._buttonCard(model.hvac_sync_enabled, "HVAC", "mdi:hvac") : null,
      model.refresh
        ? this._buttonCard(
            model.refresh,
            uidEnds({ unique_id: (entries.find(e => e.entity_id === model.refresh)?.unique_id) }, "request_status") ? "Status" : "Refresh",
            "mdi:refresh",
            { action: "call-service", service: "button.press", target: { entity_id: model.refresh } }
          )
        : null,
    ].filter(Boolean);

    const quickExtra = [
      model.read_schedule
        ? this._buttonCard(
            model.read_schedule,
            "Read schedule",
            "mdi:download",
            { action: "call-service", service: "button.press", target: { entity_id: model.read_schedule } }
          )
        : null,
      model.power_safe
        ? this._buttonCard(
            model.power_safe,
            "Power safe",
            "mdi:shield-check",
            { action: "call-service", service: "button.press", target: { entity_id: model.power_safe } }
          )
        : null,
    ].filter(Boolean);

    const cards = [];
    if (quick.length) cards.push({ type: "grid", columns: 5, square: false, cards: quick });
    if (quickExtra.length) cards.push({ type: "grid", columns: Math.min(5, quickExtra.length), square: false, cards: quickExtra });

    const status = this._entitiesCard("Status", [
      model.mqtt_status && { entity: model.mqtt_status, name: "MQTT status", icon: "mdi:cloud-check" },
      model.device_time && { entity: model.device_time, name: "Device time", icon: "mdi:clock-outline" },
      model.liquid_level && { entity: model.liquid_level, name: "Oil level", icon: "mdi:gauge" },
      model.work_schedule && { entity: model.work_schedule, name: "Work schedule", icon: "mdi:calendar-clock" },
    ]);
    if (status) cards.push(status);

    const diffusion = this._entitiesCard("Diffusion", [
      model.consumption && { entity: model.consumption, name: "Consumption", icon: "mdi:water" },
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

    const anyDay = Object.values(model.work_days || {}).some(Boolean);
    if (anyDay) {
      cards.push({
        type: `custom:${DAYS_ROW_TYPE}`,
        title: "Days",
        days: model.work_days,
        labels: { mon:"MON", tue:"TUE", wed:"WED", thu:"THU", fri:"FRI", sat:"SAT", sun:"SUN" },
      });
    }

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
      const rows = model._other_entries
        .slice(0, this._config.max_other_entities || DEFAULTS.max_other_entities)
        .map((e) => {
          const fn = this._hass?.states?.[e.entity_id]?.attributes?.friendly_name || e.original_name || e.entity_id;
          return { entity: e.entity_id, name: prettyEntityName(fn) };
        });
      cards.push({ type: "entities", title: "Other entities", show_header_toggle: false, entities: rows });
    }

    const stackConfig = { type: "vertical-stack", cards };
    const el = await helpers.createCardElement(stackConfig);
    el.hass = this._hass;
    return el;
  }

  async _render() {
    if (!this._root || !this._config) return;
    if (this._hass) await this._ensureData();

    const keys = this._keys || [];
    const hasDevices = keys.length > 0;
    const key = this._selectedKey;

    const isBle = Boolean(this._isBleByKey.get(key));
    const mac = this._macByKey.get(key) || null;

    // Auto-title for BLE
    let headerTitle = this._config.title || DEFAULTS.title;
    if (isBle && !/ble/i.test(headerTitle)) {
      // Only auto-append if the user didn't already include BLE
      headerTitle = `${headerTitle} (BLE)`;
    }

    const pictureHtml =
      this._config.show_picture && this._config.picture
        ? `<img class="picture" src="${this._escape(this._config.picture)}" />`
        : "";

    const pickerHtml =
      this._config.show_device_picker && hasDevices && keys.length > 1
        ? `
          <div class="picker">
            <select id="devpicker">
              ${keys.map((k) => {
                const sel = k === key ? "selected" : "";
                const lbl = this._labelByKey.get(k) || k;
                return `<option value="${this._escape(k)}" ${sel}>${this._escape(lbl)}</option>`;
              }).join("")}
            </select>
          </div>
        `
        : "";

    const subtitle = this._lastModel
      ? this._buildHeaderSubtitle(this._lastModel, isBle, mac)
      : (hasDevices ? (isBle ? (mac ? `BLE • ${macShort(mac)}` : "BLE") : "Ready") : "No device found");

    this._root.innerHTML = `
      <ha-card>
        ${pictureHtml}
        <div class="header">
          <div>
            <div class="title">${this._escape(headerTitle)}</div>
            <div class="sub">${this._escape(subtitle)}</div>
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
      await this._render(); // update subtitle after model is known
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

customElements.define(MAIN_CARD_TYPE, FelshareDeviceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: MAIN_CARD_TYPE,
  name: "Felshare Device Card (Auto)",
  description: "Auto-detect Felshare Cloud/BLE devices and build a full control UI without YAML edits.",
});

console.info("%cFELSHARE-DEVICE-CARD%c v6 Loaded", "color: white; background: #03a9f4; font-weight: 700;", "color: #03a9f4;");
