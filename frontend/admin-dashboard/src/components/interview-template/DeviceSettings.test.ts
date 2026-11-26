import { describe, expect, it } from "vitest";

import { DEVICES_DEFAULT, devicesFromWeights, devicesToWeights } from "./DeviceSettings";

describe("devices on the template", () => {
  it("is laptop / PC only unless switched on", () => {
    expect(devicesFromWeights({})).toEqual(DEVICES_DEFAULT);
    expect(devicesFromWeights(null).allowPhone).toBe(false);
    expect(devicesFromWeights({ devices: { allowPhone: "true" } }).allowPhone).toBe(true);
    expect(devicesFromWeights({ devices: { allow_phone: true } }).allowPhone).toBe(true);
  });
  it("saves the server's key", () => {
    expect(devicesToWeights({ allowPhone: true })).toEqual({ allowPhone: true });
  });
});
