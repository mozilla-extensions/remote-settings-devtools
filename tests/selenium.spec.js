const { Browser, Builder, By } = require("selenium-webdriver");
const { Options } = require("selenium-webdriver/firefox");
const FirefoxProfile = require("firefox-profile");
const path = require("path");

// create a static extension ID so we can find it's config page easily
const testExtId = "2d7fbdec-9526-402c-badb-2fca5b65dfa8";
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
});

afterAll(async () => {
  driver.close();
});

// helper function to wait while data is being fetched
async function waitForLoad() {
  do {
    driver.sleep(200);
  } while ((await driver.findElements(By.css(".loading"))).length);
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
    expect((await driver.findElements(By.css("#status .unsync"))).length).toBe(
      0,
    );
    expect(
      (await driver.findElements(By.css("#status .up-to-date"))).length,
    ).toBeGreaterThan(1);

    // clear all data
    await clickByCss("#clear-all-data");
    await driver.sleep(1000); // wait for all collections to be cleared

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
