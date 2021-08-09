ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetters(this, {
  Services: "resource://gre/modules/Services.jsm",
  RemoteSettings: "resource://services-settings/remote-settings.js",
});

const { EventManager } = ExtensionCommon;
const { ExtensionError } = ExtensionUtils;

const SERVER_LOCAL = "http://localhost:8888/v1";
const SERVER_PROD = "https://firefox.settings.services.mozilla.com/v1";
const SERVER_STAGE = "https://settings-cdn.stage.mozaws.net/v1";
const HASH_PROD =
  "97:E8:BA:9C:F1:2F:B3:DE:53:CC:42:A4:E6:57:7E:D6:4D:F4:93:C2:47:B4:14:FE:A0:36:81:8D:38:23:56:0E";
const HASH_STAGE =
  "3C:01:44:6A:BE:90:36:CE:A9:A0:9A:CA:A3:A5:20:AC:62:8F:20:A7:AE:32:CE:86:1C:B2:EF:B7:0F:A0:C7:45";
const HASH_LOCAL =
  "5E:36:F2:14:DE:82:3F:8B:29:96:89:23:5F:03:41:AC:AF:A0:75:AF:82:CB:4C:D4:30:7C:3D:B3:43:39:2A:FE";

const MEGAPHONE_STAGE = "https://autopush.stage.mozaws.net";

async function getState() {
  const inspected = await RemoteSettings.inspect();

  const { serverURL, mainBucket } = inspected;
  let environment = "custom";
  if (serverURL == SERVER_PROD) {
    environment = "prod";
  } else if (serverURL == SERVER_STAGE) {
    environment = "stage";
  } else if (serverURL == SERVER_LOCAL) {
    environment = "local";
  }

  if (mainBucket.includes("-preview")) {
    environment += "-preview";
  }

  return {
    pollingEndpoint: RemoteSettings.pollingEndpoint,
    environment,
    ...inspected,
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
              Services.prefs.setCharPref(
                "security.content.signature.root_hash",
                HASH_PROD,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
              Services.prefs.clearUserPref("services.settings.load_dump");
            } else if (env.includes("stage")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_STAGE,
              );
              Services.prefs.setCharPref(
                "security.content.signature.root_hash",
                HASH_STAGE,
              );
              Services.prefs.setCharPref("dom.push.serverURL", MEGAPHONE_STAGE);
              // We don't want to load dumps for stage since the datasets don't always overlap.
              Services.prefs.setBoolPref("services.settings.load_dump", false);
            } else if (env.includes("local")) {
              Services.prefs.setCharPref(
                "services.settings.server",
                SERVER_LOCAL,
              );
              Services.prefs.setCharPref(
                "security.content.signature.root_hash",
                HASH_LOCAL,
              );
              Services.prefs.clearUserPref("dom.push.serverURL");
              Services.prefs.setBoolPref("services.settings.load_dump", false);
            }

            if (env.includes("-preview")) {
              Services.prefs.setCharPref(
                "services.settings.default_bucket",
                "main-preview",
              );
              Services.prefs.setCharPref(
                "services.blocklist.bucket",
                "blocklists-preview",
              );
              Services.prefs.setCharPref(
                "services.blocklist.pinning.bucket",
                "pinning-preview",
              );
            } else {
              Services.prefs.setCharPref(
                "services.settings.default_bucket",
                "main",
              );
              Services.prefs.setCharPref(
                "services.blocklist.bucket",
                "blocklists",
              );
              Services.prefs.setCharPref(
                "services.blocklist.pinning.bucket",
                "pinning",
              );
            }

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
