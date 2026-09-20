'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname, '..', 'Code.gs'), 'utf8');
const context = vm.createContext({
  console,
  Utilities: {
    base64Decode(value) {
      return Array.from(Buffer.from(value, 'base64'), byte => byte > 127 ? byte - 256 : byte);
    }
  }
});
new vm.Script(code, { filename: 'Code.gs' }).runInContext(context);

const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]).toString('base64');
const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).toString('base64');

const normalizedJpeg = context.normalizeImageUpload_({ mimeType: 'image/jpeg', base64: jpeg }, 'Receipt');
assert.equal(normalizedJpeg.mimeType, 'image/jpeg');
assert.equal(normalizedJpeg.extension, 'jpg');
assert.equal(normalizedJpeg.bytes.length, 6);

const normalizedPng = context.normalizeImageUpload_({ mimeType: 'image/png', base64: png }, 'Asset');
assert.equal(normalizedPng.extension, 'png');

assert.throws(
  () => context.normalizeImageUpload_({ mimeType: 'image/gif', base64: jpeg }, 'Image'),
  /JPEG, PNG, or WebP/
);
assert.throws(
  () => context.normalizeImageUpload_({ mimeType: 'image/jpeg', base64: Buffer.from('not an image').toString('base64') }, 'Image'),
  /not a valid JPG/
);
assert.throws(
  () => context.normalizeSubmissionImages_('asset', { assetImages: Array(4).fill({ mimeType: 'image/jpeg', base64: jpeg }) }),
  /no more than 3 images/i
);

const donationImages = context.normalizeSubmissionImages_('donation', {
  receiptImage: { mimeType: 'image/jpeg', base64: jpeg }
});
assert.equal(donationImages.length, 1);

console.log('Upload validation tests passed');
