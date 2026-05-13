/**
 * Feishu Open Platform "App Registration" device code flow (aligned with OpenClaw)
 * Reference: accounts.feishu.cn/oauth/v1/app/registration
 * After user scans QR code, polling returns client_id / client_secret (i.e. bot App ID / App Secret)
 */

export type FeishuAccountsDomain = "feishu" | "lark";

const FEISHU_ACCOUNTS_URL = "https://accounts.feishu.cn";
const LARK_ACCOUNTS_URL = "https://accounts.larksuite.com";
const REGISTRATION_PATH = "/oauth/v1/app/registration";
const REQUEST_TIMEOUT_MS = 15_000;

export function accountsBaseUrl(domain: FeishuAccountsDomain): string {
  return domain === "lark" ? LARK_ACCOUNTS_URL : FEISHU_ACCOUNTS_URL;
}

async function postRegistration(
  domain: FeishuAccountsDomain,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = `${accountsBaseUrl(domain)}${REGISTRATION_PATH}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await resp.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!resp.ok) {
    const msg =
      json && typeof json.msg === "string" ? json.msg : `HTTP ${resp.status}`;
    throw new Error(`Feishu registration HTTP error: ${msg}`);
  }
  return json ?? {};
}

/**
 * Check if current environment supports client_secret device code registration
 */
export async function initAppRegistration(
  domain: FeishuAccountsDomain = "feishu",
): Promise<void> {
  const res = await postRegistration(domain, { action: "init" });
  const methods = res.supported_auth_methods;
  if (!Array.isArray(methods) || !methods.includes("client_secret")) {
    throw new Error("feishu_registration_not_supported");
  }
}

export type BeginRegistrationResult = {
  deviceCode: string;
  qrUrl: string;
  userCode?: string;
  intervalSec: number;
  expireInSec: number;
};

/**
 * Start device code flow: return URL for QR code generation and device_code
 */
export async function beginAppRegistration(
  domain: FeishuAccountsDomain = "feishu",
): Promise<BeginRegistrationResult> {
  const res = await postRegistration(domain, {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });
  if (typeof res.error === "string" && res.error) {
    const desc =
      typeof res.error_description === "string" ? res.error_description : "";
    throw new Error(`feishu_registration_begin: ${res.error} ${desc}`.trim());
  }
  const verificationUriComplete = res.verification_uri_complete;
  const deviceCode = res.device_code;
  if (typeof verificationUriComplete !== "string" || !verificationUriComplete) {
    throw new Error("feishu_registration_begin_missing_uri");
  }
  if (typeof deviceCode !== "string" || !deviceCode) {
    throw new Error("feishu_registration_begin_missing_device_code");
  }
  const qrUrl = new URL(verificationUriComplete);
  qrUrl.searchParams.set("from", "openloomi");
  qrUrl.searchParams.set("tp", "ob_cli_app");
  return {
    deviceCode,
    qrUrl: qrUrl.toString(),
    userCode: typeof res.user_code === "string" ? res.user_code : undefined,
    intervalSec: typeof res.interval === "number" ? res.interval : 5,
    expireInSec: typeof res.expire_in === "number" ? res.expire_in : 600,
  };
}

export type PollRegistrationOnceResult =
  | {
      kind: "success";
      appId: string;
      appSecret: string;
      domain: FeishuAccountsDomain;
      openId?: string;
    }
  | {
      kind: "pending";
      /** If Feishu returns Lark tenant, next poll needs to switch to lark domain */
      nextDomain: FeishuAccountsDomain;
      /** If Feishu requires slow_down, interval will increase */
      nextIntervalSec: number;
    }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

/**
 * Poll registration result once (called repeatedly by frontend per interval)
 * @param tp Same as OpenClaw `runScanToCreate`, pass ob_app
 */
export async function pollAppRegistrationOnce(params: {
  domain: FeishuAccountsDomain;
  deviceCode: string;
  currentIntervalSec: number;
  /** Whether domain switch has already been executed (Feishu international) */
  domainAlreadySwitched: boolean;
  tp?: string;
}): Promise<PollRegistrationOnceResult> {
  const tp = params.tp ?? "ob_app";
  let pollRes: Record<string, unknown>;
  try {
    const body: Record<string, string> = {
      action: "poll",
      device_code: params.deviceCode,
      tp,
    };
    pollRes = await postRegistration(params.domain, body);
  } catch {
    return {
      kind: "pending",
      nextDomain: params.domain,
      nextIntervalSec: params.currentIntervalSec,
    };
  }

  const userInfo = pollRes.user_info as Record<string, unknown> | undefined;
  const tenantBrand =
    userInfo && typeof userInfo.tenant_brand === "string"
      ? userInfo.tenant_brand
      : undefined;
  if (tenantBrand === "lark" && !params.domainAlreadySwitched) {
    return {
      kind: "pending",
      nextDomain: "lark",
      nextIntervalSec: params.currentIntervalSec,
    };
  }

  const clientId = pollRes.client_id;
  const clientSecret = pollRes.client_secret;
  if (typeof clientId === "string" && typeof clientSecret === "string") {
    const openIdRaw = userInfo?.open_id;
    return {
      kind: "success",
      appId: clientId,
      appSecret: clientSecret,
      domain: params.domain,
      openId: typeof openIdRaw === "string" ? openIdRaw : undefined,
    };
  }

  const err = pollRes.error;
  if (err === "authorization_pending") {
    return {
      kind: "pending",
      nextDomain: params.domain,
      nextIntervalSec: params.currentIntervalSec,
    };
  }
  if (err === "slow_down") {
    return {
      kind: "pending",
      nextDomain: params.domain,
      nextIntervalSec: params.currentIntervalSec + 5,
    };
  }
  if (err === "access_denied") {
    return { kind: "denied" };
  }
  if (err === "expired_token") {
    return { kind: "expired" };
  }
  if (typeof err === "string" && err) {
    const desc =
      typeof pollRes.error_description === "string"
        ? pollRes.error_description
        : "";
    return { kind: "error", message: `${err}: ${desc || "unknown"}` };
  }

  return {
    kind: "pending",
    nextDomain: params.domain,
    nextIntervalSec: params.currentIntervalSec,
  };
}
