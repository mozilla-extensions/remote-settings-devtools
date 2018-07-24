browser.browserAction.onClicked.addListener(async () => {
  await browser.tabs.create({
    url: "content/index.html",
  });
});
