'use strict';

var _            = require('lodash');
var fs           = require('fs');
var ssh2         = require('ssh2');
var path         = require('path');
var NodeRSA      = require('node-rsa');
var crypto       = require('crypto');
var log          = require('./logger');

var STATUS_CODE  = ssh2.SFTP_STATUS_CODE;

// assert an SSH host key file exists
var baseDir = path.dirname(__dirname);
var sshdKey = baseDir + '/ssh_host_rsa_key';
if (! fs.existsSync(sshdKey) || 0 == fs.statSync(sshdKey)['size']) {
    log.info('Generating a ssh_host_rsa_key file...');
    var key  = new NodeRSA({b: 2048});
    fs.writeFileSync(sshdKey, key.exportKey('private') + "\n");
    log.info('Generating a ssh_host_rsa_key file...done');
}

var server = new ssh2.Server({
    hostKeys: [
        fs.readFileSync(sshdKey)
    ],
    debug:  function(message) {
        // log.debug(message);
    }
});

server.openFiles      = {};
server.maxUploadBytes = 1024 * 1024 * 5; // 50M
server.users          = {};

server.clients = [];

server.onConnect = function(client, info) {
    log.info('Client connected!', info);

    client.ip = info.ip;

    server.clients.push(client);

    client.on('end', function() {
        _.remove(server.clients, function(n) {
            return n == client;
        });
        log.info('Client disconnected');
    });

    client.on('authentication', function(ctx) {
        server.onAuthentication(ctx, client);
    });

    client.on('ready', function() {
        log.info('Client authenticated');
        server.emit('clientAuthenticated', client);

        client.on('session', function(accept, reject) {
            return server.onSession(accept, reject, client);
        });
    });
};

server.onAuthentication = function(ctx, client) {
    var options = server.users[ctx.username];
    if (options && options[ctx.method]) {
        log.info('Authentication attempt:', ctx.username, ctx.method);
        switch (ctx.method) {
            case 'password':
                if (options.password == ctx.password) {
                    log.info('Client has authenticated via password');
                    client.username = ctx.username;
                    return ctx.accept();
                }
                break;

            case 'publickey':
                var pubKey = ssh2.utils.genPublicKey(ssh2.utils.parseKey(options.publickey));

                if (pubKey.fulltype != ctx.key.algo) {
                    log.info('pubKey algo did not match', pubKey.fulltype, ctx.key.algo);
                    break;
                }

                if (0 !== pubKey.public.compare(ctx.key.data)) {
                    log.info('pubKey data did not match', pubKey.public, ctx.key.data);
                    break;
                }

                if (! ctx.signature) {
                    // if no signature present, the client is just checking the public key
                    log.info('Client is checking the public key');
                    return ctx.accept();
                }

                log.info('Attempting crypto.verify:', ctx.signature, ctx.sigAlgo);
                var verify = crypto.createVerify(ctx.sigAlgo);
                verify.update(ctx.blob);
                if (verify.verify(pubKey.publicOrig, ctx.signature)) {
                    log.info('Client has authenticated via publickey');
                    client.username = ctx.username;
                    return ctx.accept();
                }
                break;
        }
    }

    ctx.reject(['password', 'publickey']);
};

server.onSession = function(accept, reject, client) {
    var session = accept();

    session.on('sftp', server.onSftp);

    _(['pty', 'window-change', 'x11', 'signal', 'auth-agent', 'shell', 'exec', 'subsystem']).forEach(function(type) {
        session.on(type, function() {
            log.warn('Rejecting session type: ' + type);
            if (client) {
                client.end();
            } else {
                _(server.clients).forEach(function (client) {
                    client.end();
                });
            }
            reject();
        });
    });
};

server.normalizeFilename = function(filename) {
    if (Buffer.isBuffer(filename)) {
        filename = filename.toString();
    }

    filename = _.trim(filename, '/')
        .replace(/\.filepart$/, '');

    return filename;
};

server.onSftp = function(accept, reject) {
    log.info('SFTP session started');
    var sftpStream = accept();

    var cmds = [
        'OPEN', 'READ', 'WRITE', 'FSTAT', 'FSETSTAT', 'CLOSE', 'OPENDIR', 'READDIR', 'LSTAT', 'STAT',
        'REMOVE', 'RMDIR', 'REALPATH', 'READLINK', 'SETSTAT', 'MKDIR', 'RENAME', 'SYMLINK'
    ];
    _(cmds).forEach(function(eventName) {
        sftpStream.on(eventName, function(reqid) {
            log.info(eventName, arguments);
        });
    });

    /**
     * These events occur when starting an SFTP session in WinSCP:
     * - REALPATH '/.'
     * - LSTAT '/.'
     * - OPENDIR '/.'
     * - READDIR '/.'
     * - LSTAT '/./..'
     */

    sftpStream.on('REALPATH', function(reqid, path) {
        path = _.trim(path, '/.');

        return sftpStream.name(reqid, [{
            filename: '/' + path
        }]);
    });

    sftpStream.on('OPENDIR', function(reqid, path) {
        return sftpStream.handle(reqid, new Buffer(1));
    });

    sftpStream.on('READDIR', function(reqid, handle) {
        return sftpStream.status(reqid, STATUS_CODE.EOF);
    });

    sftpStream.on('LSTAT', function(reqid, path) {
        path = _.trimStart(path, '/');

        if ('' === path) {
            return sftpStream.attrs(reqid, {
                uid: 0,
                gid: 0,
                size: 0,
                atime: Date.now(),
                mtime: Date.now()
            });
        }
        return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    });

    sftpStream.on('CLOSE', function(reqid, handle) {
        var filename = server.normalizeFilename(handle);

        if (server.openFiles[filename]) {
            server.emit('fileUploadDone', filename);
        }

        delete server.openFiles[filename];

        return sftpStream.status(reqid, STATUS_CODE.OK);
    });


    /**
     * As an upload begins, these commands are run:
     * - REALPATH remote filename
     * - OPEN
     * - WRITE
     * - CLOSE
     * - RENAME
     * - SETSTAT
     */
    sftpStream.on('OPEN', function(reqid, filename, flags, attrs) {
        filename = server.normalizeFilename(filename);

        // mark files as being open and ready for writing
        server.openFiles[filename]   = true;

        return sftpStream.handle(reqid, Buffer.from(filename));
    });

    sftpStream.on('WRITE', function(reqid, filenameBuffer, offset, data) {
        var filename = server.normalizeFilename(filenameBuffer);

        // abort transfer if the file is too big
        var size = data.length + offset;
        if (size > server.maxUploadBytes) {
            log.warn('File too large: ', size);
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
        }

        if (! server.openFiles[filename]) {
            log.warn('File is not opened: ' + size);
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
        }

        // broadcast to anyone listening
        server.emit('fileUploadPart', filename, data, offset);

        // inform SFTP client that the packet was received ok
        return sftpStream.status(reqid, STATUS_CODE.OK);
    });

    sftpStream.on('SETSTAT', function(reqid, filename, attrs) {
        // ignore this request, it's trying to do a chmod
        return sftpStream.status(reqid, STATUS_CODE.OK);
    });

    sftpStream.on('RENAME', function(reqid, filename, attrs) {
        // ignore this request, it's trying to remove a .filepart suffix
        return sftpStream.status(reqid, STATUS_CODE.OK);
    });


    /**
     * Events that can be issued but I'm ignoring.  A response is
     * important to keep the SFTP client from hanging.
     *
     */
    _(['READ', 'FSTAT', 'FSETSTAT', 'STAT', 'REMOVE', 'RMDIR', 'READLINK', 'MKDIR', 'SYMLINK'])
        .forEach(function(eventName) {
            sftpStream.on(eventName, function(reqid) {
                console.warn('Unimplemented SFTP event: ', eventName);
                return sftpStream.status(reqid, STATUS_CODE.OP_UNSUPPORTED);
            });
        });
};

server.on('connection', server.onConnect);

module.exports = server;