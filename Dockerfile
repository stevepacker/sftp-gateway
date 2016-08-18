FROM stevepacker/nodejs-supervisor
MAINTAINER Stephen Packer <steve@stevepacker.com>

EXPOSE 2222

ENV SUPERVISOR=supervisor \
    SUPERVISORFLAGS="--non-interactive --timestamp --no-restart-on success"

COPY . /app/
