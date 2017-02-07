const {classes: Cc, interfaces: Ci, utils: Cu} = Components;


function main() {
  showPollingStatus();
}


function showPollingStatus() {
  const {Preferences} = Cu.import("resource://gre/modules/Preferences.jsm", {});

  const prefs = [
    { target: "server",         name: "services.settings.server"} ,
    { target: "backoff",        name: "services.settings.server.backoff" },
    { target: "changespath",    name: "services.blocklist.changes.path" },
    { target: "last-poll",      name: "services.blocklist.last_update_seconds" },
    { target: "timestamp",      name: "services.blocklist.last_etag" },
    { target: "humantimestamp", name: "services.blocklist.last_etag" },
    { target: "clockskew",      name: "services.blocklist.clock_skew_seconds "}
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

    document.getElementById(target).innerHTML = value;
  }
}


window.addEventListener("DOMContentLoaded", main);
