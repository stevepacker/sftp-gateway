'use strict';

var _       = require('lodash');
var fs      = require('fs');
var config  = require('config-yml');
var request = require('request');
var log     = require('./lib/logger');
var sftpd   = require('./lib/sftpd');

if (! config.sftp) {
    config.sftp = {};
}

if (config.sftp.saveUploads) {
    var uploadDir = __dirname + '/' + config.sftp.saveUploads;
    if (! fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir);
    }
    log.info('Will deposit uploads to:', uploadDir);
}

// configure the SFTP server
if (config.sftp.banner) {
    sftpd.banner = config.sftp.banner;
}
sftpd.maxUploadBytes = config.sftp.maxUploadBytes || 1024 * 1024 * 50; // 50M
sftpd.users          = config.sftp.users;

sftpd.on('clientAuthenticated', function(client) {
    log.info('New authenticated client:', client.username, '@', client.ip);
});

// prepare to store uploaded files in a buffer
var fileBuffer = {};
sftpd.on('fileUploadPart', function(filename, data, offset) {
    var bufferSize = offset + data.length;

    if (! fileBuffer[filename]) {
        fileBuffer[filename] = Buffer.alloc(bufferSize);
    }

    if (bufferSize > fileBuffer[filename].length) {
        var newBuffer = Buffer.alloc(bufferSize);
        fileBuffer[filename].copy(newBuffer);
        fileBuffer[filename] = newBuffer;
    }

    data.copy(fileBuffer[filename], offset);
});

// after a file is uploaded
sftpd.on('fileUploadDone', function(filename) {
    log.warn('fileUpload at index', arguments);
    log.warn('fileBuffer: ', _.keys(fileBuffer), fileBuffer[filename].length);

    // ignore files that exceed upload max size
    if (fileBuffer[filename].length > sftpd.maxUploadBytes) {
        return;
    }

    // persist files, if requested
    if (uploadDir) {
        var now      = new Date();
        var dumpFile = uploadDir + '/' +
            now.toJSON().replace(/:/g, '-') +
            '_' + filename;
        log.info('Dumping to file: ', fileBuffer[filename].length, dumpFile);
        fs.writeFileSync(dumpFile, fileBuffer[filename]);
    }

    // proxy files out, if requested
    if (config.http && config.http.url) {
        log.info('Pushing file to HTTP endpoint...', config.http.url);
        // let config define if additional POST values are added
        var formData = config.http.postValues || {};

        // attach the uploaded file
        formData[filename] = {
            value: fileBuffer[filename],
            options: {
                filename: filename,
                contentType: 'application/octet-stream'
            }
        };

        // send request
        request.post({
            url:        config.http.url,
            formData:   formData
        }, function(err, httpResponse, body) {
            if (err) {
                sftpd.close();
                return log.error('upload failed:', err);
            }
            log.info('HTTP Response:', body);
        });
    }

    // clear file from memory
    delete fileBuffer[filename];
});

// start up server
sftpd.listen(config.sftp.port || 2222, '0.0.0.0', function() {
    log.info('Listening on port ' + this.address().port);
});
