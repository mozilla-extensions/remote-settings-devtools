ChromeUtils.defineESModuleGetters(this, {
  RemoteSettings: "resource://services-settings/remote-settings.sys.mjs",
});

const { EventManager } = ExtensionCommon;
const { ExtensionError } = ExtensionUtils;

const SERVER_LOCAL = "http://localhost:8888/v1";
const SERVER_PROD = "https://firefox.settings.services.mozilla.com/v1";
const SERVER_STAGE = "https://firefox.settings.services.allizom.org/v1";
const SERVER_DEV = "https://remote-settings-dev.allizom.org/v1";
const MEGAPHONE_STAGE = "https://autopush.stage.mozaws.net";

async function getState() {
  const inspected = await RemoteSettings.inspect();

  const { serverURL, mainBucket, previewMode } = inspected;
  let environment = "custom";
  switch (serverURL) {
    case SERVER_PROD:
      environment = "prod";
      break;
    case SERVER_STAGE:
      environment = "stage";
      break;
    case SERVER_DEV:
      environment = "dev";
      break;
    case SERVER_LOCAL:
      environment = "local";
      break;
  }

  // Newest versions return the `previewMode` in `inspect()`
  if (mainBucket.includes("-preview") || previewMode) {
    environment += "-preview";
  }

  return {
    pollingEndpoint: RemoteSettings.pollingEndpoint,
    environment,
    ...inspected,
  };
}

function enablePreview(enabled) {
  // Newest versions don't manipulate bucket names from prefs.
  // See https://bugzilla.mozilla.org/show_bug.cgi?id=1702759
  if (typeof RemoteSettings.enablePreviewMode == "function") {
    RemoteSettings.enablePreviewMode(enabled);
    // Set pref to persist change across restarts.
    Services.prefs.setBoolPref("services.settings.preview_enabled", enabled);
    return;
  }

  if (enabled) {
    Services.prefs.setCharPref(
      "services.settings.default_bucket",
      "main-preview",
    );
    Services.prefs.setCharPref(
      "services.blocklist.bucket",
      "blocklists-preview",
    );
    Services.prefs.setCharPref(
      "security.remote_settings.intermediates.bucket",
      "security-state-preview",
    );
    Services.prefs.setCharPref(
      "security.remote_settings.crlite_filters.bucket",
      "security-state-preview",
    );
    Services.prefs.setCharPref(
      "services.settings.security.onecrl.bucket",
      "security-state-preview",
    );
  } else {
    Services.prefs.setCharPref("services.settings.default_bucket", "main");
    Services.prefs.setCharPref("services.blocklist.bucket", "blocklists");
    Services.prefs.setCharPref(
      "security.remote_settings.intermediates.bucket",
      "security-state",
    );
    Services.prefs.setCharPref(
      "security.remote_settings.crlite_filters.bucket",
      "security-state",
    );
    Services.prefs.setCharPref(
      "services.settings.security.onecrl.bucket",
      "security-state",
    );
  }
}

function refreshUI() {
  Services.obs.notifyObservers(null, "remotesettings-state-changed");
}

function reportError(error) {
  // If the error is for a particular collection then some details are attached
  // (see RemoteSettings::pollChanges)
  if (error.details) {
    const { bucket, collection } = error.details;
    console.error(`Error with ${bucket}/${collection}`, error);
    Services.obs.notifyObservers(
      null,
      "remotesettings-sync-error",
      JSON.stringify({
        bucket,
        collection,
        error: error.toString(),
      }),
    );
  } else {
    console.error(error);
    // eg. polling error, network error etc.
    Services.obs.notifyObservers(
      null,
      "remotesettings-global-error",
      error.toString(),
    );
  }
}

var remotesettings = class extends ExtensionAPI {
  getAPI(context) {
    return {
      experiments: {
        remotesettings: {
          getState,

          async pollChanges() {
            // Generate a fake timestamp to bust cache.
            const randomCacheBust = 99990000 + Math.floor(Math.random() * 9999);
            try {
              await RemoteSettings.pollChanges({
                expectedTimestamp: randomCacheBust,
              });
              refreshUI();
            } catch (e) {
              reportError(e);
            }
          },

          /**
           * setEnvironment() will set the necessary internal preferences to switch from
           * an environment to another.
           */
          async switchEnvironment(env) {
            if (env.includes("prod")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_PROD,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
              Services.prefs.clearUserPref("services.settings.load_dump");
            } else if (env.includes("stage")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_STAGE,
              );
              Services.prefs.setCharPref("dom.push.serverURL", MEGAPHONE_STAGE);
              // We don't want to load dumps for stage since the datasets don't always overlap.
              Services.prefs.setBoolPref("services.settings.load_dump", false);
            } else if (env.includes("dev")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_DEV,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
              // We don't want to load dumps for dev since the datasets don't always overlap.
              Services.prefs.setBoolPref("services.settings.load_dump", false);
            } else if (env.includes("local")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_LOCAL,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
              Services.prefs.setBoolPref("services.settings.load_dump", false);
            }

            enablePreview(env.includes("-preview"));

            refreshUI();
          },

          /**
           * clearPollingStatus() resets the local preferences about the global polling status.
           * It will simulate a profile that has never been synchronized.
           */
          async clearPollingStatus() {
            Services.prefs.clearUserPref(
              "services.settings.last_update_seconds",
            );
            Services.prefs.clearUserPref("services.settings.last_etag");
            Services.prefs.clearUserPref(
              "services.settings.clock_skew_seconds",
            );
            Services.prefs.clearUserPref("services.settings.server.backoff");

            refreshUI();
          },

          /**
           * deleteLocal() deletes the local records of the specified bucket/collection.
           * @param {String} bucket  bucket name, likely "main"
           * @param {String} collection collection name
           */
          async deleteLocal(bucket, collection) {
            try {
              const client = RemoteSettings(collection);
              Services.prefs.clearUserPref(client.lastCheckTimePref);

              if (typeof client.openCollection == "function") {
                await (await client.openCollection()).clear();
              } else {
                await client.db.clear();
                await client.attachments.prune([]);
              }

              refreshUI();
            } catch (e) {
              reportError(e);
            }
          },

          /**
           * forceSync() will trigger a synchronization at the level only for the specified bucket/collection.
           * @param {String} bucket  bucket name, likely "main"
           * @param {String} collection collection name
           */
          async forceSync(bucket, collection) {
            try {
              const client = RemoteSettings(collection);
              await client.sync();

              refreshUI();
            } catch (e) {
              reportError(e);
            }
          },

          /**
           * deleteAllLocal() deletes the local records of every known collection.
           */
          async deleteAllLocal() {
            try {
              const { collections } = await RemoteSettings.inspect();
              // Delete each collection sequentially to avoid collisions in IndexedBD.
              for (const { bucket, collection } of collections) {
                await this.deleteLocal(bucket, collection);
              }

              refreshUI();
            } catch (e) {
              reportError(e);
            }
          },

          onStateChanged: new EventManager({
            context,
            name: "remotesettings.onStateChanged",
            register: fire => {
              const observer = async (subject, topic, data) => {
                const state = await getState();
                fire.async(JSON.stringify(state));
              };
              Services.obs.addObserver(
                observer,
                "remotesettings-state-changed",
              );
              Services.obs.addObserver(
                observer,
                "remote-settings-changes-polled",
              );
              return () => {
                Services.obs.removeObserver(
                  observer,
                  "remotesettings-state-changed",
                );
                Services.obs.removeObserver(
                  observer,
                  "remote-settings-changes-polled",
                );
              };
            },
          }).api(),

          onGlobalError: new EventManager({
            context,
            name: "remotesettings.onGlobalError",
            register: fire => {
              const observer = (subject, topic, data) => {
                fire.async(data);
              };
              Services.obs.addObserver(observer, "remotesettings-global-error");
              return () =>
                Services.obs.removeObserver(
                  observer,
                  "remotesettings-global-error",
                );
            },
          }).api(),

          onSyncError: new EventManager({
            context,
            name: "remotesettings.onSyncError",
            register: fire => {
              const observer = (subject, topic, data) => {
                fire.async(data);
              };
              Services.obs.addObserver(observer, "remotesettings-sync-error");
              return () =>
                Services.obs.removeObserver(
                  observer,
                  "remotesettings-sync-error",
                );
            },
          }).api(),
        },
      },
    };
  }
};
