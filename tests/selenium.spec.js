const { Browser, Builder, By } = require('selenium-webdriver');
const { Options } = require('selenium-webdriver/firefox');
const FirefoxProfile = require('firefox-profile');
const path = require('path');

const testExtId = "2d7fbdec-9526-402c-badb-2fca5b65dfa8";
let driver = null;

beforeAll(async() => {
  const xpiPath = path.resolve('./web-ext-artifacts/remote-settings-devtools.xpi');
  let profile = new FirefoxProfile()
  profile.addExtension(xpiPath, (err, details) => { });

  const options = new Options(profile.path());

  options.setBinary("/usr/bin/firefox-nightly");
  options.addArguments("--pref 'extensions.experiments.enabled=true'");
  options.setPreference("xpinstall.signatures.required", false);
  options.setPreference("extensions.experiments.enabled", true);
  options.setPreference("extensions.webextensions.uuids", JSON.stringify({
    "remote-settings-devtools@mozilla.com": testExtId
  }));
  
  driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .build();

  await driver.installAddon(xpiPath);
  await driver.get(`moz-extension://${testExtId}/content/index.html`);
  // let element = await driver.findElement(By.css('body'));
  (await driver.findElements(By.css('#status tr')))
});


afterAll(async() => {
  driver.close();
});


async function waitForLoad() {
  let body = await driver.findElement(By.css("body"));
  while (await body.getAttribute('class') !== '') {
    driver.sleep(200);
  }
}


describe("End to end browser tests", () => {
  test("Load extension, change environment to prod, and sync", async() => {
    let ddlEnvironment = await driver.findElement(By.id("environment"));
    await ddlEnvironment.click();
    await (await ddlEnvironment.findElement(By.css('[value="prod"]'))).click();
    await waitForLoad();
    
    // verify table loads as expected and we have unsync'd data
    expect((await driver.findElements(By.css('#status tr'))).length).toBeGreaterThan(1);
    expect((await driver.findElements(By.css('#status .unsync'))).length).toBeGreaterThan(1);

    // pull latest data
    await (await driver.findElement(By.id("run-poll"))).click();
    await waitForLoad();
    
    // verify data as sync'd as expected
    expect((await driver.findElements(By.css('#status .unsync'))).length).toBe(0);
    expect((await driver.findElements(By.css('#status .up-to-date'))).length).toBeGreaterThan(1);
  });

  test("Clear and re-download a collection", async() => {
    // to do
  });
});
