/* felshare-device-card.js
 * A “no-config” device card that auto-detects Felshare Cloud devices/entities
 * and builds a nice UI from core cards.
 *
 * Type: custom:felshare-device-card
 */

const CARD_TYPE = "felshare-device-card";
const DEFAULTS = Object.freeze({
  // Try these platform/integration names in the entity registry:
  // Adjust if your platform name differs.
  platforms: ["felshare_cloud", "felshare", "felshare_ble", "felshare_cloud_mqtt"],
  title: "Felshare Diffuser",
  picture: "/local/felshare/diffuser-header.jpg",
  show_picture: true,
  show_device_picker: true, // dropdown inside the card (no YAML edit needed)
});

class FelshareDeviceCard extends HTMLElement {
  static getConfigElement() {
    // Optional GUI editor (not required for “auto”).
    return document.createElement("felshare-device-card-editor");
  }

  static getStubConfig() {
    // This makes it “add-and-go” from the card picker.
    return { ...DEFAULTS };
  }

  setConfig(config) {
    // config is frozen by HA; clone it
    this._config = { ...DEFAULTS, ...(config || {}) };
    this._selectedDeviceId = null;

    if (!this._root) {
      this.attachShadow({ mode: "open" });
      this._root = document.createElement("div");
      this.shadowRoot.appendChild(this._style());
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
    return 6;
  }

  _style() {
    const s = document.createElement("style");
    s.textContent = `
      .wrap { padding: 0; }
      .header {
        display: flex;
        gap: 12px;
        align-items: center;
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
      .picker {
        margin-left: auto;
      }
      select {
        font: inherit;
        padding: 6px 8px;
        border-radius: 10px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        color: var(--primary-text-color);
        outline: none;
      }
      .picture {
        width: 100%;
        height: 140px;
        object-fit: cover;
        display: block;
        border-top-left-radius: var(--ha-card-border-radius, 12px);
        border-top-right-radius: var(--ha-card-border-radius, 12px);
      }
      .content {
        padding: 0 10px 12px 10px;
      }
      .note {
        padding: 14px 16px;
        opacity: 0.8;
      }
    `;
    return s;
  }

  async _ensureHelpers() {
    if (!this._helpers) {
      this._helpers = await window.loadCardHelpers();
    }
    return this._helpers;
  }

  async _ensureData() {
    if (!this._hass) return;

    // Avoid refetching repeatedly
    if (this._loadingData) return this._loadingData;

    this._loadingData = (async () => {
      // Entity registry gives device_id + platform reliably (if device_info is set)
      const entityReg = await this._hass.callWS({ type: "config/entity_registry/list" });
      // Device registry helps show device names
      const deviceReg = await this._hass.callWS({ type: "config/device_registry/list" });

      this._deviceNameById = new Map();
      for (const d of deviceReg) {
        this._deviceNameById.set(d.id, d.name_by_user || d.name || d.model || d.id);
      }

      const platforms = new Set(this._config.platforms || DEFAULTS.platforms);
      const felshareEntities = entityReg.filter((e) => platforms.has(e.platform));

      // Group by device_id; fallback to parsing numeric prefix if device_id missing
      const byDevice = new Map();
      for (const e of felshareEntities) {
        const entId = e.entity_id;
        const devId = e.device_id || this._parseNumericDeviceFromEntity(entId) || "__unknown__";
        if (!byDevice.has(devId)) byDevice.set(devId, []);
        byDevice.get(devId).push(entId);
      }

      // If everything is unknown, try scanning hass.states pattern
      if (byDevice.size === 0) {
        const pattern = /^(switch|number|select|sensor|text|button)\.\d{6,}_/;
        const entIds = Object.keys(this._hass.states || {}).filter((id) => pattern.test(id));
        const tmp = new Map();
        for (const id of entIds) {
          const dev = this._parseNumericDeviceFromEntity(id) || "__unknown__";
          if (!tmp.has(dev)) tmp.set(dev, []);
          tmp.get(dev).push(id);
        }
        this._entitiesByDevice = tmp;
      } else {
        this._entitiesByDevice = byDevice;
      }

      this._devices = Array.from(this._entitiesByDevice.keys()).filter((k) => k !== "__unknown__");
      if (this._devices.length === 0 && this._entitiesByDevice.has("__unknown__")) {
        this._devices = ["__unknown__"];
      }

      // Choose default (first)
      if (!this._selectedDeviceId) {
        this._selectedDeviceId = this._devices[0] || null;
      }
    })();

    return this._loadingData;
  }

  _parseNumericDeviceFromEntity(entityId) {
    // Example: switch.229070733364532_fan  -> 229070733364532
    const m = entityId.match(/^[^.]+\.(\d{6,})_/);
    return m ? m[1] : null;
  }

  _deviceLabel(devId) {
    if (devId === "__unknown__") return "Felshare Device";
    const fromReg = this._deviceNameById?.get(devId);
    return fromReg || devId;
  }

  _pick(entities, regexes) {
    for (const r of regexes) {
      const found = entities.find((e) => r.test(e));
      if (found) return found;
    }
    return null;
  }

  _sortByPriority(list, rules) {
    return [...list].sort((a, b) => {
      const sa = rules.reduce((acc, r) => (r.re.test(a) ? Math.max(acc, r.score) : acc), 0);
      const sb = rules.reduce((acc, r) => (r.re.test(b) ? Math.max(acc, r.score) : acc), 0);
      return sb - sa || a.localeCompare(b);
    });
  }

  async _buildChildCardForDevice(devId) {
    if (!this._hass || !this._entitiesByDevice) return null;

    const helpers = await this._ensureHelpers();
    const entities = (this._entitiesByDevice.get(devId) || []).slice();

    if (entities.length === 0) return null;

    // Best-effort “known” entities (by suffix/keyword)
    const power = this._pick(entities, [/^switch\..*(?:_power|_on|_diffuser)$/]);
    const fan = this._pick(entities, [/^switch\..*_fan$/]);
    const schedule = this._pick(entities, [/^switch\..*(work_schedule|_schedule)$/]);
    const hvac = this._pick(entities, [/^switch\..*hvac_sync$/]);
    const refresh = this._pick(entities, [/^button\..*(refresh|update|sync|status)/]);

    const liquid = this._pick(entities, [/^sensor\..*(liquid|level)/]);
    const mqtt = this._pick(entities, [/^sensor\..*(mqtt|cloud)/]);
    const lastSeen = this._pick(entities, [/^sensor\..*(last_seen|seen|online)/]);

    // Group by domain
    const byDomain = {
      number: entities.filter((e) => e.startsWith("number.")),
      select: entities.filter((e) => e.startsWith("select.")),
      text: entities.filter((e) => e.startsWith("text.")),
    };

    // Prioritize
    const numberPriority = [
      { re: /consumption/i, score: 90 },
      { re: /(work_run|run)/i, score: 80 },
      { re: /(work_stop|stop)/i, score: 79 },
      { re: /(remain|remaining|oil)/i, score: 70 },
      { re: /(capacity)/i, score: 69 },
      { re: /(delay)/i, score: 60 },
    ];
    const sensorPriority = [
      { re: /(mqtt|cloud)/i, score: 90 },
      { re: /(liquid|level)/i, score: 80 },
      { re: /(last_seen|online)/i, score: 70 },
    ];

    const actions = [power, fan, schedule, hvac, refresh].filter(Boolean);
    const status = this._sortByPriority([mqtt, liquid, lastSeen].filter(Boolean), sensorPriority);

    const numbers = this._sortByPriority(byDomain.number, numberPriority);
    const selects = byDomain.select;
    const texts = byDomain.text;

    // Build a stack of core cards (no user YAML needed)
    const stackConfig = {
      type: "vertical-stack",
      cards: [
        // Quick actions
        ...(actions.length
          ? [
              {
                type: "grid",
                columns: 5,
                square: false,
                cards: actions.map((eid) => ({
                  type: "button",
                  entity: eid,
                  show_name: true,
                  show_state: false,
                  tap_action: { action: "toggle" },
                })),
              },
            ]
          : []),

        // Status
        ...(status.length
          ? [
              {
                type: "entities",
                title: "Estado",
                show_header_toggle: false,
                entities: status,
              },
            ]
          : []),

        // Main controls
        ...(numbers.length
          ? [
              {
                type: "entities",
                title: "Controles",
                show_header_toggle: false,
                entities: numbers.slice(0, 8),
              },
            ]
          : []),

        ...(selects.length
          ? [
              {
                type: "entities",
                title: "Selecciones",
                show_header_toggle: false,
                entities: selects.slice(0, 8),
              },
            ]
          : []),

        ...(texts.length
          ? [
              {
                type: "entities",
                title: "Texto",
                show_header_toggle: false,
                entities: texts.slice(0, 8),
              },
            ]
          : []),
      ],
    };

    const cardEl = await helpers.createCardElement(stackConfig);
    cardEl.hass = this._hass;
    return cardEl;
  }

  async _render() {
    if (!this._root || !this._config) return;

    if (this._hass) await this._ensureData();

    const devId = this._selectedDeviceId;
    const devices = this._devices || [];
    const hasDevices = devices.length > 0;

    const pictureHtml =
      this._config.show_picture && this._config.picture
        ? `<img class="picture" src="${this._config.picture}" />`
        : "";

    const pickerHtml =
      this._config.show_device_picker && hasDevices && devices.length > 1
        ? `
          <div class="picker">
            <select id="devpicker">
              ${devices
                .map((d) => {
                  const sel = d === devId ? "selected" : "";
                  return `<option value="${d}" ${sel}>${this._escape(this._deviceLabel(d))}</option>`;
                })
                .join("")}
            </select>
          </div>
        `
        : "";

    this._root.innerHTML = `
      <ha-card>
        ${pictureHtml}
        <div class="wrap">
          <div class="header">
            <div>
              <div class="title">${this._escape(this._config.title || DEFAULTS.title)}</div>
              <div class="sub">${
                hasDevices ? this._escape(this._deviceLabel(devId || "")) : "No device found"
              }</div>
            </div>
            ${pickerHtml}
          </div>
          <div class="content" id="content"></div>
          ${
            !hasDevices
              ? `<div class="note">No encontré entidades de Felshare. Verifica que la integración cree entidades (y que el platform sea ${this._config.platforms.join(
                  ", "
                )}).</div>`
              : ""
          }
        </div>
      </ha-card>
    `;

    const picker = this._root.querySelector("#devpicker");
    if (picker) {
      picker.addEventListener("change", async (ev) => {
        this._selectedDeviceId = ev.target.value;
        this._childCard = null;
        await this._render();
      });
    }

    const content = this._root.querySelector("#content");
    if (!content || !hasDevices) return;

    if (!this._childCard || this._childCardDevice !== devId) {
      this._childCardDevice = devId;
      this._childCard = await this._buildChildCardForDevice(devId);
    }

    content.innerHTML = "";
    if (this._childCard) {
      this._childCard.hass = this._hass;
      content.appendChild(this._childCard);
    } else {
      content.innerHTML = `<div class="note">No hay entidades para este dispositivo.</div>`;
    }
  }

  _escape(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

customElements.define(CARD_TYPE, FelshareDeviceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: "Felshare Device Card (Auto)",
  description: "Auto-detect Felshare devices and build a full control card without YAML edits.",
});

console.info(
  "%cFELSHARE-DEVICE-CARD%c Loaded",
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4;"
);
