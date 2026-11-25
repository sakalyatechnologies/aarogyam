import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { failure, success, type ApiResult, type PincodeInfo } from "@aarogyam/api-client";

import { EMPTY_PIN, PinCodeFields, isPin, type PinValue } from "./pin-code-fields.js";

const lookup = (pin: string): Promise<ApiResult<PincodeInfo>> =>
  Promise.resolve(pin === "411001" ? success({ pin, district: "Pune", state: "Maharashtra" }) : failure({ status: 404, code: "not_found", message: "not found" }));

function Harness({ start = EMPTY_PIN }: { start?: PinValue }) {
  const [value, setValue] = useState(start);
  return <PinCodeFields value={value} onChange={setValue} lookup={lookup} />;
}

describe("PinCodeFields", () => {
  it("accepts six digits not starting with 0", () => {
    expect(isPin("411001")).toBe(true);
    expect(isPin("011001")).toBe(false);
    expect(isPin("41100")).toBe(false);
  });

  it("fills city and state on the sixth digit and leaves both editable", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("PIN code"), "41100a1");
    expect(await screen.findByDisplayValue("Pune")).toBeTruthy();
    expect(screen.getByLabelText("State")).toHaveProperty("value", "Maharashtra");
    await user.clear(screen.getByLabelText("City or district"));
    await user.type(screen.getByLabelText("City or district"), "Pimpri");
    expect(screen.getByLabelText("City or district")).toHaveProperty("value", "Pimpri");
  });

  it("keeps what was typed when the PIN is unknown", async () => {
    const user = userEvent.setup();
    render(<Harness start={{ pincode: "", city: "Hand-typed", state: "" }} />);
    await user.type(screen.getByLabelText("PIN code"), "999999");
    expect(await screen.findByText(/We don't know this PIN/)).toBeTruthy();
    expect(screen.getByLabelText("City or district")).toHaveProperty("value", "Hand-typed");
  });
});
