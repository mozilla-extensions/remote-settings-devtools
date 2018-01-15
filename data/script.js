const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const {Preferences} = Cu.import("resource://gre/modules/Preferences.jsm", {});
const {Kinto} = Cu.import("resource://services-common/kinto-offline-client.js", {});
const {FirefoxAdapter} = Cu.import("resource://services-common/kinto-storage-adapter.js", {});
const BlocklistUpdater = Cu.import("resource://services-common/blocklist-updater.js", {});
const {UpdateUtils} = Cu.import("resource://gre/modules/UpdateUtils.jsm");

const {
  OneCRLBlocklistClient,
  AddonBlocklistClient,
  GfxBlocklistClient,
  PluginBlocklistClient,
  PinningPreloadClient } = Cu.import("resource://services-common/blocklist-clients.js", {});


const CLIENTS = {
  [OneCRLBlocklistClient.collectionName]: OneCRLBlocklistClient,
  [AddonBlocklistClient.collectionName]: AddonBlocklistClient,
  [GfxBlocklistClient.collectionName]: GfxBlocklistClient,
  [PluginBlocklistClient.collectionName]: PluginBlocklistClient,
  [PinningPreloadClient.collectionName]: PinningPreloadClient
};

const SERVER_PROD  = "https://firefox.settings.services.mozilla.com/v1";
const SERVER_STAGE = "https://settings.stage.mozaws.net/v1";
const XML_SUFFIX   = "3/%APP_ID%/%APP_VERSION%/%PRODUCT%/%BUILD_ID%/%BUILD_TARGET%/%LOCALE%/%CHANNEL%/%OS_VERSION%/%DISTRIBUTION%/%DISTRIBUTION_VERSION%/%PING_COUNT%/%TOTAL_PING_COUNT%/%DAYS_SINCE_LAST_PING%/";
const HASH_PROD    = "97:E8:BA:9C:F1:2F:B3:DE:53:CC:42:A4:E6:57:7E:D6:4D:F4:93:C2:47:B4:14:FE:A0:36:81:8D:38:23:56:0E";
const HASH_STAGE   = "DB:74:CE:58:E4:F9:D0:9E:E0:42:36:BE:6C:C5:C4:F6:6A:E7:74:7D:C0:21:42:7A:03:BC:2F:57:0C:8B:9B:90";

const COLLECTIONS = ["addons", "onecrl", "plugins", "gfx", "pinning"];


const controller = {

  /**
   * guessEnvironment() will read the current preferences and return the
   * environment name (suffixed with `preview` if relevant).
   */
  guessEnvironment() {
    const server = Preferences.get("services.settings.server");
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");
    let environment = "custom";
    if (server == SERVER_PROD) {
      environment = "prod";
    } else if (server == SERVER_STAGE) {
      environment = "stage";
    }
    if (/-preview$/.test(blocklistsBucket) && /-preview$/.test(pinningBucket)) {
      environment += "-preview";
    }
    return environment;
  },

  /**
   * setEnvironment() will set the necessary internal preferences to switch from
   * an environment to another.
   */
  setEnvironment(env) {
    switch(env) {
      case "prod":
        Preferences.set("services.settings.server",             SERVER_PROD);
        Preferences.set("services.blocklist.bucket",            "blocklists");
        Preferences.set("services.blocklist.pinning.bucket",    "pinning");
        Preferences.set("security.content.signature.root_hash", HASH_PROD);
        for(const client of Object.values(CLIENTS)) { client.bucketName = "blocklists"; }
        PinningPreloadClient.bucketName = "pinning";
        Preferences.set("extensions.blocklist.url", `${SERVER_PROD}/blocklist/${XML_SUFFIX}`);
        break;
      case "prod-preview":
        Preferences.set("services.settings.server",             SERVER_PROD);
        Preferences.set("services.blocklist.bucket",            "blocklists-preview");
        Preferences.set("services.blocklist.pinning.bucket",    "pinning-preview");
        Preferences.set("security.content.signature.root_hash", HASH_PROD);
        for(const client of Object.values(CLIENTS)) { client.bucketName = "blocklists-preview"; }
        PinningPreloadClient.bucketName = "pinning-preview";
        Preferences.set("extensions.blocklist.url", `${SERVER_PROD}/preview/${XML_SUFFIX}`);
        break;
      case "stage":
        Preferences.set("services.settings.server",             SERVER_STAGE);
        Preferences.set("services.blocklist.bucket",            "blocklists");
        Preferences.set("services.blocklist.pinning.bucket",    "pinning");
        Preferences.set("security.content.signature.root_hash", HASH_STAGE);
        for(const client of Object.values(CLIENTS)) { client.bucketName = "blocklists"; }
        PinningPreloadClient.bucketName = "pinning";
        Preferences.set("extensions.blocklist.url", `${SERVER_STAGE}/blocklist/${XML_SUFFIX}`);
        break;
      case "stage-preview":
        Preferences.set("services.settings.server",             SERVER_STAGE);
        Preferences.set("services.blocklist.bucket",            "blocklists-preview");
        Preferences.set("services.blocklist.pinning.bucket",    "pinning-preview");
        Preferences.set("security.content.signature.root_hash", HASH_STAGE);
        for(const client of Object.values(CLIENTS)) { client.bucketName = "blocklists-preview"; }
        PinningPreloadClient.bucketName = "pinning-preview";
        Preferences.set("extensions.blocklist.url", `${SERVER_STAGE}/preview/${XML_SUFFIX}`);
        break;
    }
  },

  /**
   * mainPreferences() returns the values of the internal preferences related to remote settings.
   */
  async mainPreferences() {
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const blocklistsEnabled = Preferences.get("services.blocklist.update_enabled");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");
    const pinningEnabled = Preferences.get("services.blocklist.pinning.enabled");
    const oneCRLviaAmo = Preferences.get("security.onecrl.via.amo");
    const signing = Preferences.get("services.blocklist.signing.enforced");
    const rootHash = Preferences.get("security.content.signature.root_hash");
    const server = Preferences.get("services.settings.server");

    return {
      blocklistsBucket,
      blocklistsEnabled,
      pinningBucket,
      pinningEnabled,
      oneCRLviaAmo,
      signing,
      rootHash,
      loadDump,
      server,
    };
  },

  /**
   * synchronizeRemoteSettings() is the one of the main synchronization actions. It triggers
   * a Kinto remote settings synchronization, as it would from the XPCOM registry.
   * https://searchfox.org/mozilla-central/rev/137f1b2f434346a0c3756ebfcbdbee4069e15dc8/toolkit/mozapps/extensions/nsBlocklistService.js#596
   */
  async synchronizeRemoteSettings() {
    return BlocklistUpdater.checkVersions();
  },

  /**
   * refreshXml() is the global synchronization action. It triggers everything, from
   * XML refresh to Kinto remote settings synchronization.
   * https://searchfox.org/mozilla-central/rev/137f1b2f434346a0c3756ebfcbdbee4069e15dc8/toolkit/mozapps/extensions/nsBlocklistService.js#483
   */
  async refreshXml() {
    const blocklist = Cc["@mozilla.org/extensions/blocklist;1"].getService(Ci.nsITimerCallback);
    blocklist.notify(null);
    // It's super complicated to get a signal when it's done. Just wait for now.
    await new Promise((resolve) => {
      setTimeout(resolve, 5000)
    });
  },

  /**
   * forceSync() will trigger a synchronization at the Kinto level only for the specified collection.
   */
  async forceSync(collection) {
    const serverTimeMs = parseInt(Preferences.get("services.blocklist.last_update_seconds"), 10) * 1000;
    const lastModified = Infinity;  // Force sync, never up-to-date.

    const id = Preferences.get(`services.blocklist.${collection}.collection`);
    return CLIENTS[id].maybeSync(lastModified, serverTimeMs);
  },

  /**
   * clearPollingStatus() resets the local preferences about the global polling status.
   * It will simulate a profile that has never been synchronized.
   */
  async clearPollingStatus() {
    Preferences.reset("services.blocklist.last_update_seconds");
    Preferences.reset("services.blocklist.last_etag");
    Preferences.reset("services.blocklist.clock_skew_seconds");
    Preferences.reset("services.settings.server.backoff");
  },

  /**
   * pollingStatus() returns the current preferences values about the
   * global polling status.
   */
  async pollingStatus() {
    const prefs = [
      // Preferences
      { target: "server",      name: "services.settings.server"} ,
      { target: "changespath", name: "services.blocklist.changes.path" },
      // Status
      { target: "backoff",     name: "services.settings.server.backoff" },
      { target: "lastPoll",    name: "services.blocklist.last_update_seconds" },
      { target: "timestamp",   name: "services.blocklist.last_etag" },
      { target: "clockskew",   name: "services.blocklist.clock_skew_seconds" }
    ];
    const result = {};
    for(const pref of prefs) {
      const {target, name} = pref;
      const value = Preferences.get(name);
      switch (target) {
        case "lastPoll":
          result[target] = value ? new Date(parseInt(value, 10) * 1000) : undefined;
          break;
        case "timestamp":
          result[target] = value ? parseInt(value.replace('"', ''), 10) : undefined;
          break;
        default:
          result[target] = value;
      }
    }
    return result;
  },

  /**
   * blocklistStatus() returns information about each blocklist collection.
   */
  async blocklistStatus() {
    const server = Preferences.get("services.settings.server");
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");

    const changespath = Preferences.get("services.blocklist.changes.path");
    const monitorUrl = `${server}${changespath}`;

    const response = await fetch(monitorUrl);
    const {data} = await response.json();

    const timestampsById = data.reduce((acc, entry) => {
      const {collection, bucket, last_modified} = entry;
      const currentBucket = collection == "pinning" ? pinningBucket : blocklistsBucket;
      if (bucket == currentBucket) {
        acc[collection] = acc[collection] || last_modified;
      }
      return acc;
    }, {});

    return Promise.all(COLLECTIONS.map(async (name) => {
      const bucket = name == "pinning" ? pinningBucket : blocklistsBucket;
      const id = Preferences.get(`services.blocklist.${name}.collection`);
      const url = `${server}/buckets/${bucket}/collections/${id}/records`;
      const lastCheckedSeconds = Preferences.get(`services.blocklist.${name}.checked`);
      const lastChecked = lastCheckedSeconds ? new Date(parseInt(lastCheckedSeconds, 10) * 1000) : undefined;
      const timestamp = timestampsById[id];

      const local = await this.fetchLocal(bucket, name);
      const {localTimestamp, records} = local;
      return {
        id,
        name,
        bucket,
        url,
        lastChecked,
        timestamp,
        localTimestamp,
        records
      };
    }));
  },

  /**
   * xmlStatus() returns information about the legacy XML blocklist file.
   */
  async xmlStatus() {
    const urlTemplate = Preferences.get("extensions.blocklist.url");
    const interval    = Preferences.get("extensions.blocklist.interval");
    const pingCount   = Preferences.get("extensions.blocklist.pingCountVersion");
    const pingTotal   = Preferences.get("extensions.blocklist.pingCountTotal");
    const updateEpoch = parseInt(Preferences.get("app.update.lastUpdateTime.blocklist-background-update-timer"), 10);

    const distribution        = Preferences.get("distribution.id") || "default";
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
    const url = urlTemplate.replace("%APP_ID%", app.ID)
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

  async _localDb(bucket, collection, callback) {
    const server = "http://unused/v1";
    const path = "kinto.sqlite";
    const config = {remote: server, adapter: FirefoxAdapter, bucket};

    const sqliteHandle = await FirefoxAdapter.openConnection({path});
    const options = Object.assign({}, config, {adapterOptions: {sqliteHandle}})
    const localCollection = new Kinto(options).collection(collection);

    const result = await callback(localCollection);
    await sqliteHandle.close();
    return result;
  },

  /**
   * fetchLocal() returns the records from the local database for the specified bucket/collection.
   */
  async fetchLocal(bucket, collection) {
    const id = Preferences.get(`services.blocklist.${collection}.collection`);
    return this._localDb(bucket, id, async (localCollection) => {
      const timestamp = await localCollection.db.getLastModified();
      const {data: records} = await localCollection.list();
      return {localTimestamp: timestamp, records};
    });
  },

  /**
   * deleteLocal() deletes the local records of the specified bucket/collection.
   */
  async deleteLocal(bucket, collection) {
    Preferences.reset(`services.blocklist.${collection}.checked`);
    const id = Preferences.get(`services.blocklist.${collection}.collection`);
    return this._localDb(bucket, id, async (localCollection) => {
      await localCollection.clear();
    });
  },

  /**
   * deleteAllLocal() deletes the local records of every collection.
   */
  async deleteAllLocal() {
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");
    // Execute delete sequentially.
    await Promise.all(COLLECTIONS.map(async (name) => {
      const bucket = name == "pinning" ? pinningBucket : blocklistsBucket;
      await controller.deleteLocal(bucket, name);
    }));
  },
};


async function main() {
  // Populate UI in the background (ie. don't await)
  Promise.all([
    showPreferences(),
    showPollingStatus(),
    showBlocklistStatus(),
    showXmlStatus()
  ]);

  // Change environment.
  const environment = controller.guessEnvironment();
  const comboEnv = document.getElementById("environment");
  comboEnv.value = environment;
  comboEnv.onchange = async (event) => {
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
  }

  // Poll for changes button.
  document.getElementById("run-poll").onclick = async () => {
    try {
      await controller.synchronizeRemoteSettings()
    } catch(e) {
      showGlobalError(e)
    }
    await showPollingStatus();
    await showBlocklistStatus();
  }

  // Reset local polling data.
  document.getElementById("clear-poll-data").onclick = async () => {
    await controller.clearPollingStatus();
    await showPollingStatus();
  }

  // Clear all data.
  document.getElementById("clear-all-data").onclick = async () => {
    try {
      await controller.clearPollingStatus();
      await controller.deleteAllLocal();
    } catch(e) {
      showGlobalError(e)
    }
    await showPollingStatus();
    await showBlocklistStatus();
  }
}


function asDate(timestamp) {
  return timestamp ? new Date(timestamp) : "⚠ undefined";
}

function showGlobalError(error) {
  document.getElementById("polling-error").textContent = error;
}

async function showPreferences() {
  const result = await controller.mainPreferences();
  const {
    blocklistsBucket,
    blocklistsEnabled,
    pinningBucket,
    pinningEnabled,
    oneCRLviaAmo,
    signing,
    rootHash,
    server,
  } = result;

  document.getElementById("server").textContent = server;
  document.getElementById("server").setAttribute("href", server);
  document.getElementById("blocklists-bucket").textContent = blocklistsBucket;
  document.getElementById("blocklists-enabled").textContent = blocklistsEnabled;
  document.getElementById("pinning-bucket").textContent = pinningBucket;
  document.getElementById("pinning-enabled").textContent = blocklistsEnabled;
  document.getElementById("onecrl-amo").textContent = oneCRLviaAmo;
  document.getElementById("signing").textContent = signing;
  document.getElementById("root-hash").textContent = rootHash;
}


async function showXmlStatus() {
  const result = await controller.xmlStatus();
  const {
    url,
    interval,
    pingCount,
    pingTotal,
    lastUpdate,
    ageDays
  } = result;

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
  const {
    server,
    backoff,
    changespath,
    lastPoll,
    timestamp,
    clockskew,
  } = result;

  const url = `${server}${changespath}`;
  document.getElementById("polling-url").textContent = url;
  document.getElementById("polling-url").setAttribute("href", url);
  document.getElementById("backoff").textContent = backoff;
  document.getElementById("last-poll").textContent = lastPoll;
  document.getElementById("timestamp").textContent = timestamp;
  document.getElementById("human-timestamp").textContent = timestamp ? new Date(timestamp) : undefined;
}


async function showBlocklistStatus() {
  const tpl = document.getElementById("collection-status-tpl");
  const statusList = document.getElementById("blocklists-status");
  const collections = await controller.blocklistStatus();

  statusList.innerHTML = "";

  collections.forEach((collection) => {
    const {
      bucket,
      id,
      name,
      url,
      lastChecked,
      records,
      localTimestamp,
      timestamp,
    } = collection;

    const infos = tpl.content.cloneNode(true);
    infos.querySelector("div").setAttribute("id", `status-${id}`);
    infos.querySelector(".blocklist").textContent = name;
    infos.querySelector(".url a").textContent = `${bucket}/${id}`;
    infos.querySelector(".url a").setAttribute("href", url);
    infos.querySelector(".human-timestamp").textContent = timestamp ? new Date(timestamp) : "⚠ undefined";
    infos.querySelector(".timestamp").textContent = timestamp;
    infos.querySelector(".human-local-timestamp").textContent = localTimestamp ? new Date(localTimestamp) : undefined;
    infos.querySelector(".local-timestamp").textContent = localTimestamp;
    infos.querySelector(".nb-records").textContent = records.length;
    infos.querySelector(".last-check").textContent = lastChecked;

    infos.querySelector(".clear-data").onclick = async () => {
      await controller.deleteLocal(bucket, name)
      await showBlocklistStatus();
    }
    infos.querySelector(".sync").onclick = async () => {
      let error = '';
      try {
        await controller.forceSync(name)
      } catch(e) {
        error = e;
      }
      await showBlocklistStatus();
      if (error) {
        console.log(error);
        document.querySelector(`#status-${id} .error`).textContent = error;
      }
    }
    statusList.appendChild(infos);
  });
}


window.addEventListener("DOMContentLoaded", main);
