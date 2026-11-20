'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

const MAX_BLOCKMAP_SIZE = 10 * 1024 * 1024;

function readAt(fd, length, offset) {
  const result = Buffer.alloc(length);
  if (fs.readSync(fd, result, 0, length, offset) !== length) {
    throw new Error('Truncated AppImage');
  }
  return result;
}

function fileOffset(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('ELF section offset exceeds supported file size');
  }
  return Number(value);
}

function readEmbeddedBlockmap(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 8) throw new Error('AppImage has no embedded blockmap');
    const length = readAt(fd, 4, size - 4).readUInt32BE(0);
    if (length <= 0 || length > MAX_BLOCKMAP_SIZE || length + 4 >= size) {
      throw new Error('Invalid embedded AppImage blockmap length');
    }
    const start = size - length - 4;
    const blockmap = JSON.parse(zlib.inflateRawSync(readAt(fd, length, start)));
    if (!Array.isArray(blockmap.files) || blockmap.files.length === 0) {
      throw new Error('Invalid embedded AppImage blockmap content');
    }
    return { start, length };
  } finally {
    fs.closeSync(fd);
  }
}

function findUpdateSection(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const elf = readAt(fd, 64, 0);
    if (elf.subarray(0, 4).toString('hex') !== '7f454c46') {
      throw new Error('AppImage does not contain an ELF runtime');
    }
    if (elf[4] !== 2 || elf[5] !== 1 || elf.readUInt16LE(18) !== 62) {
      throw new Error(
        'Unsupported AppImage runtime (expected ELF64 x86_64 little-endian)',
      );
    }

    const sectionOffset = fileOffset(elf.readBigUInt64LE(40));
    const sectionEntrySize = elf.readUInt16LE(58);
    const sectionCount = elf.readUInt16LE(60);
    const stringTableIndex = elf.readUInt16LE(62);
    if (
      sectionEntrySize < 64 ||
      sectionCount === 0 ||
      stringTableIndex >= sectionCount ||
      sectionOffset + sectionEntrySize * sectionCount > size
    ) {
      throw new Error('Invalid ELF section table');
    }

    function section(index) {
      const header = readAt(fd, 64, sectionOffset + index * sectionEntrySize);
      const offset = fileOffset(header.readBigUInt64LE(24));
      const length = fileOffset(header.readBigUInt64LE(32));
      return {
        nameOffset: header.readUInt32LE(0),
        type: header.readUInt32LE(4),
        offset,
        length,
      };
    }

    const strings = section(stringTableIndex);
    if (strings.offset + strings.length > size || strings.length > 1024 * 1024) {
      throw new Error('Invalid ELF string table');
    }
    const names = readAt(fd, strings.length, strings.offset);
    for (let index = 0; index < sectionCount; index++) {
      const item = section(index);
      if (item.nameOffset >= names.length) continue;
      const end = names.indexOf(0, item.nameOffset);
      if (end === -1) continue;
      if (names.toString('ascii', item.nameOffset, end) === '.upd_info') {
        if (item.type !== 1 || !item.length || item.offset + item.length > size) {
          throw new Error('Invalid .upd_info ELF section');
        }
        return { offset: item.offset, length: item.length };
      }
    }
    throw new Error('AppImage runtime has no .upd_info ELF section');
  } finally {
    fs.closeSync(fd);
  }
}

function writeUpdateInfo(file, updateInfo) {
  if (!/^[\x20-\x7e]+$/.test(updateInfo)) {
    throw new Error('AppImage update information must be printable ASCII');
  }
  const section = findUpdateSection(file);
  const bytes = Buffer.from(updateInfo, 'ascii');
  if (bytes.length + 1 > section.length) {
    throw new Error('AppImage update information exceeds .upd_info capacity');
  }
  const replacement = Buffer.alloc(section.length);
  bytes.copy(replacement);
  const fd = fs.openSync(file, 'r+');
  try {
    if (
      fs.writeSync(fd, replacement, 0, replacement.length, section.offset) !==
      replacement.length
    ) {
      throw new Error('Unable to write full .upd_info section');
    }
  } finally {
    fs.closeSync(fd);
  }
  return section;
}

module.exports = { findUpdateSection, readEmbeddedBlockmap, writeUpdateInfo };
