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

- Open ``about:debugging``
- Load temporary addon and pick the .zip file from the [releases page](https://github.com/mozilla/remote-settings-devtools/releases)

> Note: it is highly recommended to use a temporary or development user profile

# Development

```
npm install
```

Run in a browser with live-reload:

```
web-ext run --firefox-binary ~/path/to/firefox -s ./extension/
```
