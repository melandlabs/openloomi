import { describe, it, expect, vi } from "vitest";
import {
  AppError,
  getMessageByErrorCode,
  isTelegramAuthIssue,
} from "@openloomi/shared/errors";

describe("errors", () => {
  it("builds message with cause for api bad request", () => {
    const error = new AppError("bad_request:api", "invalid input");
    expect(error.message).toContain("invalid input");
    expect(error.statusCode).toBe(400);
    expect(error.surface).toBe("api");
  });

  it("maps database errors to generic message in response", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AppError("bad_request:database");

    const response = error.toResponse();
    const payload = await response.json();

    expect(payload).toEqual({
      code: "",
      message: "Something went wrong. Please try again later.",
    });
    expect(response.status).toBe(400);
    expect(spy).toHaveBeenCalledWith({
      code: "bad_request:database",
      message: "An error occurred while executing a database query.",
      cause: undefined,
    });
    spy.mockRestore();
  });

  it("returns response payload with code for visible surfaces", async () => {
    const error = new AppError("not_found:chat");
    const response = error.toResponse();
    const payload = await response.json();

    expect(payload.code).toBe("not_found:chat");
    expect(payload.message).toContain("chat was not found");
    expect(response.status).toBe(404);
  });

  it("falls back to default message when no mapping found", () => {
    expect(getMessageByErrorCode("bad_request:feedback", "oops")).toBe("oops");
  });

  // SE-01: AppError toResponse admin surface - database surface logs to console
  it("SE-01: toResponse for database surface logs full error details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AppError("bad_request:database", "admin cause");

    const response = error.toResponse();
    const payload = await response.json();

    // Database surface uses visibility "log", so it logs and returns generic message
    expect(payload.code).toBe("");
    expect(payload.message).toBe(
      "Something went wrong. Please try again later.",
    );
    expect(response.status).toBe(400);
    expect(spy).toHaveBeenCalledWith({
      code: "bad_request:database",
      message: "An error occurred while executing a database query.",
      cause: "admin cause",
    });
    spy.mockRestore();
  });

  // SE-02: AppError toResponse user surface
  it("SE-02: toResponse for api surface returns code, message, and cause", async () => {
    const error = new AppError("bad_request:api", "user-friendly cause");

    const response = error.toResponse();
    const payload = await response.json();

    expect(payload.code).toBe("bad_request:api");
    expect(payload.message).toContain("user-friendly cause");
    expect(payload.cause).toBe("user-friendly cause");
    expect(response.status).toBe(400);
  });

  // SE-03: AppError toResponse public surface (chat surface)
  it("SE-03: toResponse for chat surface returns user-friendly response", async () => {
    const error = new AppError("not_found:chat");

    const response = error.toResponse();
    const payload = await response.json();

    expect(payload.code).toBe("not_found:chat");
    expect(payload.message).toContain("not found");
    expect(response.status).toBe(404);
  });

  // SE-04: getMessageByErrorCode known
  it("SE-04: getMessageByErrorCode returns correct message for known codes", () => {
    expect(getMessageByErrorCode("unauthorized:auth")).toBe(
      "You need to sign in before continuing.",
    );
    expect(getMessageByErrorCode("forbidden:auth")).toBe(
      "Your account does not have access to this feature.",
    );
    expect(getMessageByErrorCode("rate_limit:chat")).toBe(
      "You have exceeded your maximum number of messages for the day. Please try again tomorrow.",
    );
  });

  // SE-05: getMessageByErrorCode unknown
  it("SE-05: getMessageByErrorCode returns cause or default for unknown codes", () => {
    expect(
      getMessageByErrorCode("unknown:surface" as any, "custom cause"),
    ).toBe("custom cause");
    expect(getMessageByErrorCode("unknown:surface" as any)).toBe(
      "Something went wrong. Please try again later.",
    );
  });

  // SE-06: isTelegramAuthIssue auth error
  it("SE-06: isTelegramAuthIssue returns true for Telegram auth errors", () => {
    expect(isTelegramAuthIssue("400: AUTH_BYTES_INVALID")).toBe(true);
    expect(isTelegramAuthIssue("401: AUTH_KEY_UNREGISTERED")).toBe(true);
    expect(isTelegramAuthIssue("406: AUTH_KEY_DUPLICATED")).toBe(true);
  });

  // SE-07: isTelegramAuthIssue other errors
  it("SE-07: isTelegramAuthIssue returns false for non-Telegram errors", () => {
    expect(isTelegramAuthIssue("Not a valid string")).toBe(false);
    expect(isTelegramAuthIssue("An API error occurred: missing_scope")).toBe(
      false,
    );
    expect(isTelegramAuthIssue(null)).toBe(false);
    expect(isTelegramAuthIssue(undefined)).toBe(false);
    expect(isTelegramAuthIssue("")).toBe(false);
  });
});
