'use strict';

var Winston = require('winston');

var logger = new (Winston.Logger)({
    transports: [
        new (Winston.transports.Console)({
            // level       : 'debug',
            colorize    : true,
            timestamp   : true,
            stringify   : true,
            prettyPrint : true,
            humanReadableUnhandledException: true
        }),
        new (Winston.transports.File)({
            filename: 'sftp-gateway.log',
            zippedArchive: true,
            tailable: true,
            maxFiles: 5,
            maxsize: 100
        })
    ]
});

module.exports = logger;