FROM stevepacker/nodejs-supervisor
MAINTAINER Stephen Packer <steve@stevepacker.com>

EXPOSE 2222

CMD ["supervisor", "--non-interactive", "--timestamp", "--no-restart-on success", "index.js"]

USER root

COPY package.json /tmp/package.json
RUN cd /tmp && npm install

COPY . /app/

RUN mv /tmp/node_modules /app/ \
    && rm /tmp/package.json \
    && chown -Rf node:node /app \
    && ls -la

USER node