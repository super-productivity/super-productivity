# E2E-only WebDAV server. Apache mod_dav enforces If-Match / If-None-Match on
# PUT, so concurrent-upload tests exercise the CAS path real servers provide
# (hacdias/webdav ignores both, #10590). Not for self-hosting.
FROM httpd:2.4-alpine
# mod_dav_fs needs a DBM driver for its lock database
RUN apk add --no-cache apr-util-dbm_gdbm \
  && mkdir -p /dav-data /dav-lock \
  && chown daemon:daemon /dav-data /dav-lock \
  && htpasswd -bc /usr/local/apache2/conf/e2e.htpasswd admin admin
COPY httpd.conf /usr/local/apache2/conf/httpd.conf
EXPOSE 2345
