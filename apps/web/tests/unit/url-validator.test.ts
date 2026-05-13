import { describe, beforeEach, afterEach, test, expect, vi, it } from "vitest";

import {
  validateUrlForSSRF,
  fetchWithSSRFProtection,
  isTrustedStorageUrl,
  SSRFValidationError,
} from "@openloomi/security/url-validator";

vi.mock("server-only", () => ({}));

describe("url-validator - SSRF Protection", () => {
  // Additional tests for ipToInt and isPrivateIp via validateUrlForSSRF
  // since these functions are not exported directly

  describe("IP address validation edge cases", () => {
    // UV-01: boundary private IP addresses
    it("UV-01: should reject IPs at start of 10.x range", async () => {
      await expect(
        validateUrlForSSRF("http://10.0.0.0/file", { strictWhitelist: false }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-02: should reject IPs at end of 10.x range
    it("UV-02: should reject IPs at end of 10.x range", async () => {
      await expect(
        validateUrlForSSRF("http://10.255.255.255/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-03: should reject IPs at start of 172.16.x range
    it("UV-03: should reject IPs at start of 172.16.x range", async () => {
      await expect(
        validateUrlForSSRF("http://172.16.0.0/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-04: should reject IPs at end of 172.31.x range
    it("UV-04: should reject IPs at end of 172.31.x range", async () => {
      await expect(
        validateUrlForSSRF("http://172.31.255.255/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-05: should reject IPs at start of 192.168.x range
    it("UV-05: should reject IPs at start of 192.168.x range", async () => {
      await expect(
        validateUrlForSSRF("http://192.168.0.0/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-06: should reject IPs at end of 192.168.x range
    it("UV-06: should reject IPs at end of 192.168.x range", async () => {
      await expect(
        validateUrlForSSRF("http://192.168.255.255/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-07: should reject carrier-grade NAT range
    it("UV-07: should reject carrier-grade NAT range 100.64.x", async () => {
      await expect(
        validateUrlForSSRF("http://100.64.0.1/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-08: should reject link-local 169.254.x
    it("UV-08: should reject link-local 169.254.x", async () => {
      await expect(
        validateUrlForSSRF("http://169.254.0.1/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-09: should reject TEST-NET-1 192.0.2.x
    it("UV-09: should reject TEST-NET-1 192.0.2.x", async () => {
      await expect(
        validateUrlForSSRF("http://192.0.2.1/file", { strictWhitelist: false }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-10: should reject TEST-NET-2 198.51.100.x
    it("UV-10: should reject TEST-NET-2 198.51.100.x", async () => {
      await expect(
        validateUrlForSSRF("http://198.51.100.1/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-11: should reject TEST-NET-3 203.0.113.x
    it("UV-11: should reject TEST-NET-3 203.0.113.x", async () => {
      await expect(
        validateUrlForSSRF("http://203.0.113.1/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-12: should accept valid public IP
    it("UV-12: should accept valid public IP", async () => {
      const url = await validateUrlForSSRF("http://8.8.8.8/file", {
        strictWhitelist: false,
        requireHttps: false,
      });
      expect(url.hostname).toBe("8.8.8.8");
    });
  });

  describe("IPv6 validation", () => {
    // UV-13: should reject IPv6 documentation range
    it("UV-13: should reject IPv6 documentation range 2001:db8:x", async () => {
      await expect(
        validateUrlForSSRF("http://[2001:db8::1]/file", {
          strictWhitelist: false,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-14: should reject IPv6 unique local fc00:x
    it("UV-14: should reject IPv6 unique local fc00:x", async () => {
      await expect(
        validateUrlForSSRF("http://[fc00::1]/file", { strictWhitelist: false }),
      ).rejects.toThrow(SSRFValidationError);
    });

    // UV-15: should reject IPv6 unique local fd00:x
    it("UV-15: should reject IPv6 unique local fd00:x", async () => {
      await expect(
        validateUrlForSSRF("http://[fd00::1]/file", { strictWhitelist: false }),
      ).rejects.toThrow(SSRFValidationError);
    });
  });

  describe("isAllowedDomain via strictWhitelist", () => {
    // UV-16: subdomain of whitelisted domain
    it("UV-16: should allow subdomain of whitelisted domain", async () => {
      const url = await validateUrlForSSRF("https://api.example.com/file", {
        strictWhitelist: true,
        allowedDomains: ["*.example.com"],
      });
      expect(url.hostname).toBe("api.example.com");
    });

    // UV-17: deep subdomain of whitelisted domain
    it("UV-17: should allow deep subdomain of whitelisted domain", async () => {
      const url = await validateUrlForSSRF(
        "https://deep.sub.domain.example.com/file",
        {
          strictWhitelist: true,
          allowedDomains: ["*.example.com"],
        },
      );
      expect(url.hostname).toBe("deep.sub.domain.example.com");
    });

    // UV-18: exact match of whitelisted domain
    it("UV-18: should allow exact match of whitelisted domain", async () => {
      const url = await validateUrlForSSRF("https://googleapis.com/file", {
        strictWhitelist: true,
      });
      expect(url.hostname).toBe("googleapis.com");
    });

    // UV-19: subdomain of googleapis.com
    it("UV-19: should allow subdomain of googleapis.com", async () => {
      const url = await validateUrlForSSRF(
        "https://storage.googleapis.com/file",
        { strictWhitelist: true },
      );
      expect(url.hostname).toBe("storage.googleapis.com");
    });
  });
  describe("isTrustedStorageUrl", () => {
    test("returns true for Vercel Blob URLs", () => {
      expect(
        isTrustedStorageUrl("https://public.blob.vercel-storage.com/file.txt"),
      ).toBe(true);
      expect(
        isTrustedStorageUrl("https://custom.vercel-storage.com/path/file"),
      ).toBe(true);
    });

    test("returns true for Google Drive URLs", () => {
      expect(isTrustedStorageUrl("https://drive.google.com/uc?id=123")).toBe(
        true,
      );
      expect(
        isTrustedStorageUrl("https://storage.googleapis.com/bucket/file"),
      ).toBe(true);
      expect(
        isTrustedStorageUrl("https://lh3.googleusercontent.com/file"),
      ).toBe(true);
    });

    test("returns true for Notion URLs", () => {
      expect(isTrustedStorageUrl("https://www.notion.so/page")).toBe(true);
      expect(isTrustedStorageUrl("https://notion-static.com/file")).toBe(true);
    });

    test("returns true for Slack URLs", () => {
      expect(isTrustedStorageUrl("https://files.slack.com/files/file")).toBe(
        true,
      );
    });

    test("returns true for AWS S3 URLs", () => {
      expect(isTrustedStorageUrl("https://bucket.s3.amazonaws.com/file")).toBe(
        true,
      );
    });

    test("returns false for unknown URLs", () => {
      expect(isTrustedStorageUrl("https://example.com/file")).toBe(false);
      expect(isTrustedStorageUrl("https://attacker.com/exploit")).toBe(false);
    });
  });

  describe("validateUrlForSSRF", () => {
    test("rejects localhost URLs", async () => {
      await expect(
        validateUrlForSSRF("http://localhost:8080/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(validateUrlForSSRF("http://127.0.0.1/file")).rejects.toThrow(
        SSRFValidationError,
      );
      await expect(
        validateUrlForSSRF("http://127.0.0.1:8080/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(validateUrlForSSRF("http://127.1.1.1/file")).rejects.toThrow(
        SSRFValidationError,
      );
    });

    test("rejects private IP ranges", async () => {
      // 10.0.0.0/8
      await expect(validateUrlForSSRF("http://10.0.0.1/file")).rejects.toThrow(
        SSRFValidationError,
      );
      await expect(
        validateUrlForSSRF("http://10.255.255.255/file"),
      ).rejects.toThrow(SSRFValidationError);

      // 172.16.0.0/12
      await expect(
        validateUrlForSSRF("http://172.16.0.1/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(
        validateUrlForSSRF("http://172.31.255.255/file"),
      ).rejects.toThrow(SSRFValidationError);

      // 192.168.0.0/16
      await expect(
        validateUrlForSSRF("http://192.168.1.1/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(
        validateUrlForSSRF("http://192.168.255.255/file"),
      ).rejects.toThrow(SSRFValidationError);

      // 169.254.0.0/16 - Link-local
      await expect(
        validateUrlForSSRF("http://169.254.169.254/latest/meta-data/"),
      ).rejects.toThrow(SSRFValidationError);
    });

    test("rejects IPv6 loopback and private addresses", async () => {
      await expect(validateUrlForSSRF("http://[::1]/file")).rejects.toThrow(
        SSRFValidationError,
      );
      await expect(
        validateUrlForSSRF("http://[::ffff:127.0.0.1]/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(validateUrlForSSRF("http://[fe80::1]/file")).rejects.toThrow(
        SSRFValidationError,
      );
      await expect(validateUrlForSSRF("http://[fc00::1]/file")).rejects.toThrow(
        SSRFValidationError,
      );
    });

    test("rejects suspicious hostnames", async () => {
      await expect(
        validateUrlForSSRF("https://internal.local/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(
        validateUrlForSSRF("https://test.local/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(
        validateUrlForSSRF("https://corp.localdomain/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(
        validateUrlForSSRF("https://example.test/file"),
      ).rejects.toThrow(SSRFValidationError);
    });

    test("rejects non-HTTP/HTTPS protocols", async () => {
      await expect(validateUrlForSSRF("file:///etc/passwd")).rejects.toThrow(
        SSRFValidationError,
      );
      await expect(
        validateUrlForSSRF("ftp://example.com/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(
        validateUrlForSSRF("gopher://example.com/file"),
      ).rejects.toThrow(SSRFValidationError);
      await expect(
        validateUrlForSSRF("dict://example.com/file"),
      ).rejects.toThrow(SSRFValidationError);
    });

    test("rejects HTTP when requireHttps is true", async () => {
      await expect(
        validateUrlForSSRF("http://example.com/file", { requireHttps: true }),
      ).rejects.toThrow(SSRFValidationError);
    });

    test("allows HTTP when requireHttps is false", async () => {
      const url = await validateUrlForSSRF("http://example.com/file", {
        requireHttps: false,
        strictWhitelist: false,
      });
      expect(url.toString()).toBe("http://example.com/file");
    });

    test("with strict whitelist: rejects untrusted domains", async () => {
      await expect(
        validateUrlForSSRF("https://example.com/file", {
          strictWhitelist: true,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    test("with strict whitelist: allows trusted storage domains", async () => {
      const url1 = await validateUrlForSSRF(
        "https://public.blob.vercel-storage.com/file",
      );
      expect(url1.toString()).toBe(
        "https://public.blob.vercel-storage.com/file",
      );

      const url2 = await validateUrlForSSRF(
        "https://storage.googleapis.com/bucket/file",
      );
      expect(url2.toString()).toBe(
        "https://storage.googleapis.com/bucket/file",
      );

      const url3 = await validateUrlForSSRF("https://www.notion.so/page");
      expect(url3.toString()).toBe("https://www.notion.so/page");
    });

    test("with custom allowed domains", async () => {
      const url = await validateUrlForSSRF("https://example.com/file", {
        strictWhitelist: true,
        allowedDomains: ["example.com", "*.trusted-domain.com"],
      });
      expect(url.toString()).toBe("https://example.com/file");
    });

    test("allows public IP addresses", async () => {
      const url = await validateUrlForSSRF("https://1.1.1.1/file", {
        strictWhitelist: false,
      });
      expect(url.toString()).toBe("https://1.1.1.1/file");
    });

    test("handles invalid URL format", async () => {
      await expect(validateUrlForSSRF("not-a-url")).rejects.toThrow(
        SSRFValidationError,
      );
    });
  });

  describe("fetchWithSSRFProtection", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      mockFetch.mockClear();
      // @ts-ignore - Mock global fetch
      global.fetch = mockFetch;
    });

    afterEach(() => {
      // @ts-ignore - Restore global fetch
      global.fetch = undefined;
    });

    test("validates URL before fetching", async () => {
      await expect(
        fetchWithSSRFProtection("http://127.0.0.1/file"),
      ).rejects.toThrow(SSRFValidationError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns fetch response for valid URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      const response = await fetchWithSSRFProtection(
        "https://public.blob.vercel-storage.com/file",
        { strictWhitelist: true },
      );

      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://public.blob.vercel-storage.com/file",
        expect.objectContaining({ redirect: "manual" }),
      );
    });

    test("prevents redirect to private IP", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers({ Location: "http://127.0.0.1/exploit" }),
      });

      await expect(
        fetchWithSSRFProtection("https://public.blob.vercel-storage.com/file", {
          strictWhitelist: true,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    test("follows redirects to trusted domains", async () => {
      // First call returns redirect, second call returns final response
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Headers({
            Location: "https://cdn.vercel-storage.com/redirected-file",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });

      const response = await fetchWithSSRFProtection(
        "https://public.blob.vercel-storage.com/file",
        { strictWhitelist: true },
      );

      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("rejects too many redirects", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers({ Location: "https://example.com/next" }),
      });

      await expect(
        fetchWithSSRFProtection("https://public.blob.vercel-storage.com/file", {
          strictWhitelist: true,
          allowedDomains: ["*.example.com"],
          maxRedirects: 3,
        }),
      ).rejects.toThrow(SSRFValidationError);
    });

    test("returns non-2xx responses as-is", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

      const response = await fetchWithSSRFProtection(
        "https://public.blob.vercel-storage.com/file",
        { strictWhitelist: true },
      );

      expect(response.status).toBe(404);
    });
  });
});
