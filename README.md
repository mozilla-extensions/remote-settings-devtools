# Remote Settings Devtools

This addon provides some tools to assist developers with remote settings.

# Features

- Trigger synchronization manually
- Inspect local data
- Clear local data
- Switch from/to STAGE and PROD

![](screenshot.png)

# Planned Features

- Load from preview collections

# Install

- Pick the .xpi file from the [releases page](https://github.com/mozilla-extensions/remote-settings-devtools/releases).
- When asked for comnfirmation, select "Continue to installation".

> Note: it is highly recommended to use a temporary or development user profile

# Development


This addon relies on the [Experiments API](https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/basics.html#webextensions-experiments) in order to expose Remote Settings internals to the Web Extension.

Unsigned addons with experiments can only be loaded in Firefox Nightly and Developer Edition, with specific preferences set.

1. Download [Nightly](https://www.mozilla.org/en-US/firefox/channel/desktop/#nightly)
2. Install dependencies with `npm install`
3. We'll use the `web-ext` runner, with a persistent profile:
```bash
npx web-ext run --verbose --firefox-binary /path/to/nightly/firefox -s extension --firefox-profile rs-devtools --profile-create-if-missing
```
4. (*first run only*) Adjust preferences in `about:config`:
- `xpinstall.signatures.required`: `false`
- `extensions.experiments.enabled`: `true`
5. Reload the addon to take these prefs changes into account, in `about:debugging`
6. Enjoy!

# Release

### Prerequisites (get access to Ship-It)

1. Create a ticket to be added to the VPN group (can clone and edit [this Bugzilla ticket](https://bugzilla.mozilla.org/show_bug.cgi?id=1740098))
2. Ask in the [#addons-pipeline](https://mozilla.slack.com/archives/CMKP7NPKN) channel to be added to the `XPI_PRIVILEGED_BUILD_GROUP` to get access to create an XPI release for `remote-settings-devtools` on [Ship-It](https://shipit.mozilla-releng.net/)

### Create a new tag/release

1. Bump version in `package.json`, `update.json` (has **three** version instances that need to be updated), and `extension/manifest.json`
2. Tag commit `git tag -a X.Y.Z` and push it `git push origin X.Y.Z`
3. Create release with changelog on [GitHub's releases page](https://github.com/mozilla-extensions/remote-settings-devtools/releases/new)
4. Check that `FirefoxCI` action has run for tagged commit

### Create release on Ship-It

1. Ensure you're connected to the VPN
2. Go to [Ship-It](https://shipit.mozilla-releng.net/)
3. Login with SSO at the top right
4. Click `NEW XPI RELEASE` at the top and select the following options:
    - `Available XPIs` &#8594; `remote-settings-devtools`
    - `Available revisions` &#8594; revision with the commit hash associated with the tag that's being released
5. Ensure the version that was tagged is the one shown
6. Select `CREATE RELEASE` &#8594; `SUBMIT`
7. Scroll to the bottom of the [pending releases page](https://shipit.mozilla-releng.net/xpi)
8. Click `Build` on the new release labeled `remote-settings-devtools-X.Y.Z-build1`
9. Go to [#addons-pipeline](https://mozilla.slack.com/archives/CMKP7NPKN) and request sign off:
    > Hi! There's a new version of the remote-settings-devtools extension, remote-settings-devtools-X.Y.Z, ready for sign off. It does THIS AND THAT. Thank you!

### Download signed binary from Taskcluster

1. Go to [XPI Releases](https://shipit.mozilla-releng.net/xpi)
2. Click on `Promote task` on the XPI release you want to download the signed binary from, which will take you to Taskcluster
3. Click on the `release-signing-remote-settings-devtools` task
4. Click the `Artifacts` dropdown on the right side of the page
5. Download the artifact named `public/build/remote-settings-devtools.xpi` to your machine
6. Append `-X.Y.Z` to the end of the filename
7. Attach `remote-settings-devtools-X.Y.Z.xpi` signed binary file to the corresponding GitHub release

Additional information may be found [here](https://github.com/mozilla-extensions/xpi-manifest/blob/master/docs/releasing-a-xpi.md#kicking-off-the-release).
