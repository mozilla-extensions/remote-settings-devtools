const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
const { Preferences } = Cu.import("resource://gre/modules/Preferences.jsm", {});
const { RemoteSettings } = Cu.import("resource://services-common/remote-settings.js", {});
const { UptakeTelemetry } = Cu.import("resource://services-common/uptake-telemetry.js", {});
const { UpdateUtils } = Cu.import("resource://gre/modules/UpdateUtils.jsm");

const BlocklistClients = Cu.import("resource://services-common/blocklist-clients.js", {});

const SERVER_PROD = "https://firefox.settings.services.mozilla.com/v1";
const SERVER_STAGE = "https://settings.stage.mozaws.net/v1";
const XML_SUFFIX =
  "3/%APP_ID%/%APP_VERSION%/%PRODUCT%/%BUILD_ID%/%BUILD_TARGET%/%LOCALE%/%CHANNEL%/%OS_VERSION%/%DISTRIBUTION%/%DISTRIBUTION_VERSION%/%PING_COUNT%/%TOTAL_PING_COUNT%/%DAYS_SINCE_LAST_PING%/";
const HASH_PROD =
  "97:E8:BA:9C:F1:2F:B3:DE:53:CC:42:A4:E6:57:7E:D6:4D:F4:93:C2:47:B4:14:FE:A0:36:81:8D:38:23:56:0E";
const HASH_STAGE =
  "DB:74:CE:58:E4:F9:D0:9E:E0:42:36:BE:6C:C5:C4:F6:6A:E7:74:7D:C0:21:42:7A:03:BC:2F:57:0C:8B:9B:90";

const controller = {
  clients() {
    BlocklistClients.initialize(); // Let Gecko instantiate real clients.
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");
    // This will return existing instances (will signer initialized etc.)
    return [
      RemoteSettings(Preferences.get("services.blocklist.addons.collection"), {
        bucketName: blocklistsBucket
      }),
      RemoteSettings(Preferences.get("services.blocklist.onecrl.collection"), {
        bucketName: blocklistsBucket
      }),
      RemoteSettings(Preferences.get("services.blocklist.plugins.collection"), {
        bucketName: blocklistsBucket
      }),
      RemoteSettings(Preferences.get("services.blocklist.gfx.collection"), {
        bucketName: blocklistsBucket
      }),
      RemoteSettings(Preferences.get("services.blocklist.pinning.collection"), {
        bucketName: pinningBucket
      })
    ];
    // TODO: add clients using main bucket (or add a RemoteSettings.inspect())
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=1453692
  },

  /**
   * guessEnvironment() will read the current preferences and return the
   * environment name (suffixed with `preview` if relevant).
   */
  guessEnvironment() {
    const server = Preferences.get("services.settings.server");
    let environment = "custom";
    if (server == SERVER_PROD) {
      environment = "prod";
    } else if (server == SERVER_STAGE) {
      environment = "stage";
    }
    const aClient = this.clients()[0];
    if (aClient.bucketName.includes("-preview")) {
      environment += "-preview";
    }
    return environment;
  },

  /**
   * setEnvironment() will set the necessary internal preferences to switch from
   * an environment to another.
   */
  setEnvironment(env) {
    const clients = this.clients();
    switch (env) {
      case "prod":
        Preferences.set("services.settings.server", SERVER_PROD);
        Preferences.set("security.content.signature.root_hash", HASH_PROD);
        Preferences.set("extensions.blocklist.url", `${SERVER_PROD}/blocklist/${XML_SUFFIX}`);
        for (const client of clients) {
          client.bucketName = client.bucketName.replace("-preview", "");
        }
        break;
      case "prod-preview":
        Preferences.set("services.settings.server", SERVER_PROD);
        Preferences.set("security.content.signature.root_hash", HASH_PROD);
        Preferences.set("extensions.blocklist.url", `${SERVER_PROD}/preview/${XML_SUFFIX}`);
        for (const client of clients) {
          if (!client.bucketName.includes("-preview")) {
            client.bucketName += "-preview";
          }
        }
        break;
      case "stage":
        Preferences.set("services.settings.server", SERVER_STAGE);
        Preferences.set("security.content.signature.root_hash", HASH_STAGE);
        Preferences.set("extensions.blocklist.url", `${SERVER_STAGE}/blocklist/${XML_SUFFIX}`);
        for (const client of clients) {
          client.bucketName = client.bucketName.replace("-preview", "");
        }
        break;
      case "stage-preview":
        Preferences.set("services.settings.server", SERVER_STAGE);
        Preferences.set("security.content.signature.root_hash", HASH_STAGE);
        Preferences.set("extensions.blocklist.url", `${SERVER_STAGE}/preview/${XML_SUFFIX}`);
        for (const client of clients) {
          if (!client.bucketName.includes("-preview")) {
            client.bucketName += "-preview";
          }
        }
        break;
    }
  },

  /**
   * mainPreferences() returns the values of the internal preferences related to remote settings.
   */
  async mainPreferences() {
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");
    const pinningEnabled = Preferences.get("services.blocklist.pinning.enabled");
    const verifySignature = Preferences.get("services.settings.verify_signature");
    const rootHash = Preferences.get("security.content.signature.root_hash");
    const loadDump = Preferences.get("services.settings.load_dump");
    const server = Preferences.get("services.settings.server");

    return {
      blocklistsBucket,
      pinningBucket,
      pinningEnabled,
      verifySignature,
      rootHash,
      loadDump,
      server
    };
  },

  /**
   * refreshXml() is the global synchronization action. It triggers everything, from
   * XML refresh to remote settings synchronization.
   * https://searchfox.org/mozilla-central/rev/137f1b2f434346a0c3756ebfcbdbee4069e15dc8/toolkit/mozapps/extensions/nsBlocklistService.js#483
   */
  async refreshXml() {
    const blocklist = Cc["@mozilla.org/extensions/blocklist;1"].getService(Ci.nsITimerCallback);

    return new Promise(resolve => {
      const event = "remote-settings-changes-polled";
      const changesPolledObserver = {
        observe(aSubject, aTopic, aData) {
          Services.obs.removeObserver(this, event);
          resolve();
        }
      };
      Services.obs.addObserver(changesPolledObserver, event);
      blocklist.notify(null);
    });
  },

  /**
   * forceSync() will trigger a synchronization at the level only for the specified client.
   */
  async forceSync(client) {
    const serverTimeMs =
      parseInt(Preferences.get("services.settings.last_update_seconds"), 10) * 1000;
    const lastModified = Infinity; // Force sync, never up-to-date.
    return client.maybeSync(lastModified, serverTimeMs);
  },

  /**
   * clearPollingStatus() resets the local preferences about the global polling status.
   * It will simulate a profile that has never been synchronized.
   */
  async clearPollingStatus() {
    Preferences.reset("services.settings.last_update_seconds");
    Preferences.reset("services.settings.last_etag");
    Preferences.reset("services.settings.clock_skew_seconds");
    Preferences.reset("services.settings.server.backoff");
  },

  /**
   * pollingStatus() returns the current preferences values about the
   * global polling status.
   */
  async pollingStatus() {
    const prefs = [
      // Preferences
      { target: "server", name: "services.settings.server" },
      { target: "changespath", name: "services.settings.changes.path" },
      // Status
      { target: "backoff", name: "services.settings.server.backoff" },
      { target: "lastPoll", name: "services.settings.last_update_seconds" },
      { target: "timestamp", name: "services.settings.last_etag" },
      { target: "clockskew", name: "services.settings.clock_skew_seconds" }
    ];
    const result = {};
    for (const pref of prefs) {
      const { target, name } = pref;
      const value = Preferences.get(name);
      switch (target) {
        case "lastPoll":
          result[target] = value ? parseInt(value, 10) * 1000 : undefined;
          break;
        case "timestamp":
          result[target] = value ? parseInt(value.replace('"', ""), 10) : undefined;
          break;
        default:
          result[target] = value;
      }
    }
    return result;
  },

  /**
   * remoteSettingsStatus() returns information about each remote settings collection.
   */
  async remoteSettingsStatus() {
    const server = Preferences.get("services.settings.server");
    const changespath = Preferences.get("services.settings.changes.path");
    const monitorUrl = `${server}${changespath}`;
    const response = await fetch(monitorUrl);
    const { data } = await response.json();
    const timestamps = data.reduce((acc, entry) => {
      const { collection, bucket, last_modified } = entry;
      if (!(bucket in acc)) {
        acc[bucket] = {};
      }
      acc[bucket][collection] = last_modified;
      return acc;
    }, {});

    const results = [];
    for (const client of this.clients()) {
      const { bucketName: bid, collectionName: cid } = client;
      const url = `${server}/buckets/${bid}/collections/${bid}/records`;
      const lastCheckedSeconds = Preferences.get(client.lastCheckTimePref);
      const lastChecked = lastCheckedSeconds ? parseInt(lastCheckedSeconds, 10) * 1000 : undefined;
      const remoteTimestamp = timestamps[bid][cid];
      const { localTimestamp, records } = await this.fetchLocal(client);
      results.push({
        client,
        url,
        lastChecked,
        remoteTimestamp,
        localTimestamp,
        nbRecords: records.length
      });
    }
    return results;
  },

  /**
   * xmlStatus() returns information about the legacy XML blocklist file.
   */
  async xmlStatus() {
    const urlTemplate = Preferences.get("extensions.blocklist.url");
    const interval = Preferences.get("extensions.blocklist.interval");
    const pingCount = Preferences.get("extensions.blocklist.pingCountVersion");
    const pingTotal = Preferences.get("extensions.blocklist.pingCountTotal");
    const updateEpoch = parseInt(
      Preferences.get("app.update.lastUpdateTime.blocklist-background-update-timer"),
      10
    );

    const distribution = Preferences.get("distribution.id") || "default";
    const distributionVersion = Preferences.get("distribution.version") || "default";

    const lastUpdate = new Date(updateEpoch * 1000.0);
    const ageDays = Math.floor((Date.now() - lastUpdate) / (1000 * 60 * 60 * 24));

    // System information
    const sysInfo = Cc["@mozilla.org/system-info;1"].getService(Ci.nsIPropertyBag2);
    let osVersion = "unknown";
    try {
      osVersion = sysInfo.getProperty("name") + " " + sysInfo.getProperty("version");
    } catch (e) {}
    try {
      osVersion += " (" + sysInfo.getProperty("secondaryLibrary") + ")";
    } catch (e) {}

    // Locale
    const locale = Preferences.get("general.useragent.locale") || "fr-FR";

    // Application information
    const appinfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime);
    const app = appinfo.QueryInterface(Ci.nsIXULAppInfo);

    // Build URL
    const url = urlTemplate
      .replace("%APP_ID%", app.ID)
      .replace("%PRODUCT%", app.name)
      .replace("%BUILD_ID%", app.appBuildID)
      .replace("%APP_VERSION%", app.version)
      .replace("%VERSION%", app.version)
      .replace("%BUILD_TARGET%", app.OS + "_" + app.XPCOMABI)
      .replace("%PLATFORM_VERSION%", app.platformVersion)
      .replace("%PING_COUNT%", ageDays == 0 ? "invalid" : pingCount)
      .replace("%TOTAL_PING_COUNT%", ageDays == 0 ? "invalid" : pingTotal)
      .replace("%DAYS_SINCE_LAST_PING%", ageDays)
      .replace("%LOCALE%", locale)
      .replace("%CHANNEL%", UpdateUtils.UpdateChannel)
      .replace("%OS_VERSION%", encodeURIComponent(osVersion))
      .replace("%DISTRIBUTION%", distribution)
      .replace("%DISTRIBUTION_VERSION%", distributionVersion);
    return {
      url,
      interval,
      pingCount,
      pingTotal,
      lastUpdate,
      ageDays
    };
  },

  /**
   * fetchLocal() returns the records from the local database for the specified client.
   */
  async fetchLocal(client) {
    const records = await client.get();
    const kintoCol = await client.openCollection();
    const localTimestamp = await kintoCol.db.getLastModified();
    return { localTimestamp, records };
  },

  /**
   * deleteLocal() deletes the local records of the specified client.
   */
  async deleteLocal(client) {
    Preferences.reset(client.lastCheckTimePref);
    const kintoCol = await client.openCollection();
    return kintoCol.clear();
  },

  /**
   * deleteAllLocal() deletes the local records of every collection.
   */
  async deleteAllLocal() {
    for (const client of this.clients()) {
      await this.deleteLocal(client);
    }
  }
};

async function main() {
  // Populate UI in the background (ie. don't await)
  Promise.all([showPreferences(), showPollingStatus(), showBlocklistStatus(), showXmlStatus()]);

  // Install a wrapper around uptake Telemetry to catch events.
  const original = UptakeTelemetry.report;
  UptakeTelemetry.report = (source, status) => {
    showTelemetryEvent(source, status);
    original(source, status);
  };

  // Change environment.
  const environment = controller.guessEnvironment();
  const comboEnv = document.getElementById("environment");
  comboEnv.value = environment;
  comboEnv.onchange = async event => {
    controller.setEnvironment(event.target.value);
    await showPreferences();
    await showXmlStatus();
  };

  // XML refresh button.
  document.getElementById("xml-refresh").onclick = async () => {
    await controller.refreshXml();
    await showXmlStatus();
    await showPollingStatus();
    await showBlocklistStatus();
  };

  // Poll for changes button.
  document.getElementById("run-poll").onclick = async () => {
    showGlobalError(null);
    try {
      await RemoteSettings.pollChanges();
    } catch (e) {
      showGlobalError(e);
    }
    await showPollingStatus();
    await showBlocklistStatus();
  };

  // Reset local polling data.
  document.getElementById("clear-poll-data").onclick = async () => {
    await controller.clearPollingStatus();
    await showPollingStatus();
  };

  // Clear all data.
  document.getElementById("clear-all-data").onclick = async () => {
    showGlobalError(null);
    try {
      await controller.clearPollingStatus();
      await controller.deleteAllLocal();
    } catch (e) {
      showGlobalError(e);
    }
    await showPollingStatus();
    await showBlocklistStatus();
  };
}

window.addEventListener("DOMContentLoaded", main);

function asDate(timestamp) {
  return timestamp ? new Date(timestamp) : "⚠ undefined";
}

function showGlobalError(error) {
  if (error) {
    console.error(error);
  }
  document.getElementById("polling-error").textContent = error;
}

async function showPreferences() {
  const result = await controller.mainPreferences();
  const {
    blocklistsBucket,
    pinningBucket,
    pinningEnabled,
    verifySignature,
    rootHash,
    loadDump,
    server
  } = result;

  document.getElementById("server").textContent = server;
  document.getElementById("server").setAttribute("href", server);
  document.getElementById("blocklists-bucket").textContent = blocklistsBucket;
  document.getElementById("pinning-bucket").textContent = pinningBucket;
  document.getElementById("pinning-enabled").textContent = pinningEnabled;
  document.getElementById("verify-signature").textContent = verifySignature;
  document.getElementById("load-dump").textContent = loadDump;
  document.getElementById("root-hash").textContent = rootHash;
}

async function showXmlStatus() {
  const result = await controller.xmlStatus();
  const { url, interval, pingCount, pingTotal, lastUpdate, ageDays } = result;

  document.getElementById("xml-url").textContent = url;
  document.getElementById("xml-url").setAttribute("href", url);
  document.getElementById("xml-interval").textContent = interval;
  document.getElementById("xml-pingcount").textContent = pingCount;
  document.getElementById("xml-pingtotal").textContent = pingTotal;
  document.getElementById("xml-lastupdate").textContent = lastUpdate;
  document.getElementById("xml-agedays").textContent = ageDays;
}

async function showPollingStatus() {
  const result = await controller.pollingStatus();
  const { server, backoff, changespath, lastPoll, timestamp, clockskew } = result;

  const url = `${server}${changespath}`;
  document.getElementById("polling-url").textContent = url;
  document.getElementById("polling-url").setAttribute("href", url);
  document.getElementById("backoff").textContent = backoff;
  document.getElementById("last-poll").textContent = asDate(lastPoll);
  document.getElementById("timestamp").textContent = timestamp;
  document.getElementById("clockskew").textContent = clockskew;
  document.getElementById("human-timestamp").textContent = asDate(timestamp);
}

async function showBlocklistStatus() {
  const tpl = document.getElementById("collection-status-tpl");
  const statusList = document.getElementById("blocklists-status");
  const infos = await controller.remoteSettingsStatus();

  statusList.innerHTML = "";

  infos.forEach(info => {
    const { client, url, lastChecked, nbRecords, localTimestamp, remoteTimestamp } = info;

    const infos = tpl.content.cloneNode(true);
    infos.querySelector("div").setAttribute("id", `status-${client.identifier}`);
    infos.querySelector(".blocklist").textContent = name;
    infos.querySelector(".url a").textContent = `${client.identifier}`;
    infos.querySelector(".url a").setAttribute("href", url);
    infos.querySelector(".human-timestamp").textContent = asDate(remoteTimestamp);
    infos.querySelector(".timestamp").textContent = remoteTimestamp;
    infos.querySelector(".human-local-timestamp").textContent = asDate(localTimestamp);
    infos.querySelector(".local-timestamp").textContent = localTimestamp;
    infos.querySelector(".nb-records").textContent = nbRecords;
    infos.querySelector(".last-check").textContent = asDate(lastChecked);

    infos.querySelector(".clear-data").onclick = async () => {
      await controller.deleteLocal(client);
      await showBlocklistStatus();
    };
    infos.querySelector(".sync").onclick = async () => {
      let error = "";
      try {
        await controller.forceSync(client);
      } catch (e) {
        error = e;
      }
      await showBlocklistStatus();
      if (error) {
        console.error(error);
        document.querySelector(`#status-${client.identifier} .error`).textContent = error;
      }
    };
    statusList.appendChild(infos);
  });
}

function showTelemetryEvent(source, status) {
  const success = [UptakeTelemetry.STATUS.UP_TO_DATE, UptakeTelemetry.STATUS.SUCCESS];
  const warn = [UptakeTelemetry.STATUS.BACKOFF, UptakeTelemetry.STATUS.PREF_DISABLED];
  const klass = success.includes(status) ? "success" : warn.includes(status) ? "warn" : "error";

  const tpl = document.getElementById("telemetry-event-tpl");
  const el = tpl.content.cloneNode(true);
  el.querySelector("li").setAttribute("class", klass);
  el.querySelector(".time").textContent = new Date().toLocaleTimeString([], { hour12: false });
  el.querySelector(".source").textContent = source;
  el.querySelector(".status").textContent = status;

  const eventList = document.querySelector("#telemetry-events ul");
  eventList.insertBefore(el, eventList.firstChild);
}
