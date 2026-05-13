import Link from "next/link";
import type { Metadata } from "next";

import {
  getUserEmailPreferencesByToken,
  unsubscribeUserByToken,
} from "@/lib/db/queries";
import { siteMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = {
  title: "Manage email preferences",
  description:
    "Update your marketing email preferences, share feedback, or re-enable lifecycle tips.",
};

export default async function MarketingUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const tokenParam = params?.token;
  const token =
    Array.isArray(tokenParam) || typeof tokenParam === "undefined"
      ? (tokenParam?.[0] ?? "")
      : tokenParam;

  if (!token) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-3xl font-semibold text-slate-900">Manage emails</h1>
        <p className="text-slate-600">
          We could not find a valid unsubscribe link. If you reached this page
          from a forwarded email, please open the original message and use the
          unsubscribe button there.
        </p>
        <Link
          href="/"
          className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          Head back to openloomi
        </Link>
      </main>
    );
  }

  const preferences = await getUserEmailPreferencesByToken(token);

  if (!preferences) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-3xl font-semibold text-slate-900">
          Link expired or invalid
        </h1>
        <p className="text-slate-600">
          The unsubscribe link has already been used or is no longer active. If
          you continue receiving emails you do not want, email us at{" "}
          <a
            href={`mailto:${siteMetadata.contactEmail}`}
            className="font-medium text-indigo-600 underline"
          >
            {siteMetadata.contactEmail}
          </a>{" "}
          and we will make sure your preferences are updated.
        </p>
        <Link
          href="/"
          className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          Return to openloomi
        </Link>
      </main>
    );
  }

  const alreadyOptedOut = preferences.marketingOptIn === false;

  if (!alreadyOptedOut) {
    await unsubscribeUserByToken(token);
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold text-slate-900">
        Your email preferences are updated
      </h1>
      <p className="text-slate-600">
        {alreadyOptedOut
          ? "You have already opted out of openloomi lifecycle tips. No further emails will be sent."
          : "You are now unsubscribed from openloomi lifecycle tips and best-practice emails. Operational and billing updates may still be sent when required."}
      </p>
      <div className="space-y-2 text-sm text-slate-500">
        <p>
          Changed your mind?{" "}
          <a
            href={`mailto:${siteMetadata.contactEmail}?subject=Resubscribe%20me%20to%20openloomi%20updates`}
            className="font-medium text-indigo-600 underline"
          >
            Email our team
          </a>{" "}
          and we will re-enable updates.
        </p>
        <p>
          Have product suggestions? Share them with us in the{" "}
          <Link
            href="/support"
            className="font-medium text-indigo-600 underline"
          >
            support center
          </Link>
          .
        </p>
      </div>
      <Link
        href="/"
        className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
      >
        Return to openloomi
      </Link>
    </main>
  );
}
