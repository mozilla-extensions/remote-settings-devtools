APP_NAME = remotesettings
XPI = $(APP_NAME).xpi
ZIP_CMD = zip -9 -q
CONTENT = README.md chrome.manifest install.rdf bootstrap.js data/*

install: $(XPI)

$(XPI): $(CONTENT)
	$(ZIP_CMD) $(XPI) $(CONTENT)

clean:
	rm $(XPI)
