const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const {Preferences} = Cu.import("resource://gre/modules/Preferences.jsm", {});
const {Kinto} = Cu.import("resource://services-common/kinto-offline-client.js", {});
const {FirefoxAdapter} = Cu.import("resource://services-common/kinto-storage-adapter.js", {});
const BlocklistUpdater = Cu.import("resource://services-common/blocklist-updater.js", {});

const {
  OneCRLBlocklistClient,
  AddonBlocklistClient,
  GfxBlocklistClient,
  PluginBlocklistClient,
  PinningPreloadClient } = Cu.import("resource://services-common/blocklist-clients.js", {});


const controller = {
  checkVersions() {
    return BlocklistUpdater.checkVersions();
  },

  clearPollingData() {
    Preferences.reset("services.blocklist.last_update_seconds");
    Preferences.reset("services.blocklist.last_etag");
  },

  pollingStatus() {
    const prefs = [
      { target: "server",      name: "services.settings.server"} ,
      { target: "backoff",     name: "services.settings.server.backoff" },
      { target: "changespath", name: "services.blocklist.changes.path" },
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
          result[target] = value ? new Date(parseInt(value.replace('"', ''), 10)) : undefined;
          break;
        default:
          result[target] = value;
      }
    }
    return Promise.resolve(result);
  },

  blocklistStatus() {
    const blocklistsEnabled = Preferences.get("services.blocklist.update_enabled");
    const pinningEnabled = Preferences.get("services.blocklist.pinning.enabled");
    const oneCRLviaAmo = Preferences.get("security.onecrl.via.amo");
    const signing = Preferences.get("services.blocklist.signing.enforced");
    const server = Preferences.get("services.settings.server");
    const blocklistBucket = Preferences.get("services.blocklist.bucket");
    const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");

    const changespath = Preferences.get("services.blocklist.changes.path");
    const monitorUrl = `${server}${changespath}`;

    const collectionNames = ["addons", "onecrl", "plugins", "gfx", "pinning"];

    return fetch(monitorUrl)
      .then((response) => response.json())
      .then(({data}) => {
        return data.reduce((acc, entry) => {
          const {collection, last_modified} = entry;
          acc[collection] = acc[collection] || last_modified;
          return acc;
        }, {});
      })
      .then((timestampsById) => {
        return Promise.all(collectionNames.map((name) => {
          const bucket = name == "pinning" ? pinningBucket : blocklistBucket;
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
        }))
        .then((collections) => {
          return {
            blocklistsEnabled,
            pinningEnabled,
            oneCRLviaAmo,
            signing,
            server,
            collections
          }
        });
      })
  },

  forceSync(collection) {
    const serverTimeMs = parseInt(Preferences.get("services.blocklist.last_update_seconds"), 10) * 1000;
    const lastModified = Infinity;  // Force sync, never up-to-date.

    const clientsById = {
      [OneCRLBlocklistClient.collectionName]: OneCRLBlocklistClient,
      [AddonBlocklistClient.collectionName]: AddonBlocklistClient,
      [GfxBlocklistClient.collectionName]: GfxBlocklistClient,
      [PluginBlocklistClient.collectionName]: PluginBlocklistClient,
      [PinningPreloadClient.collectionName]: PinningPreloadClient
    };
    const id = Preferences.get(`services.blocklist.${collection}.collection`);
    return clientsById[id].maybeSync(lastModified, serverTimeMs);
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
};


function main() {
  showPollingStatus();
  showBlocklistStatus();

  // Poll for changes button.
  document.getElementById("run-poll").onclick = () => {
    controller.checkVersions()
      .then(() => {
        showPollingStatus();
        showBlocklistStatus();
      });
  }

  // Reset local data.
  document.getElementById("clear-data").onclick = () => {
    controller.clearPollingData();
    showPollingStatus();
  }
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
      document.getElementById("server").textContent = server;
      document.getElementById("backoff").textContent = backoff;
      document.getElementById("changespath").textContent = changespath;
      document.getElementById("last-poll").textContent = lastPoll;
      document.getElementById("timestamp").textContent = timestamp;
      document.getElementById("clockskew").textContent = clockskew;
    });
}



function showBlocklistStatus() {
  controller.blocklistStatus()
    .then((result) => {
      const {
        blocklistsEnabled,
        pinningEnabled,
        oneCRLviaAmo,
        signing,
        server,
        collections,
      } = result;

      document.getElementById("blocklists-enabled").textContent = blocklistsEnabled;
      document.getElementById("pinning-enabled").textContent = blocklistsEnabled;
      document.getElementById("onecrl-amo").textContent = oneCRLviaAmo;
      document.getElementById("signing").textContent = signing;

      const tpl = document.getElementById("collection-status-tpl");
      const statusList = document.getElementById("blocklists-status");
      statusList.innerHTML = "";

      collections.forEach((collection) => {
        const {bucket, name, url, lastChecked, records, localTimestamp, timestamp} = collection;

        const infos = tpl.content.cloneNode(true);
        infos.querySelector(".blocklist").textContent = name;
        infos.querySelector(".url").textContent = url;
        infos.querySelector(".timestamp").textContent = timestamp ? new Date(timestamp) : undefined;
        infos.querySelector(".local-timestamp").textContent = localTimestamp ? new Date(localTimestamp) : undefined;
        infos.querySelector(".nb-records").textContent = records.length;
        infos.querySelector(".last-check").textContent = lastChecked;

        infos.querySelector(".clear-data").onclick = () => {
          controller.deleteLocal(bucket, name)
            .then(showBlocklistStatus);
        }
        infos.querySelector(".sync").onclick = () => {
          controller.forceSync(name)
            .then(showBlocklistStatus);
        }
        statusList.appendChild(infos);
      });
    });
}


window.addEventListener("DOMContentLoaded", main);
