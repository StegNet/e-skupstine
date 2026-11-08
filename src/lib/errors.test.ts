import { expect, test } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { errorMessage } from "./errors";

test("error text keeps the Postgres cause but drops a failed query's parameters", () => {
  const e = new DrizzleQueryError("select * from member where oib = $1", ["12345678903"], new Error("connection reset"));
  const text = errorMessage(e);
  expect(text).toContain("select * from member where oib = $1");
  expect(text).toContain("<- Error: connection reset");
  expect(text).not.toContain("12345678903");
});
