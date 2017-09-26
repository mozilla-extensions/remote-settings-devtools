# About Remote Settings

This addon shows information about remote settings updates.

Once installed, visit `about:remotesettings`

![](screenshot.png)

The source code is at https://github.com/leplatrem/aboutremotesettings and pull requests
are welcome!

# Development

The easiest way to develop/debug this is:

* Clone the git repo locally.
* In `about:config`, turn `extensions.legacy.enabled` to `true`
* In `about:debugging`, load the extension by selecting the `chrome.manifest` file
* Open `about:remotesettings`
* Changes on HTML/CSS/JS files are picked up automatically
* Press the *Reload* button in the `about:debugging` to reinstall
