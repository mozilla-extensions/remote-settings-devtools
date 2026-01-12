// Handle migration from resource to moz-src, see bug 1951644.
ChromeUtils.defineLazyGetter(this, "RemoteSettings", () => {
  try {
    return ChromeUtils.importESModule(
      "moz-src:///services/settings/remote-settings.sys.mjs",
    ).RemoteSettings;
  } catch {
    // Fallback to URI format prior to FF 143.
    return ChromeUtils.importESModule(
      "resource://services-settings/remote-settings.sys.mjs",
    ).RemoteSettings;
  }
});

/* global ExtensionAPI, ExtensionCommon, ExtensionUtils, Services */

const { EventManager } = ExtensionCommon;
const { ExtensionError } = ExtensionUtils;

const SERVER_LOCAL = "http://localhost:8888";
const SERVER_PROD = "https://firefox.settings.services.mozilla.com";
const SERVER_STAGE = "https://firefox.settings.services.allizom.org";
const SERVER_DEV = "https://remote-settings-dev.allizom.org";
const MEGAPHONE_STAGE = "wss://autoconnect.stage.mozaws.net";

async function getState() {
  const inspected = await RemoteSettings.inspect();

  const { collections, serverURL, previewMode } = inspected;
  let environment = "custom",
    apiVersion = "v1";

  if (serverURL.startsWith(SERVER_PROD)) {
    environment = "prod";
  } else if (serverURL.startsWith(SERVER_STAGE)) {
    environment = "stage";
  } else if (serverURL.startsWith(SERVER_DEV)) {
    environment = "dev";
  } else if (serverURL.startsWith(SERVER_LOCAL)) {
    environment = "local";
  }

  if (serverURL.endsWith("v2")) {
    apiVersion = "v2";
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

  // If one collection has signature verification enabled, then consider
  // it's enabled for all in the UI.
  const signaturesEnabled = collections.some(({ collection, bucket }) => {
    const c = RemoteSettings(collection, { bucketName: bucket });
    return c.verifySignature;
  });

  return {
    ...inspected,
    environment,
    apiVersion,
    serverSettingIgnored,
    signaturesEnabled,
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
          async switchEnvironment(env, apiVersion = "v1") {
            if (env.includes("prod")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                `${SERVER_PROD}/${apiVersion}`,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
            } else if (env.includes("stage")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                `${SERVER_STAGE}/${apiVersion}`,
              );
              Services.prefs.setCharPref("dom.push.serverURL", MEGAPHONE_STAGE);
            } else if (env.includes("dev")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                `${SERVER_DEV}/${apiVersion}`,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
            } else if (env.includes("local")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                `${SERVER_LOCAL}/${apiVersion}`,
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
           * enableSignatureVerification() enables or disables signature
           * verification on all known collections.
           * @param {bool} enabled true to enable, false to disable
           */
          async enableSignatureVerification(enabled) {
            const { collections } = await RemoteSettings.inspect();
            for (const { collection, bucket } of collections) {
              RemoteSettings(collection, {
                bucketName: bucket,
              }).verifySignature = enabled;
            }
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
