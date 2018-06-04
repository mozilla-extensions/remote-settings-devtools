const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
const { RemoteSettings } = Cu.import("resource://services-settings/remote-settings.js", {});
const { UptakeTelemetry } = Cu.import("resource://services-common/uptake-telemetry.js", {});
const { UpdateUtils } = Cu.import("resource://gre/modules/UpdateUtils.jsm");

const BlocklistClients = Cu.import("resource://services-common/blocklist-clients.js", {});

const SERVER_PROD = "https://firefox.settings.services.mozilla.com/v1";
const SERVER_STAGE = "https://settings.stage.mozaws.net/v1";
const HASH_PROD =
  "97:E8:BA:9C:F1:2F:B3:DE:53:CC:42:A4:E6:57:7E:D6:4D:F4:93:C2:47:B4:14:FE:A0:36:81:8D:38:23:56:0E";
const HASH_STAGE =
  "DB:74:CE:58:E4:F9:D0:9E:E0:42:36:BE:6C:C5:C4:F6:6A:E7:74:7D:C0:21:42:7A:03:BC:2F:57:0C:8B:9B:90";

const controller = {
  async clients() {
    BlocklistClients.initialize(); // Let Gecko instantiate real clients.
    const blocklistsBucket = Services.prefs.getCharPref("services.blocklist.bucket");
    const pinningBucket = Services.prefs.getCharPref("services.blocklist.pinning.bucket");
    const blocklistsClients = [
      RemoteSettings(Services.prefs.getCharPref("services.blocklist.addons.collection"), {
        bucketName: blocklistsBucket
      }),
      RemoteSettings(Services.prefs.getCharPref("services.blocklist.onecrl.collection"), {
        bucketName: blocklistsBucket
      }),
      RemoteSettings(Services.prefs.getCharPref("services.blocklist.plugins.collection"), {
        bucketName: blocklistsBucket
      }),
      RemoteSettings(Services.prefs.getCharPref("services.blocklist.gfx.collection"), {
        bucketName: blocklistsBucket
      }),
      RemoteSettings(Services.prefs.getCharPref("services.blocklist.pinning.collection"), {
        bucketName: pinningBucket
      })
    ];

    // Main clients can be instantiated with default options.
    const mainBucket = Services.prefs.getCharPref("services.settings.default_bucket");
    const server = Services.prefs.getCharPref("services.settings.server");
    const changespath = Services.prefs.getCharPref("services.settings.changes.path");
    const response = await fetch(`${server}${changespath}`);
    const { data: changes } = await response.json();
    const mainClients = changes.reduce((acc, change) => {
      const { bucket, collection } = change;
      if (bucket == mainBucket) {
        acc.push(RemoteSettings(collection));
      }
      return acc;
    }, []);

    return blocklistsClients.concat(mainClients);
  },

  /**
   * guessEnvironment() will read the current preferences and return the
   * environment name (suffixed with `preview` if relevant).
   */
  async guessEnvironment() {
    const server = Services.prefs.getCharPref("services.settings.server");
    let environment = "custom";
    if (server == SERVER_PROD) {
      environment = "prod";
    } else if (server == SERVER_STAGE) {
      environment = "stage";
    }
    const clients = await this.clients();
    if (clients.every(c => c.bucketName.includes("-preview"))) {
      environment += "-preview";
    }
    return environment;
  },

  /**
   * setEnvironment() will set the necessary internal preferences to switch from
   * an environment to another.
   */
  async setEnvironment(env) {
    const clients = await this.clients();
    switch (env) {
      case "prod":
        Services.prefs.setCharPref("services.settings.server", SERVER_PROD);
        Services.prefs.setCharPref("services.blocklist.bucket", "blocklists");
        Services.prefs.setCharPref("services.blocklist.pinning.bucket", "pinning");
        Services.prefs.setCharPref("security.content.signature.root_hash", HASH_PROD);
        for (const client of clients) {
          client.bucketName = client.bucketName.replace("-preview", "");
        }
        break;
      case "prod-preview":
        Services.prefs.setCharPref("services.settings.server", SERVER_PROD);
        Services.prefs.setCharPref("services.blocklist.bucket", "blocklists-preview");
        Services.prefs.setCharPref("services.blocklist.pinning.bucket", "pinning-preview");
        Services.prefs.setCharPref("security.content.signature.root_hash", HASH_PROD);
        for (const client of clients) {
          if (!client.bucketName.includes("-preview")) {
            client.bucketName += "-preview";
          }
        }
        break;
      case "stage":
        Services.prefs.setCharPref("services.settings.server", SERVER_STAGE);
        Services.prefs.setCharPref("services.blocklist.bucket", "blocklists");
        Services.prefs.setCharPref("services.blocklist.pinning.bucket", "pinning");
        Services.prefs.setCharPref("security.content.signature.root_hash", HASH_STAGE);
        for (const client of clients) {
          client.bucketName = client.bucketName.replace("-preview", "");
        }
        break;
      case "stage-preview":
        Services.prefs.setCharPref("services.settings.server", SERVER_STAGE);
        Services.prefs.setCharPref("services.blocklist.bucket", "blocklists-preview");
        Services.prefs.setCharPref("services.blocklist.pinning.bucket", "pinning-preview");
        Services.prefs.setCharPref("security.content.signature.root_hash", HASH_STAGE);
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
    const blocklistsBucket = Services.prefs.getCharPref("services.blocklist.bucket");
    const pinningBucket = Services.prefs.getCharPref("services.blocklist.pinning.bucket");
    const pinningEnabled = Services.prefs.getBoolPref("services.blocklist.pinning.enabled");
    const verifySignature = Services.prefs.getBoolPref("services.settings.verify_signature", true);
    const rootHash = Services.prefs.getCharPref("security.content.signature.root_hash");
    const loadDump = Services.prefs.getBoolPref("services.settings.load_dump", true);
    const server = Services.prefs.getCharPref("services.settings.server");
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
   * forceSync() will trigger a synchronization at the level only for the specified client.
   */
  async forceSync(client) {
    const serverTimeMs = Services.prefs.getIntPref("services.settings.last_update_seconds") * 1000;
    const lastModified = Infinity; // Force sync, never up-to-date.
    return client.maybeSync(lastModified, serverTimeMs);
  },

  /**
   * clearPollingStatus() resets the local preferences about the global polling status.
   * It will simulate a profile that has never been synchronized.
   */
  async clearPollingStatus() {
    Services.prefs.clearUserPref("services.settings.last_update_seconds");
    Services.prefs.clearUserPref("services.settings.last_etag");
    Services.prefs.clearUserPref("services.settings.clock_skew_seconds");
    Services.prefs.clearUserPref("services.settings.server.backoff");
  },

  /**
   * pollingStatus() returns the current preferences values about the
   * global polling status.
   */
  async pollingStatus() {
    const etag = Services.prefs.getCharPref("services.settings.last_etag", '""');
    const timestamp = parseInt(etag.replace('"', 0), 10);
    return {
      // Preferences
      server: Services.prefs.getCharPref("services.settings.server"),
      changespath: Services.prefs.getCharPref("services.settings.changes.path"),
      // Status
      backoff: Services.prefs.getCharPref("services.settings.server.backoff", undefined),
      lastPoll: Services.prefs.getIntPref("services.settings.last_update_seconds", 0) * 1000,
      timestamp,
      clockskew: Services.prefs.getIntPref("services.settings.clock_skew_seconds", undefined),
    };
  },

  /**
   * remoteSettingsStatus() returns information about each remote settings collection.
   * TODO: rely on some helper like `RemoteSettings.inspect()`
   * See https://bugzilla.mozilla.org/show_bug.cgi?id=1453692
   */
  async remoteSettingsStatus() {
    const server = Services.prefs.getCharPref("services.settings.server");
    const changespath = Services.prefs.getCharPref("services.settings.changes.path");
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

    const clients = await this.clients();
    const results = [];
    for (const client of clients) {
      const { bucketName: bid, collectionName: cid } = client;
      const url = `${server}/buckets/${bid}/collections/${bid}/records`;
      const lastCheckedSeconds = Services.prefs.getIntPref(client.lastCheckTimePref, undefined);
      const lastChecked = lastCheckedSeconds ? lastCheckedSeconds * 1000 : undefined;
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
    if (client.lastCheckTimePref) {
      Services.prefs.clearUserPref(client.lastCheckTimePref);
    }
    const kintoCol = await client.openCollection();
    return kintoCol.clear();
  },

  /**
   * deleteAllLocal() deletes the local records of every collection.
   */
  async deleteAllLocal() {
    const clients = await this.clients();
    for (const client of clients) {
      await this.deleteLocal(client);
    }
  }
};

async function main() {
  // Populate UI in the background (ie. don't await)
  Promise.all([showPreferences(), showPollingStatus(), showBlocklistStatus()]);

  // Install a wrapper around uptake Telemetry to catch events.
  const original = UptakeTelemetry.report;
  UptakeTelemetry.report = (source, status) => {
    showTelemetryEvent(source, status);
    original(source, status);
  };

  // Change environment.
  const environment = await controller.guessEnvironment();
  const comboEnv = document.getElementById("environment");
  comboEnv.value = environment;
  comboEnv.onchange = async event => {
    await controller.setEnvironment(event.target.value);
    await showPreferences();
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
  return timestamp ? (new Date(timestamp)).toISOString() : "⚠ undefined";
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

async function showPollingStatus() {
  const result = await controller.pollingStatus();
  const { server, backoff, changespath, lastPoll, timestamp, clockskew } = result;

  const url = `${server}${changespath}`;
  document.getElementById("polling-url").textContent = url;
  document.getElementById("polling-url").setAttribute("href", url);
  document.getElementById("backoff").textContent = backoff;
  document.getElementById("last-poll").textContent = asDate(lastPoll);
  document.getElementById("poll-timestamp").textContent = timestamp;
  document.getElementById("clockskew").textContent = clockskew;
  document.getElementById("human-poll-timestamp").textContent = asDate(timestamp);
}

async function showBlocklistStatus() {
  const tpl = document.getElementById("collection-status-tpl");
  const statusList = document.querySelector("#status table tbody");
  const infos = await controller.remoteSettingsStatus();

  statusList.innerHTML = "";

  infos.forEach(info => {
    const { client, url, lastChecked, nbRecords, localTimestamp, remoteTimestamp } = info;

    const tableRowId = `status-${client.identifier}`;
    const infos = tpl.content.cloneNode(true);
    infos.querySelector("tr").setAttribute("id", tableRowId);
    infos.querySelector(".url").textContent = `${client.identifier}`;
    infos.querySelector(".url").setAttribute("href", url);
    infos.querySelector(".human-remote-timestamp").textContent = asDate(remoteTimestamp);
    infos.querySelector(".remote-timestamp").textContent = remoteTimestamp;
    infos.querySelector(".human-local-timestamp").textContent = asDate(localTimestamp);
    infos.querySelector(".local-timestamp").textContent = localTimestamp;
    infos.querySelector(".nb-records").textContent = nbRecords;
    infos.querySelector(".last-check").textContent = client.lastCheckTimePref ? asDate(lastChecked) : "N/A";

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
        document.getElementById(tableRowId).querySelector(".error").textContent = error;
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
