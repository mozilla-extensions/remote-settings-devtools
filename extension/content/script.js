/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const remotesettings = browser.experiments.remotesettings;

/**
 * Returns a human readable date.
 * @param {String|Integer} timestamp
 */
function humanDate(timestamp) {
  if (!timestamp) {
    return "—";
  }
  if (typeof timestamp == "string") {
    timestamp = parseInt(timestamp.replace(/"/g, ""), 10);
  }
  return new Date(timestamp).toISOString();
}

function showLoading(state) {
  if (state) {
    document.body.className += " loading";
  } else {
    document
      .querySelectorAll(".loading")
      .forEach((el) => (el.className = el.className.replace(" loading", "")));
  }
}

/**
 * Shows an error message for the whole sync.
 * @param {Error} error
 */
function showGlobalError(error) {
  showLoading(false);
  if (error) {
    console.error("Global error", error);
  }
  document.getElementById("polling-error").textContent = error;
}

/**
 * Shows an error message for the whole sync.
 * @param {Error} error
 */
function showSyncError(bucket, collection, error) {
  showLoading(false);
  if (error) {
    console.error(`Sync error for ${bucket}/${collection}`, error);
  }
  const tableRowId = `status-${bucket}/${collection}`;
  const row = document.getElementById(tableRowId);
  row.querySelector(".error").textContent = error;
}
/**
 * Refreshes the whole UI.
 */
async function refreshUI(state) {
  const {
    serverURL,
    serverTimestamp,
    localTimestamp,
    lastCheck,
    collections,
    pollingEndpoint,
    environment,
    history,
    serverSettingIgnored,
    signaturesEnabled,
  } = state;

  showLoading(false);

  const environmentElt = document.getElementById("environment");
  environmentElt.value = environment;
  document.getElementById("environment-error").style.display =
    serverSettingIgnored ? "block" : "none";
  if (serverSettingIgnored) {
    // Disable all options except those related to prod
    environmentElt
      .querySelectorAll("option:not(.prod)")
      .forEach((optionElt) => optionElt.setAttribute("disabled", "disabled"));
  }

  document.getElementById("polling-url").textContent = new URL(
    pollingEndpoint,
  ).origin;
  document.getElementById("polling-url").setAttribute("href", pollingEndpoint);
  document.getElementById("local-timestamp").textContent = localTimestamp;
  document.getElementById("server-timestamp").textContent = serverTimestamp;

  const tsElt = document.getElementById("human-local-timestamp");
  tsElt.className =
    localTimestamp == serverTimestamp ? " up-to-date" : " unsync";
  tsElt.textContent = humanDate(localTimestamp);
  tsElt.setAttribute(
    "title",
    localTimestamp == serverTimestamp ? "Synced" : "Local data is out of sync",
  );

  document.getElementById("human-server-timestamp").textContent =
    humanDate(serverTimestamp);
  document.getElementById("last-check").textContent = humanDate(
    lastCheck * 1000,
  );

  // Sync history.
  const historyTpl = document.getElementById("sync-history-entry-tpl");
  const historyList = document.querySelector("#sync-history > ul");
  historyList.innerHTML = "";
  history["settings-sync"].forEach((entry) => {
    const entryRow = historyTpl.content.cloneNode(true);
    entryRow.querySelector(".datetime").textContent = humanDate(
      entry.timestamp,
    );
    entryRow.querySelector(".status").textContent = entry.status;
    entryRow.querySelector(".status").className += ` ${entry.status}`;
    historyList.appendChild(entryRow);
  });

  // Options
  document.getElementById("enable-signatures").checked = signaturesEnabled;

  // Table of collections.
  const tpl = document.getElementById("collection-status-tpl");
  const statusTable = document.querySelector("#status table tbody");

  statusTable.innerHTML = "";
  collections.forEach((status) => {
    const {
      bucket,
      collection,
      lastCheck: lastCheckCollection,
      localTimestamp: localTimestampCollection,
      serverTimestamp: serverTimestampCollection,
    } = status;
    const url = `${serverURL}/buckets/${bucket}/collections/${collection}/changeset?_expected=${serverTimestamp}`;
    const identifier = `${bucket}/${collection}`;

    const tableRowId = `status-${identifier}`;
    const tableRow = tpl.content.cloneNode(true);
    tableRow.querySelector("tr").setAttribute("id", tableRowId);
    tableRow.querySelector(".url").textContent = identifier;
    tableRow.querySelector(".url").setAttribute("href", url);
    tableRow.querySelector(".human-server-timestamp").textContent = humanDate(
      serverTimestampCollection,
    );
    tableRow.querySelector(".server-timestamp").textContent =
      serverTimestampCollection;
    const tsRowElt = tableRow.querySelector(".human-local-timestamp");
    tsRowElt.className =
      localTimestampCollection == serverTimestampCollection
        ? " up-to-date"
        : " unsync";
    tsRowElt.textContent = humanDate(localTimestampCollection);
    tsRowElt.setAttribute(
      "title",
      localTimestampCollection == serverTimestampCollection
        ? "Synced"
        : "Local data is out of sync",
    );

    tableRow.querySelector(".local-timestamp").textContent = localTimestamp;
    tableRow.querySelector(".last-check").textContent = humanDate(
      lastCheckCollection * 1000,
    );

    tableRow.querySelector("button.clear-data").onclick = async () => {
      document.getElementById(tableRowId).className += " loading";
      await remotesettings.deleteLocal(collection);
    };
    tableRow.querySelector("button.sync").onclick = async () => {
      document.getElementById(tableRowId).className += " loading";
      await remotesettings.forceSync(collection);
    };
    statusTable.appendChild(tableRow);
  });
  const options = {
    valueNames: [
      "collection",
      "last-check",
      "server-timestamp",
      "local-timestamp",
    ],
  };
  // eslint-disable-next-line no-undef
  new List("status-table", options);
}

async function main() {
  // Load the UI in the background.
  remotesettings
    .getState()
    .then((data) => {
      showLoading(false);
      refreshUI(data);
    })
    .catch(showGlobalError);

  remotesettings.onStateChanged.addListener((data) => {
    showLoading(false);
    try {
      refreshUI(JSON.parse(data));
    } catch (e) {
      showGlobalError(e);
    }
  });
  remotesettings.onGlobalError.addListener((error) => showGlobalError(error));
  remotesettings.onSyncError.addListener((data) => {
    const { bucket, collection, error } = JSON.parse(data);
    showSyncError(bucket, collection, error);
  });

  document.getElementById("environment").onchange = async (event) => {
    showGlobalError(null);
    showLoading(true);
    await remotesettings.switchEnvironment(event.target.value);
  };

  document.getElementById("enable-signatures").onchange = async (event) => {
    await remotesettings.enableSignatureVerification(event.target.checked);
  };

  // Poll for changes button.
  document.getElementById("run-poll").onclick = async () => {
    showGlobalError(null);
    showLoading(true);
    await remotesettings.pollChanges();
  };

  // Clear all data.
  document.getElementById("clear-all-data").onclick = async () => {
    showGlobalError(null);
    showLoading(true);
    await remotesettings.deleteAllLocal();
  };
}

window.addEventListener("DOMContentLoaded", main);
