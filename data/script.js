const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const {Preferences} = Cu.import("resource://gre/modules/Preferences.jsm", {});


function main() {
  showPollingStatus();
  showBlocklistStatus();

  // Poll for changes button.
  const updater = Cu.import("resource://services-common/blocklist-updater.js", {});
  const pollButton = document.getElementById("run-poll").onclick = () => {
    updater.checkVersions()
      .then(showPollingStatus);
  }
}


function showPollingStatus() {

  const prefs = [
    { target: "server",         name: "services.settings.server"} ,
    { target: "backoff",        name: "services.settings.server.backoff" },
    { target: "changespath",    name: "services.blocklist.changes.path" },
    { target: "last-poll",      name: "services.blocklist.last_update_seconds" },
    { target: "timestamp",      name: "services.blocklist.last_etag" },
    { target: "humantimestamp", name: "services.blocklist.last_etag" },
    { target: "clockskew",      name: "services.blocklist.clock_skew_seconds"}
  ];

  for(const pref of prefs) {
    const {target, name} = pref;
    let value = Preferences.get(name);

    switch (target) {
      case "last-poll":
        value = new Date(parseInt(value, 10) * 1000);
        break;
      case "humantimestamp":
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

    const infos = tpl.content.cloneNode(true);
    infos.querySelector(".blocklist").textContent = collection;
    infos.querySelector(".url").textContent = url;
    infos.querySelector(".last-check").textContent = lastChecked;
    statusList.appendChild(infos);
  });
}


window.addEventListener("DOMContentLoaded", main);
