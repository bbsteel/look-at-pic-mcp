import { strict as assert } from "node:assert";
import test from "node:test";
import {
  createModelTextResult,
  getBase64PayloadLength,
  getImageMimeForPath,
  isImageFileTooLarge,
  MAX_IMAGE_BASE64_LENGTH,
  MAX_IMAGE_BYTES,
} from "./index.js";

test("getImageMimeForPath allows supported image extensions case-insensitively", () => {
  assert.equal(getImageMimeForPath("/tmp/photo.PNG"), "image/png");
  assert.equal(getImageMimeForPath("/tmp/photo.jpg"), "image/jpeg");
  assert.equal(getImageMimeForPath("/tmp/photo.JPEG"), "image/jpeg");
  assert.equal(getImageMimeForPath("/tmp/photo.gif"), "image/gif");
  assert.equal(getImageMimeForPath("/tmp/photo.webp"), "image/webp");
  assert.equal(getImageMimeForPath("/tmp/photo.bmp"), "image/bmp");
});

test("getImageMimeForPath rejects unsupported or missing extensions", () => {
  assert.equal(getImageMimeForPath("/tmp/photo.txt"), undefined);
  assert.equal(getImageMimeForPath("/tmp/photo"), undefined);
});

test("isImageFileTooLarge enforces the 5MB boundary", () => {
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  assert.equal(isImageFileTooLarge(MAX_IMAGE_BYTES), false);
  assert.equal(isImageFileTooLarge(MAX_IMAGE_BYTES + 1), true);
});

test("getBase64PayloadLength counts raw base64 input", () => {
  assert.equal(getBase64PayloadLength("abcd"), 4);
});

test("getBase64PayloadLength counts only the payload of a data URI", () => {
  assert.equal(getBase64PayloadLength("data:image/png;base64,abcd"), 4);
});

test("MAX_IMAGE_BASE64_LENGTH matches the 5MB base64 expansion", () => {
  assert.equal(MAX_IMAGE_BASE64_LENGTH, Math.ceil(MAX_IMAGE_BYTES / 3) * 4);
});

test("createModelTextResult treats empty model text as an error", () => {
  const result = createModelTextResult("");

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Vision model API returned empty response text");
});
