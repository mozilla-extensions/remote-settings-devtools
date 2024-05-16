# Only used for testing
FROM node:18-bookworm

WORKDIR /opt

# pull latest nightly
RUN wget -O nightly.tar.bz2 "https://download.mozilla.org/?product=firefox-nightly-latest-ssl&os=linux64&lang=en-US"
RUN tar -xf nightly.tar.bz2

# install firefox dependencies
RUN apt update && apt install -y libasound2 libatk1.0-0 libc6 libcairo-gobject2 libcairo2 libdbus-1-3 libfontconfig1 libfreetype6 libgcc1 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-xcb1

# copy files over
COPY . ./

# install node dependencies
RUN npm ci

ENV NIGHTLY_PATH="/opt/firefox/firefox"

CMD npm run test
