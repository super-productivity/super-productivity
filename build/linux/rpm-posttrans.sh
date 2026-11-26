#!/bin/bash
# rpm %posttrans for the .rpm (#11136). The desktop entry's Exec points at
# /usr/bin/superproductivity, because xdg-open discards a handler whose Exec path
# contains a space (/opt/Super Productivity/...). On upgrade rpm runs the OLD
# package's %postun after the new %post, and electron-builder's after-remove
# script removes that link unconditionally. %posttrans runs last, so re-create
# it here, mirroring electron-builder's after-install.tpl. It does not run on
# erase, so uninstalling still removes the link.
APP_BIN='/opt/Super Productivity/superproductivity'

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --install '/usr/bin/superproductivity' 'superproductivity' "$APP_BIN" 100 || ln -sf "$APP_BIN" '/usr/bin/superproductivity'
else
    ln -sf "$APP_BIN" '/usr/bin/superproductivity'
fi
