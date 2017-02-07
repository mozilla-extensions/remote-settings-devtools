const INDEX_HTML = "chrome://aboutremotesettings/content/index.html";


function log(...args) {
  console.log(" *** aboutremotesettings: ", ...args);
}


function install(data, reason) {
  log("install", data, reason);
}

function uninstall(data, reason) {
  log("uninstall", data, reason);
}

function startup(data, reason) {
  log("startup", data, reason);
}

function shutdown(data, reason) {
  log("shutdown", data, reason);
}
