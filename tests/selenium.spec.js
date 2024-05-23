const { Browser, Builder, By } = require("selenium-webdriver");
const { Options } = require("selenium-webdriver/firefox");
const FirefoxProfile = require("firefox-profile");
const path = require("path");

// create a static extension ID so we can find it's config page easily
const testExtId = "2d7fbdec-9526-402c-badb-2fca5b65dfa8";

const busyWait = 200; // debounce
let driver = null;

beforeAll(async () => {
  // create a firefox profile that has our extension added to it
  const xpiPath = path.resolve(
    "./web-ext-artifacts/remote-settings-devtools.xpi",
  );
  let profile = new FirefoxProfile();
  profile.addExtension(xpiPath, (err, details) => {}); // empty function is required to load

  // setup firefox options that will allow our extension to run
  const options = new Options(profile.path());
  options.setBinary(process.env.NIGHTLY_PATH || "/usr/bin/firefox-nightly");
  options.addArguments("--pref 'extensions.experiments.enabled=true'");
  options.addArguments("--headless");
  options.setPreference("xpinstall.signatures.required", false);
  options.setPreference("extensions.experiments.enabled", true);
  options.setPreference(
    "extensions.webextensions.uuids",
    JSON.stringify({
      "remote-settings-devtools@mozilla.com": testExtId,
    }),
  );

  driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .build();

  // install the addon
  await driver.installAddon(xpiPath);
  await driver.get(`moz-extension://${testExtId}/content/index.html`);

  // add mutation observer to listen for loading events
  // whenever an event flips from loading to unloading, update a hidden element to debounce
  await driver.executeScript(`
    const lastLoad = document.createElement('input');
    lastLoad.id = "hdnLastLoad";
    lastLoad.setAttribute('value', 0);
    
    const observer = new MutationObserver((mutations) => {
      for (let m of mutations) {
        if (m.attributeName === "class" && m.oldValue?.includes("loading")) {
          lastLoad.setAttribute('value', new Date().getTime());
        }
      }
    });
    
    observer.observe(document.querySelector('body'), {
      subtree: true,
      childList: true,
      attributeOldValue: true,
      attributeFilter: ["class"],
    });

    document.querySelector('body').append(lastLoad);
  `);
});

afterAll(async () => {
  driver.close();
});

// helper function to wait while data is being fetched
async function waitForLoad() {
  let hasLoadingElements = false,
    debounceValue = 0;
  do {
    await driver.sleep(busyWait);
    hasLoadingElements = !!(await driver.findElements(By.css(".loading"))).length;
    debounceValue = Number(await driver.findElement(By.id("hdnLastLoad")).getAttribute('value'));
  } while (hasLoadingElements || debounceValue + busyWait > new Date().getTime());
}

// making this a little easier to read in tests
async function clickByCss(css) {
  let element = await driver.findElement(By.css(css));
  await element.click();
}

describe("End to end browser tests", () => {
  test("Load extension, change environment to prod, sync and clear all", async () => {
    // select prod environment from dropdown
    await clickByCss("#environment");
    await clickByCss('#environment [value="prod"]');
    await waitForLoad();

    // verify table loads as expected and we have unsync'd data
    expect(
      (await driver.findElements(By.css("#status tr"))).length,
    ).toBeGreaterThan(1);
    expect(
      (await driver.findElements(By.css("#status .unsync"))).length,
    ).toBeGreaterThan(1);

    // pull latest data
    await clickByCss("#run-poll");
    await waitForLoad();

    // verify data as sync'd as expected
    expect((await driver.findElements(By.css("#status .unsync"))).length).toBeLessThan(
      4, // allowing for a few collections to fail due to networking issues in automated test
    );
    expect(
      (await driver.findElements(By.css("#status .up-to-date"))).length,
    ).toBeGreaterThan(1);

    // clear all data
    await clickByCss("#clear-all-data");
    await waitForLoad();

    // verify everything is cleared as expected
    expect(
      (await driver.findElements(By.css("#status .unsync"))).length,
    ).toBeGreaterThan(1);
    expect(
      (await driver.findElements(By.css("#status .up-to-date"))).length,
    ).toBe(0);
  });

  test("Clear and re-download a collection", async () => {
    // force sync the first collection and verify it worked
    await clickByCss("#status .sync");
    await waitForLoad();
    let firstTimestamp = await driver.findElement(
      By.css("#status .human-local-timestamp"),
    );
    expect(await firstTimestamp.getAttribute("class")).toContain("up-to-date");

    // force sync the first collection and verify it worked
    await clickByCss("#status .clear-data");
    await waitForLoad();
    firstTimestamp = await driver.findElement(
      By.css("#status .human-local-timestamp"),
    );
    expect(await firstTimestamp.getAttribute("class")).toContain("unsync");
  });
});
