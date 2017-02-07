const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const {Preferences} = Cu.import("resource://gre/modules/Preferences.jsm", {});
const {Kinto} = Cu.import("resource://services-common/kinto-offline-client.js", {});
const {FirefoxAdapter} = Cu.import("resource://services-common/kinto-storage-adapter.js", {});


function main() {
  showPollingStatus();
  showBlocklistStatus();

  // Poll for changes button.
  const updater = Cu.import("resource://services-common/blocklist-updater.js", {});
  document.getElementById("run-poll").onclick = () => {
    updater.checkVersions()
      .then(showPollingStatus);
  }

  // Reset local data.
  document.getElementById("clear-data").onclick = () => {
    Preferences.reset("services.blocklist.last_update_seconds");
    Preferences.reset("services.blocklist.last_etag");
  }
}


function showPollingStatus() {

  const prefs = [
    { target: "server",         name: "services.settings.server"} ,
    { target: "backoff",        name: "services.settings.server.backoff" },
    { target: "changespath",    name: "services.blocklist.changes.path" },
    { target: "last-poll",      name: "services.blocklist.last_update_seconds" },
    { target: "timestamp",      name: "services.blocklist.last_etag" },
    { target: "clockskew",      name: "services.blocklist.clock_skew_seconds" }
  ];

  for(const pref of prefs) {
    const {target, name} = pref;
    let value = Preferences.get(name);

    switch (target) {
      case "last-poll":
        value = new Date(parseInt(value, 10) * 1000);
        break;
      case "timestamp":
        value = new Date(parseInt(value.replace('"', ''), 10));
        break;
    }

    document.getElementById(target).textContent = value;
  }
}



function showBlocklistStatus() {
  const blocklistsEnabled = Preferences.get("services.blocklist.update_enabled");
  document.getElementById("blocklists-enabled").textContent = blocklistsEnabled;

  const pinningEnabled = Preferences.get("services.blocklist.pinning.enabled");
  document.getElementById("pinning-enabled").textContent = blocklistsEnabled;

  const oneCRLviaAmo = Preferences.get("security.onecrl.via.amo");
  document.getElementById("onecrl-amo").textContent = oneCRLviaAmo;

  const signing = Preferences.get("services.blocklist.signing.enforced");
  document.getElementById("signing").textContent = signing;


  const server = Preferences.get("services.settings.server");
  const blocklistBucket = Preferences.get("services.blocklist.bucket");
  const pinningBucket = Preferences.get("services.blocklist.pinning.bucket");

  const tpl = document.getElementById("collection-status-tpl");
  const statusList = document.getElementById("blocklists-status");
  statusList.innerHTML = "";


  const collections = ["addons", "onecrl", "plugins", "gfx", "pinning"];
  collections.forEach((collection) => {
    const bucket = collection == "pinning" ? pinningBucket : blocklistBucket;
    const collectionId = Preferences.get(`services.blocklist.${collection}.collection`);
    const url = `${server}/buckets/${bucket}/collections/${collectionId}/records`;
    const lastCheckedSeconds = Preferences.get(`services.blocklist.${collection}.checked`);
    const lastChecked = new Date(parseInt(lastCheckedSeconds, 10) * 1000);

    fetchLocal(bucket, collectionId)
      .then((local) => {
        const {timestamp, records} = local;

        const infos = tpl.content.cloneNode(true);
        infos.querySelector(".blocklist").textContent = collection;
        infos.querySelector(".url").textContent = url;
        infos.querySelector(".timestamp").textContent = new Date(timestamp);
        infos.querySelector(".nb-records").textContent = records.length;
        infos.querySelector(".last-check").textContent = lastChecked;
        statusList.appendChild(infos);
      });

  });
}


function fetchLocal(bucket, collection) {
  // XXX: simplify this using await/async

  const server = "http://unused/v1";
  const path = "kinto.sqlite";
  const config = {remote: server, adapter: FirefoxAdapter, bucket};

  return FirefoxAdapter.openConnection({path})
    .then((sqliteHandle) => {
      const options = Object.assign({}, config, {adapterOptions: {sqliteHandle}})
      const localCollection = new Kinto(options).collection(collection);

      return localCollection.db.getLastModified()
        .then((timestamp) => {
          return localCollection.list()
            .then(({data: records}) => {
              return sqliteHandle.close()
                .then(() => {
                  return {timestamp, records};
                });
            })
        });
    });
}


window.addEventListener("DOMContentLoaded", main);
