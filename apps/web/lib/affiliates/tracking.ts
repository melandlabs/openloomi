import { cookies } from "next/headers";

export const AFFILIATE_COOKIE_NAME = "openloomi_affiliate_code";
export const AFFILIATE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function normalizeAffiliateCode(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

export async function readAffiliateCodeFromCookies() {
  const store = await cookies();
  const raw = store.get(AFFILIATE_COOKIE_NAME)?.value;
  return normalizeAffiliateCode(raw);
}

type CookieGetter = {
  get(name: string): { value: string } | undefined;
};

export function readAffiliateCode(cookieStore: CookieGetter) {
  const raw = cookieStore.get(AFFILIATE_COOKIE_NAME)?.value;
  return normalizeAffiliateCode(raw);
}
