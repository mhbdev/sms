import { describe, expect, it } from "vitest";

import * as root from "../src/index.js";
import * as kavenegar from "../src/kavenegar.js";
import * as smsIr from "../src/sms-ir.js";

describe("public entrypoints", () => {
	it("retain the root provider and compatibility exports", () => {
		expect(root.KavenegarSmsProvider).toBe(kavenegar.KavenegarSmsProvider);
		expect(root.SmsIrProvider).toBe(smsIr.SmsIrProvider);
		expect(root.SmsIrSmsProvider).toBe(root.SmsIrProvider);
		expect(root.KavenegarError).toBe(kavenegar.KavenegarError);
		expect(root.SmsIrError).toBe(smsIr.SmsIrError);
	});

	it("retain parser exports on provider entrypoints", () => {
		expect(kavenegar.parseKavenegarResponse).toBeTypeOf("function");
		expect(kavenegar.parseKavenegarSendEntries).toBeTypeOf("function");
		expect(smsIr.parseSmsIrPayload).toBeTypeOf("function");
		expect(smsIr.parseSmsIrPackMessages).toBeTypeOf("function");
	});
});
