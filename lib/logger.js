'use strict';

var Winston = require('winston');

module.exports = function(logFilename) {
    return new (Winston.Logger)({
        transports: [
            new (Winston.transports.Console)({
                name        : 'console',
                colorize    : true,
                timestamp   : true,
                stringify   : true,
                prettyPrint : true,
                humanReadableUnhandledException: true
            }),
            new (Winston.transports.File)({
                name            : 'file',
                filename        : logFilename,
                zippedArchive   : true,
                tailable        : true,
                maxFiles        : 5,
                maxsize         : 100000
            })
        ]
    });
}