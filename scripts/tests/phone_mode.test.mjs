// Phone interviews (25 Nov 2026): node --test scripts/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { growBase, isLandscape, phoneAllowedForInvite, phoneDeviceDetails, splitScreenReason } from "../../frontend/js/phone_mode.js";

test("split screen: a much shorter or narrower page counts, the keyboard does not", () => {
  const base = { baseW: 393, baseH: 852 };
  assert.equal(splitScreenReason({ w: 393, h: 800, ...base }), null); // address bar
  assert.match(splitScreenReason({ w: 393, h: 420, ...base }), /split screen/);
  assert.equal(splitScreenReason({ w: 393, h: 420, typing: true, ...base }), null); // soft keyboard
  assert.match(splitScreenReason({ w: 280, h: 500, typing: true, ...base }), /floating window/);
  assert.equal(splitScreenReason({ w: 852, h: 393, ...base }), null); // sideways: the rotate rule
  assert.equal(splitScreenReason({ w: 393, h: 420, baseW: 0, baseH: 0 }), null);
});

test("the base only grows, and only in portrait", () => {
  let base = growBase({ w: 0, h: 0 }, 393, 780);
  base = growBase(base, 393, 852);
  base = growBase(base, 852, 393);
  assert.deepEqual(base, { w: 393, h: 852 });
  assert.equal(isLandscape(852, 393), true);
});

test("the template switch is read from the invite lookup; any failure is no", async () => {
  assert.equal(await phoneAllowedForInvite("t1", async () => ({ schedule: { devices: { allow_phone: true } } })), true);
  assert.equal(await phoneAllowedForInvite("t1", async () => ({ schedule: { devices: { allow_phone: false } } })), false);
  assert.equal(await phoneAllowedForInvite("t1", async () => null), false);
  assert.equal(await phoneAllowedForInvite("t1", async () => { throw new Error("offline"); }), false);
  assert.equal(await phoneAllowedForInvite("", async () => ({ schedule: { devices: { allow_phone: true } } })), false);
});

test("device details name the phone, the browser and the way it is held", () => {
  const nav = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36" };
  assert.equal(phoneDeviceDetails(nav, { innerWidth: 393, innerHeight: 852 }), "Android phone · Chrome · 393×852 portrait");
  const ios = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1" };
  assert.match(phoneDeviceDetails(ios, { innerWidth: 390, innerHeight: 844 }), /^iPhone · Safari/);
});
