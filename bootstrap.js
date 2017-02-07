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

  // XXX: here we could have all this code to add a menu entry (like about:sync)
}

function shutdown(data, reason) {
  log("shutdown", data, reason);
}
