# E2E-only WebDAV server. Apache mod_dav enforces If-Match / If-None-Match on
# PUT, so concurrent-upload tests exercise the CAS path real servers provide
# (hacdias/webdav ignores both, #10590). Not for self-hosting.
# Debian, not alpine: alpine's lock database is gdbm, which fails concurrent
# opens instead of waiting, so parallel workers got random 500s ("Could not
# open the lock database"). Debian's Berkeley DB default waits.
FROM httpd:2.4
RUN mkdir -p /dav-data /dav-lock \
  && chown daemon:daemon /dav-data /dav-lock \
  && htpasswd -bc /usr/local/apache2/conf/e2e.htpasswd admin admin
COPY httpd.conf /usr/local/apache2/conf/httpd.conf
EXPOSE 2345
