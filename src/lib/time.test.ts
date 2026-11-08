import { expect, test } from "bun:test";
import { fromZagrebLocal, toZagrebLocal } from "./time";

test("Zagreb wall-clock round trip across DST", () => {
  expect(fromZagrebLocal("2026-01-15T18:00")?.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  expect(fromZagrebLocal("2026-07-15T18:00")?.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  expect(toZagrebLocal(new Date("2026-07-15T16:00:00Z"))).toBe("2026-07-15T18:00");
  expect(fromZagrebLocal("nonsense")).toBeNull();
});
