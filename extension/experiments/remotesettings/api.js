ChromeUtils.defineESModuleGetters(this, {
  RemoteSettings: "resource://services-settings/remote-settings.sys.mjs",
});

/* global ExtensionAPI, ExtensionCommon, ExtensionUtils, Services */

const { EventManager } = ExtensionCommon;
const { ExtensionError } = ExtensionUtils;

const SERVER_LOCAL = "http://localhost:8888/v1";
const SERVER_PROD = "https://firefox.settings.services.mozilla.com/v1";
const SERVER_STAGE = "https://firefox.settings.services.allizom.org/v1";
const SERVER_DEV = "https://remote-settings-dev.allizom.org/v1";
const MEGAPHONE_STAGE = "wss://autoconnect.stage.mozaws.net";

async function getState() {
  const inspected = await RemoteSettings.inspect();

  const { serverURL, previewMode } = inspected;
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

  if (previewMode) {
    environment += "-preview";
  }

  // Detect whether user tried to switch server, and whether it had effect or not.
  let serverSettingIgnored = false;
  if (Services.prefs.prefHasUserValue("services.settings.server")) {
    const manuallySet = Services.prefs.getStringPref(
      "services.settings.server",
    );
    if (manuallySet != serverURL) {
      serverSettingIgnored = true;
    }
  }
  // Same for preview mode.
  if (Services.prefs.prefHasUserValue("services.settings.preview_enabled")) {
    const manuallyEnabled = Services.prefs.getBoolPref(
      "services.settings.preview_enabled",
    );
    if (manuallyEnabled && !previewMode) {
      serverSettingIgnored = true;
    }
  }

  return {
    ...inspected,
    environment,
    serverSettingIgnored,
  };
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
            } else if (env.includes("stage")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_STAGE,
              );
              Services.prefs.setCharPref("dom.push.serverURL", MEGAPHONE_STAGE);
            } else if (env.includes("dev")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_DEV,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
            } else if (env.includes("local")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_LOCAL,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
            }

            const previewMode = env.includes("-preview");
            RemoteSettings.enablePreviewMode(previewMode);
            // Set pref to persist change across restarts.
            Services.prefs.setBoolPref(
              "services.settings.preview_enabled",
              previewMode,
            );

            refreshUI();
          },

          /**
           * deleteLocal() deletes the local records of the specified collection.
           * @param {String} collection collection name
           */
          async deleteLocal(collection) {
            try {
              const client = RemoteSettings(collection);
              Services.prefs.clearUserPref(client.lastCheckTimePref);

              await client.db.clear();
              await client.attachments.prune([]);

              refreshUI();
            } catch (e) {
              reportError(e);
            }
          },

          /**
           * forceSync() will trigger a synchronization at the level only for the specified collection.
           * @param {String} collection collection name
           */
          async forceSync(collection) {
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
              for (const { collection } of collections) {
                await this.deleteLocal(collection);
              }

              refreshUI();
            } catch (e) {
              reportError(e);
            }
          },

          onStateChanged: new EventManager({
            context,
            name: "remotesettings.onStateChanged",
            register: (fire) => {
              const observer = async () => {
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
            register: (fire) => {
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
            register: (fire) => {
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
