/**
 * felshare-device-card.test.js
 *
 * Covers:
 *  - Utility functions (escapeHtml, findMac, macShort, stripLeadingDeviceId,
 *    stripBlePrefix, prettyEntityName, uidEnds, entEnds)
 *  - _matchModel entity mapping
 *  - _ensureData error recovery (lock reset on WS failure)
 *  - _fetchEntityRegistry normalises compressed HA 2023.x field names
 *  - XSS prevention in FelshareDaysRow._render()
 *  - Debounce: set hass() batches rapid calls
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---- Load the card, injecting controlled globals ----
//
// The card file uses bare `customElements` and `window` globals.
// We pass them as explicit parameters to new Function so they shadow
// the jsdom globals — this lets us capture registered classes and avoid
// touching jsdom's real CustomElementRegistry.

const cardSource = fs.readFileSync(
  path.join(__dirname, "felshare-device-card.js"),
  "utf8"
);

// Append an export line so the module-level helpers become accessible.
const sourceWithExports =
  cardSource +
  `\nif (typeof __felshareExports !== 'undefined') {
    __felshareExports.escapeHtml = escapeHtml;
    __felshareExports.findMac = findMac;
    __felshareExports.macShort = macShort;
    __felshareExports.stripLeadingDeviceId = stripLeadingDeviceId;
    __felshareExports.stripBlePrefix = stripBlePrefix;
    __felshareExports.prettyEntityName = prettyEntityName;
    __felshareExports.uidEnds = uidEnds;
    __felshareExports.entEnds = entEnds;
  }\n`;

// Suppress the console.info banner
jest.spyOn(console, "info").mockImplementation(() => {});

// Shared mocks
const mockLoadCardHelpers = jest.fn().mockResolvedValue({
  createCardElement: jest.fn().mockResolvedValue(document.createElement("div")),
});

// Registries populated when the card source runs
const registeredClasses = {};  // name -> class
const helpers = {};            // escapeHtml, findMac, …

// Register with BOTH our capture map and jsdom's real registry.
// jsdom requires classes to be in its registry before `new Cls()` works.
const realCustomElements = window.customElements;
const mockCustomElements = {
  define: (name, cls) => {
    registeredClasses[name] = cls;
    try { realCustomElements.define(name, cls); } catch (_) { /* ignore re-registration */ }
  },
};
const mockWindow = {
  customCards: [],
  loadCardHelpers: mockLoadCardHelpers,
};
const felshareExports = {};

// Execute — HTMLElement comes from jsdom global so attachShadow works.
// new Function with named params shadows the globals we want to control.
// eslint-disable-next-line no-new-func
new Function(
  "customElements", "window", "__felshareExports", "HTMLElement",
  sourceWithExports
)(mockCustomElements, mockWindow, felshareExports, HTMLElement);

// Pull out helpers
Object.assign(helpers, felshareExports);
const {
  escapeHtml, findMac, macShort, stripLeadingDeviceId,
  stripBlePrefix, prettyEntityName, uidEnds, entEnds,
} = helpers;

// Factory helpers
function makeFelshareDeviceCard() {
  const Cls = registeredClasses["felshare-device-card"];
  if (!Cls) throw new Error("felshare-device-card was not registered");
  return new Cls();
}
function makeFelshareDaysRow() {
  const Cls = registeredClasses["felshare-days-row"];
  if (!Cls) throw new Error("felshare-days-row was not registered");
  return new Cls();
}

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

describe("escapeHtml", () => {
  test("escapes & < > \" '", () => {
    expect(escapeHtml(`<script>alert('xss' & "stuff")</script>`))
      .toBe("&lt;script&gt;alert(&#39;xss&#39; &amp; &quot;stuff&quot;)&lt;/script&gt;");
  });

  test("returns empty string for null/undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  test("does not mutate safe strings", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("findMac", () => {
  test("extracts uppercase MAC from middle of string", () => {
    expect(findMac("Felshare Diffuser (BLE) - 34:CD:B0:AF:56:D2 Power"))
      .toBe("34:CD:B0:AF:56:D2");
  });

  test("returns null when no MAC present", () => {
    expect(findMac("no mac here")).toBeNull();
  });

  test("handles lowercase MAC and returns uppercase", () => {
    expect(findMac("34:cd:b0:af:56:d2")).toBe("34:CD:B0:AF:56:D2");
  });

  test("returns null for empty/null input", () => {
    expect(findMac("")).toBeNull();
    expect(findMac(null)).toBeNull();
  });
});

describe("macShort", () => {
  test("returns last 5 chars (XX:XX)", () => {
    expect(macShort("34:CD:B0:AF:56:D2")).toBe("56:D2");
  });

  test("returns null for falsy input", () => {
    expect(macShort(null)).toBeNull();
    expect(macShort("")).toBeNull();
  });
});

describe("stripLeadingDeviceId", () => {
  test("removes leading numeric device id", () => {
    expect(stripLeadingDeviceId("229070733364532 HVAC sync airflow"))
      .toBe("HVAC sync airflow");
  });

  test("removes device id with dash separator", () => {
    expect(stripLeadingDeviceId("123456789 - Power")).toBe("Power");
  });

  test("leaves short numbers intact (< 6 digits)", () => {
    expect(stripLeadingDeviceId("12345 Power")).toBe("12345 Power");
  });

  test("no-ops on plain names", () => {
    expect(stripLeadingDeviceId("My Diffuser")).toBe("My Diffuser");
  });
});

describe("stripBlePrefix", () => {
  test("removes full BLE prefix with MAC", () => {
    expect(stripBlePrefix("Felshare Diffuser (BLE) - 34:CD:B0:AF:56:D2 Power"))
      .toBe("Power");
  });

  test("removes bare MAC prefix", () => {
    expect(stripBlePrefix("34:CD:B0:AF:56:D2 Power")).toBe("Power");
  });

  test("removes Felshare Diffuser (BLE) without MAC", () => {
    expect(stripBlePrefix("Felshare Diffuser (BLE) Fan")).toBe("Fan");
  });

  test("no-ops on plain name", () => {
    expect(stripBlePrefix("Power")).toBe("Power");
  });
});

describe("prettyEntityName", () => {
  test("strips device id and BLE prefix end-to-end", () => {
    expect(prettyEntityName("229070733364532 Felshare Diffuser (BLE) - 34:CD:B0:AF:56:D2 Power"))
      .toBe("Power");
  });

  test("returns empty string for empty/null input", () => {
    expect(prettyEntityName("")).toBe("");
    expect(prettyEntityName(null)).toBe("");
  });
});

describe("uidEnds", () => {
  test("matches underscore suffix (Cloud)", () => {
    expect(uidEnds({ unique_id: "229070733364532_power" }, "power")).toBe(true);
  });

  test("matches dash suffix (BLE)", () => {
    expect(uidEnds({ unique_id: "34:CD:B0:AF:56:D2-power_on" }, "power_on")).toBe(true);
  });

  test("does not match partial suffix", () => {
    expect(uidEnds({ unique_id: "229070733364532_superpower" }, "power")).toBe(false);
  });

  test("handles null/undefined entry gracefully", () => {
    expect(uidEnds(null, "power")).toBe(false);
    expect(uidEnds(undefined, "power")).toBe(false);
  });
});

describe("entEnds", () => {
  test("matches entity_id suffix", () => {
    expect(entEnds({ entity_id: "switch.229070733364532_power" }, "power")).toBe(true);
  });

  test("does not match partial", () => {
    expect(entEnds({ entity_id: "switch.229070733364532_superpower" }, "power")).toBe(false);
  });
});

// ================================================================
// _matchModel
// ================================================================

describe("FelshareDeviceCard._matchModel", () => {
  let card;

  beforeEach(() => {
    card = makeFelshareDeviceCard();
    card.setConfig({});
  });

  const entry = (entity_id, unique_id) => ({
    entity_id, unique_id,
    platform: "felshare_cloud", device_id: "d1", original_name: null,
  });

  test("maps power switch by unique_id", () => {
    const model = card._matchModel([entry("switch.dev_power", "12345_power")]);
    expect(model.power).toBe("switch.dev_power");
  });

  test("maps BLE power switch by dash uid suffix", () => {
    const model = card._matchModel([entry("switch.ble_power", "34:CD:B0:AF:56:D2-power_on")]);
    expect(model.power).toBe("switch.ble_power");
  });

  test("maps all seven work_days", () => {
    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const entries = days.map((d) => entry(`switch.dev_work_day_${d}`, `12345_work_day_${d}`));
    const model = card._matchModel(entries);
    for (const d of days) {
      expect(model.work_days[d]).toBe(`switch.dev_work_day_${d}`);
    }
  });

  test("puts unrecognised entities in _other_entries", () => {
    const model = card._matchModel([entry("sensor.dev_unknown_xyz", "12345_unknown_xyz")]);
    expect(model._other_entries).toHaveLength(1);
    expect(model._other_entries[0].entity_id).toBe("sensor.dev_unknown_xyz");
  });

  test("does not put recognised entities in _other_entries", () => {
    const model = card._matchModel([entry("switch.dev_power", "12345_power")]);
    expect(model._other_entries).toHaveLength(0);
  });
});

// ================================================================
// _ensureData — error recovery (BUG-1 regression)
// ================================================================

describe("FelshareDeviceCard._ensureData error recovery", () => {
  let card;

  beforeEach(() => {
    card = makeFelshareDeviceCard();
    card.setConfig({});
  });

  test("resets _loading to null on WS error so the next call retries", async () => {
    card._hass = {
      callWS: jest.fn().mockRejectedValue(new Error("WS timeout")),
      states: {},
    };

    await card._ensureData();

    expect(card._loading).toBeNull();
    expect(card._dataLoaded).toBe(false);
  });

  test("sets _dataLoaded = true after successful load", async () => {
    card._hass = {
      callWS: jest.fn().mockResolvedValue([]),
      states: {},
    };

    await card._ensureData();

    expect(card._dataLoaded).toBe(true);
    expect(card._loading).not.toBeNull();
  });

  test("second call returns the cached promise without re-fetching", async () => {
    const callWS = jest.fn().mockResolvedValue([]);
    card._hass = { callWS, states: {} };

    await card._ensureData();
    await card._ensureData();

    // Only 2 callWS calls total (entity registry + device registry), not 4
    expect(callWS).toHaveBeenCalledTimes(2);
  });
});

// ================================================================
// _fetchEntityRegistry — compressed field normalisation (API upgrade)
// ================================================================

describe("FelshareDeviceCard._fetchEntityRegistry", () => {
  let card;

  beforeEach(() => {
    card = makeFelshareDeviceCard();
    card.setConfig({});
  });

  test("normalises HA 2023.x compressed fields (ei, ui, pl, di, on, na)", async () => {
    card._hass = {
      callWS: jest.fn().mockResolvedValue({
        entities: [{
          ei: "switch.dev_power", ui: "12345_power",
          pl: "felshare_cloud", di: "d1", on: "Power", na: null,
        }],
      }),
    };

    const result = await card._fetchEntityRegistry();
    expect(result).toEqual([{
      entity_id: "switch.dev_power", unique_id: "12345_power",
      platform: "felshare_cloud", device_id: "d1",
      original_name: "Power", name: null,
    }]);
  });

  test("normalises HA 2022.x full field names (passes through unchanged)", async () => {
    card._hass = {
      callWS: jest.fn().mockResolvedValue({
        entities: [{
          entity_id: "switch.dev_power", unique_id: "12345_power",
          platform: "felshare_cloud", device_id: "d1",
          original_name: "Power", name: null,
        }],
      }),
    };

    const result = await card._fetchEntityRegistry();
    expect(result[0].entity_id).toBe("switch.dev_power");
    expect(result[0].unique_id).toBe("12345_power");
  });

  test("falls back to list endpoint when list_for_display fails", async () => {
    const fallbackData = [{
      entity_id: "switch.dev_power", unique_id: "12345_power",
      platform: "felshare_cloud", device_id: "d1",
      original_name: "Power", name: null,
    }];
    card._hass = {
      callWS: jest.fn()
        .mockRejectedValueOnce(new Error("unknown command"))
        .mockResolvedValueOnce(fallbackData),
    };

    const result = await card._fetchEntityRegistry();
    expect(result).toEqual(fallbackData);
    expect(card._hass.callWS).toHaveBeenCalledTimes(2);
    expect(card._hass.callWS.mock.calls[0][0].type)
      .toBe("config/entity_registry/list_for_display");
    expect(card._hass.callWS.mock.calls[1][0].type)
      .toBe("config/entity_registry/list");
  });
});

// ================================================================
// XSS prevention — FelshareDaysRow (SEC-1 regression)
// ================================================================

describe("FelshareDaysRow XSS prevention", () => {
  let row;

  beforeEach(() => {
    row = makeFelshareDaysRow();
    row.setConfig({
      title: "<img src=x onerror=window.__xss=1>",
      days: { mon: "switch.day_mon" },
      labels: { mon: "<b>ATTACK</b>" },
    });
    row._hass = { states: { "switch.day_mon": { state: "on" } } };
    row._render();
  });

  test("title is escaped — no raw <img> tag injected", () => {
    const html = row._root?.innerHTML ?? "";
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("label is escaped — no <b> tag injected", () => {
    const html = row._root?.innerHTML ?? "";
    expect(html).not.toMatch(/<b>/i);
    expect(html).toContain("&lt;b&gt;");
  });
});

// ================================================================
// Debounce — set hass() batches rapid calls (perf improvement)
// ================================================================

describe("FelshareDeviceCard debounce on set hass()", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("batches 10 rapid hass updates into a single _ensureData call", async () => {
    const card = makeFelshareDeviceCard();
    card.setConfig({});

    const ensureSpy = jest.spyOn(card, "_ensureData").mockResolvedValue();
    jest.spyOn(card, "_render").mockResolvedValue();

    const fakeHass = { states: {} };
    for (let i = 0; i < 10; i++) card.hass = fakeHass;

    jest.runAllTimers();
    await Promise.resolve();

    expect(ensureSpy).toHaveBeenCalledTimes(1);
  });

  test("fires after 50 ms of silence", async () => {
    const card = makeFelshareDeviceCard();
    card.setConfig({});

    const ensureSpy = jest.spyOn(card, "_ensureData").mockResolvedValue();
    jest.spyOn(card, "_render").mockResolvedValue();

    card.hass = { states: {} };
    expect(ensureSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    await Promise.resolve();

    expect(ensureSpy).toHaveBeenCalledTimes(1);
  });
});
