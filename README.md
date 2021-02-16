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

- Pick the .xpi file from the [releases page](https://github.com/mozilla/remote-settings-devtools/releases).
- When asked for comnfirmation, select "Continue to installation".

> Note: it is highly recommended to use a temporary or development user profile

# Development

```
npm install
```

Run in a browser with live-reload:

```
web-ext run --firefox-binary ~/path/to/firefox -s ./extension/
```

# Release

1. Bump version in ``package.json``, ``update.json``, and ``extension/manifest.json``
2. Tag commit ``git tag -a X.Y.Z`` and push it
3. Create release with changelog on Github
4. Check that ``FirefoxCI`` action has run for tagged commit
5. Request sign-off on Slack channel ``#addons-pipeline``
6. Download signed build from Task Cluster, and attach ``remote-settings-devtools-X.Y.Z.xpi`` binary file on Github release page
