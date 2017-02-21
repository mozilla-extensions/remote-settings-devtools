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

  checkVersions() {
    return BlocklistUpdater.checkVersions();
  },

  mainSettings() {
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const blocklistsEnabled = Preferences.get("services.blocklist.update_enabled");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");
    const pinningEnabled = Preferences.get("services.blocklist.pinning.enabled");
    const oneCRLviaAmo = Preferences.get("security.onecrl.via.amo");
    const signing = Preferences.get("services.blocklist.signing.enforced");
    const rootHash = Preferences.get("security.content.signature.root_hash");
    const server = Preferences.get("services.settings.server");

    return Promise.resolve({
      blocklistsBucket,
      blocklistsEnabled,
      pinningBucket,
      pinningEnabled,
      oneCRLviaAmo,
      signing,
      rootHash,
      server,
    });
  },

  clearPollingData() {
    Preferences.reset("services.blocklist.last_update_seconds");
    Preferences.reset("services.blocklist.last_etag");
    Preferences.reset("services.blocklist.clock_skew_seconds");
    Preferences.reset("services.settings.server.backoff");
  },

  pollingStatus() {
    const prefs = [
      // Settings
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
    return Promise.resolve(result);
  },

  blocklistStatus() {
    const server = Preferences.get("services.settings.server");
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");

    const changespath = Preferences.get("services.blocklist.changes.path");
    const monitorUrl = `${server}${changespath}`;

    return fetch(monitorUrl)
      .then((response) => response.json())
      .then(({data}) => {
        return data.reduce((acc, entry) => {
          const {collection, bucket, last_modified} = entry;
          const currentBucket = collection == "pinning" ? pinningBucket : blocklistsBucket;
          if (bucket == currentBucket) {
            acc[collection] = acc[collection] || last_modified;
          }
          return acc;
        }, {});
      })
      .then((timestampsById) => {
        return Promise.all(COLLECTIONS.map((name) => {
          const bucket = name == "pinning" ? pinningBucket : blocklistsBucket;
          const id = Preferences.get(`services.blocklist.${name}.collection`);
          const url = `${server}/buckets/${bucket}/collections/${id}/records`;
          const lastCheckedSeconds = Preferences.get(`services.blocklist.${name}.checked`);
          const lastChecked = lastCheckedSeconds ? new Date(parseInt(lastCheckedSeconds, 10) * 1000) : undefined;
          const timestamp = timestampsById[id];

          return this.fetchLocal(bucket, name)
            .then((local) => {
              const {localTimestamp, records} = local;
              return {id, name, bucket, url, lastChecked, timestamp, localTimestamp, records};
            });
        }));
      })
  },

  xmlStatus() {
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
    return Promise.resolve({url, interval, pingCount, pingTotal, lastUpdate, ageDays});
  },

  refreshXml() {
    const blocklist = Cc["@mozilla.org/extensions/blocklist;1"].getService(Ci.nsITimerCallback);
    return new Promise((resolve) => {
      blocklist.notify(null);
      resolve();
    });
  },

  forceSync(collection) {
    const serverTimeMs = parseInt(Preferences.get("services.blocklist.last_update_seconds"), 10) * 1000;
    const lastModified = Infinity;  // Force sync, never up-to-date.

    const id = Preferences.get(`services.blocklist.${collection}.collection`);
    return CLIENTS[id].maybeSync(lastModified, serverTimeMs);
  },

  _localDb(bucket, collection, callback) {
    // XXX: simplify this using await/async
    const server = "http://unused/v1";
    const path = "kinto.sqlite";
    const config = {remote: server, adapter: FirefoxAdapter, bucket};

    return FirefoxAdapter.openConnection({path})
      .then((sqliteHandle) => {
        const options = Object.assign({}, config, {adapterOptions: {sqliteHandle}})
        const localCollection = new Kinto(options).collection(collection);

        return callback(localCollection)
          .then((result) => {
            return sqliteHandle.close()
              .then(() => result);
          });
      });
  },

  fetchLocal(bucket, collection) {
    const id = Preferences.get(`services.blocklist.${collection}.collection`);
    return this._localDb(bucket, id, (localCollection) => {
      return localCollection.db.getLastModified()
        .then((timestamp) => {
          return localCollection.list()
            .then(({data: records}) => {
              return {localTimestamp: timestamp, records};
            });
          });
      });
  },

  deleteLocal(bucket, collection) {
    Preferences.reset(`services.blocklist.${collection}.checked`);
    const id = Preferences.get(`services.blocklist.${collection}.collection`);
    return this._localDb(bucket, id, (localCollection) => {
      return localCollection.clear();
    });
  },

  deleteAllLocal() {
    const blocklistsBucket = Preferences.get("services.blocklist.bucket");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");
    // Execute delete sequentially.
    return COLLECTIONS.reduce((acc, name) => {
      const bucket = name == "pinning" ? pinningBucket : blocklistsBucket;
      return acc.then(() => controller.deleteLocal(bucket, name));
    }, Promise.resolve([]));
  },
};


function main() {
  showSettings();
  showPollingStatus();
  showBlocklistStatus();
  showXmlStatus();

  // Change environment.
  const environment = controller.guessEnvironment();
  const comboEnv = document.getElementById("environment");
  comboEnv.value = environment;
  comboEnv.onchange = (event) => {
    controller.setEnvironment(event.target.value);
    showSettings();
    showXmlStatus();
  };

  // XML refresh button.
  document.getElementById("xml-refresh").onclick = () => {
    controller.refreshXml()
      .then(() => {
        showXmlStatus();
      });
  }

  // Poll for changes button.
  document.getElementById("run-poll").onclick = () => {
    controller.checkVersions()
      .then(() => {
        showPollingStatus();
        showBlocklistStatus();
      });
  }

  // Reset local polling data.
  document.getElementById("clear-poll-data").onclick = () => {
    controller.clearPollingData();
    showPollingStatus();
  }

  // Clear all data.
  document.getElementById("clear-all-data").onclick = () => {
    controller.clearPollingData();
    showPollingStatus();
    controller.deleteAllLocal()
      .then(showBlocklistStatus);
  }
}


function showSettings() {
  controller.mainSettings()
    .then((result) => {
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
    });
}


function showXmlStatus() {
  controller.xmlStatus()
    .then((result) => {
      const {url, interval, pingCount, pingTotal, lastUpdate, ageDays} = result;

      document.getElementById("xml-url").textContent = url;
      document.getElementById("xml-url").setAttribute("href", url);
      document.getElementById("xml-interval").textContent = interval;
      document.getElementById("xml-pingcount").textContent = pingCount;
      document.getElementById("xml-pingtotal").textContent = pingTotal;
      document.getElementById("xml-lastupdate").textContent = lastUpdate;
      document.getElementById("xml-agedays").textContent = ageDays;
    });
}

function showPollingStatus() {
  controller.pollingStatus()
    .then((result) => {
      const {
        server,
        backoff,
        changespath,
        lastPoll,
        timestamp,
        clockskew } = result;

      const url = `${server}${changespath}`;
      document.getElementById("polling-url").textContent = url;
      document.getElementById("polling-url").setAttribute("href", url);
      document.getElementById("backoff").textContent = backoff;
      document.getElementById("last-poll").textContent = lastPoll;
      document.getElementById("timestamp").textContent = timestamp;
      document.getElementById("human-timestamp").textContent = timestamp ? new Date(timestamp) : undefined;
      document.getElementById("clockskew").textContent = clockskew;
    });
}


function showBlocklistStatus() {
  const tpl = document.getElementById("collection-status-tpl");
  const statusList = document.getElementById("blocklists-status");
  return controller.blocklistStatus()
    .then((collections) => {
      statusList.innerHTML = "";

      collections.forEach((collection) => {
        const {bucket, id, name, url, lastChecked, records, localTimestamp, timestamp} = collection;

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

        infos.querySelector(".clear-data").onclick = () => {
          controller.deleteLocal(bucket, name)
            .then(showBlocklistStatus);
        }
        infos.querySelector(".sync").onclick = () => {
          let error = '';
          controller.forceSync(name)
            .catch((e) => error = e)
            .then(showBlocklistStatus)
            .then(() => {
              if (error) console.log(error);
              document.querySelector(`#status-${id} .error`).textContent = error;
            });
        }
        statusList.appendChild(infos);
      });
    });
}


window.addEventListener("DOMContentLoaded", main);
