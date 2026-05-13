"use client";

import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { fetchWithAuth } from "@/lib/utils";
import { useLocalStorage } from "usehooks-ts";

const PROFILE_KEY = "/api/user/profile";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  hasPassword: boolean;
  updatedAt: string | null;
  lastLoginAt: string | null;
}

function clearCachedProfile() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("openloomi_user_profile");
  } catch {}
}

export function useUserProfile() {
  const { data: session } = useSession();
  const isAuthenticated = Boolean(session?.user);

  // Local state from cache for instant render
  const [cachedProfile, setCachedProfile] = useLocalStorage<UserProfile | null>(
    "openloomi_user_profile",
    null,
  );

  // SWR fetches fresh data
  const {
    data,
    mutate: revalidate,
    isLoading,
  } = useSWR<UserProfile>(
    isAuthenticated ? PROFILE_KEY : null,
    (url) =>
      fetchWithAuth(url).then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch profile");
        const json = (await res.json()) as { user: UserProfile };
        return json.user;
      }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60_000,
      onSuccess(profile) {
        if (profile) {
          setCachedProfile(profile);
        }
      },
    },
  );

  // Sync cache when session changes
  useEffect(() => {
    if (!session?.user?.id) {
      clearCachedProfile();
    }
  }, [session?.user?.id]);

  return {
    profile: data ?? cachedProfile,
    isLoading,
    revalidate,
    updateProfile: (updates: Partial<UserProfile>) => {
      const current = data ?? cachedProfile;
      if (!current) return;
      const updated = { ...current, ...updates };
      setCachedProfile(updated);
      // Optimistically update SWR cache
      revalidate(
        async () => {
          const res = await fetchWithAuth(PROFILE_KEY, {
            method: "PATCH",
            body: JSON.stringify(updates),
          });
          if (!res.ok) throw new Error("Update failed");
          const json = (await res.json()) as { user: UserProfile };
          const fresh = json.user;
          setCachedProfile(fresh);
          return fresh;
        },
        { revalidate: false },
      );
    },
  };
}
