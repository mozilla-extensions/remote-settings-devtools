# Only used for testing
FROM node:20-bookworm

WORKDIR /opt

# pull latest nightly
RUN wget -O nightly.tar.bz2 "https://download.mozilla.org/?product=firefox-nightly-latest-ssl&os=linux64&lang=en-US"
RUN tar -xf nightly.tar.bz2

# install firefox dependencies
RUN apt update && apt install -y libasound2 libgtk-3-0 libx11-xcb1

# copy files over
COPY . ./

# install node dependencies
RUN npm ci

ENV NIGHTLY_PATH="/opt/firefox/firefox"

CMD npm run tcs:test
