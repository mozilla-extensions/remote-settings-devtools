APP_NAME = remotesettings
XPI = $(APP_NAME).xpi
ZIP_CMD = zip -9 -q

install: $(XPI)

$(XPI):
	$(ZIP_CMD) $(XPI) README.md chrome.manifest install.rdf bootstrap.js data/*

clean:
	rm $(XPI)