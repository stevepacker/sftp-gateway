SFTP Gateway
============

FTP and SFTP are still widely used as mechanisms 
for transporting files.  This NodeJS application
creates an SFTP server with the sole function of
allowing file uploads.  The SFTP server is write-only
and so there is no visiblity into the filesystem.

On upload, the file can be saved to the local filesystem.

Additionally, an uploaded file can be pushed to 
an HTTP endpoint as a POST request.

### Configuration

A file "config.yml" is used to load configuration,
including allowed SFTP users and their login credentials,
an HTTP endpoint to push uploaded files, and whether to
store uploaded files on the filesystem, and where.

Copy the `config.yml.dist` file to `config.yml`, and edit 
accordingly.

