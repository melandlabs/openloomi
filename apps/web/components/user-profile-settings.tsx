"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSession, signOut } from "next-auth/react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Input,
  Label,
  Separator,
} from "@openloomi/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@openloomi/ui";
import { toast } from "@/components/toast";
import { fetchWithAuth } from "@/lib/utils";
import { useUserProfile } from "@/hooks/use-user-profile";
import { PersonalizationSwrBoundary } from "@/components/personalization/personalization-swr-boundary";
import { PersonalizationBasicSettings } from "@/components/personalization/personalization-basic-settings";

type ProfileResponse = {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    hasPassword?: boolean;
    lastLoginAt?: string | null;
    updatedAt?: string | null;
  };
};

/** Account profile modal type: full name */
type AccountFieldModal = "fullName" | null;

/**
 * User account settings panel (profile editing, avatar / full name / password, etc.).
 * Note: should fill available width within tool page content area, avoiding fixed max-width constraints.
 */
export function UserProfileSettings() {
  const { t } = useTranslation();
  const { data: session, update: updateSession } = useSession();
  const { profile, revalidate } = useUserProfile();

  const [profileLoading, setProfileLoading] = useState(true);
  const [email, setEmail] = useState<string>(profile?.email ?? "");
  const [name, setName] = useState<string>(profile?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string>(profile?.avatarUrl ?? "");
  const [hasPassword, setHasPassword] = useState<boolean>(
    profile?.hasPassword ?? false,
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(
    profile?.updatedAt ?? null,
  );

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [isLoadingReset, setIsLoadingReset] = useState(false);

  /** Currently open account field modal */
  const [accountModal, setAccountModal] = useState<AccountFieldModal>(null);
  /** Draft full name edited within the modal */
  const [draftName, setDraftName] = useState("");
  /** Avatar modal: uploading state */
  const [avatarUploading, setAvatarUploading] = useState(false);
  /** Avatar upload: hidden input ref for directly opening system file picker */
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  /** Password change modal toggle */
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  // Password visibility states
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Password strength checks
  const lengthValid = newPassword.length >= 8 && newPassword.length <= 20;
  const compositionValid =
    /[A-Za-z]/.test(newPassword) && /\d/.test(newPassword);
  const passwordsMatch = newPassword !== "" && newPassword === confirmPassword;
  const isPasswordStrongEnough = lengthValid && compositionValid;
  const hasCurrentPassword = hasPassword ? currentPassword.length > 0 : true;
  const canSubmitPassword =
    hasCurrentPassword && isPasswordStrongEnough && passwordsMatch;

  useEffect(() => {
    if (!session?.user?.id) return;
    setProfileLoading(true);
    revalidate()
      .then((fresh) => {
        if (!fresh) return;
        setEmail(fresh.email ?? session.user?.email ?? "");
        setName(fresh.name ?? "");
        setAvatarUrl(fresh.avatarUrl ?? "");
        setHasPassword(Boolean(fresh.hasPassword));
        setUpdatedAt(fresh.updatedAt ?? null);
      })
      .catch(() => {
        toast({ type: "error", description: t("settings.profileLoadError") });
      })
      .finally(() => {
        setProfileLoading(false);
      });
  }, [session?.user?.id, session?.user?.email, t, revalidate]);

  const derivedName = useMemo(() => {
    if (name) return name;
    if (session?.user?.displayName) return session.user.displayName;
    if (session?.user?.name) return session.user.name;
    if (email) return email.split("@")[0];
    return t("common.guest");
  }, [email, name, session?.user?.displayName, session?.user?.name, t]);

  const avatarPreview = useMemo(() => {
    if (avatarUrl) return avatarUrl;
    return email
      ? `https://avatar.vercel.sh/${email}`
      : `https://avatar.vercel.sh/${derivedName}`;
  }, [avatarUrl, email, derivedName]);

  const initials = derivedName
    .split(" ")
    .slice(0, 2)
    .map((chunk) => chunk[0])
    .join("")
    .toUpperCase();

  /**
   * Partially update user profile (only submits passed fields), syncs local state and session on success.
   * @param updates Can include name and/or avatarUrl
   * @param closeModal Whether to close the modal on success
   */
  const patchProfile = async (
    updates: Partial<{ name: string; avatarUrl: string }>,
    closeModal = true,
  ) => {
    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      if (trimmedName.length > 0 && trimmedName.length < 2) {
        toast({
          type: "error",
          description: t("settings.profileNameTooShort"),
        });
        return;
      }
    }

    setSavingProfile(true);
    try {
      const payload: Record<string, string> = {};
      if (updates.name !== undefined) {
        const trimmedName = updates.name.trim();
        if (trimmedName) {
          payload.name = trimmedName;
        } else {
          payload.name = "";
        }
      }
      if (updates.avatarUrl !== undefined) {
        payload.avatarUrl = updates.avatarUrl.trim();
      }

      const response = await fetchWithAuth("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | ProfileResponse
        | { error?: string };

      if (!response.ok || !("user" in data)) {
        throw new Error("profile_update_failed");
      }

      if (updates.name !== undefined) {
        setName(data.user.name ?? updates.name.trim());
      }
      if (updates.avatarUrl !== undefined) {
        setAvatarUrl(data.user.avatarUrl ?? "");
      }
      setEmail(data.user.email ?? email);
      setUpdatedAt(data.user.updatedAt ?? updatedAt);
      void updateSession?.();

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("userProfileUpdated"));
      }

      toast({
        type: "success",
        description: t("settings.profileSaved"),
      });
      if (closeModal) {
        setAccountModal(null);
      }
    } catch (error) {
      console.error("[UserProfile] Failed to save profile", error);
      toast({
        type: "error",
        description: t("settings.profileSaveError"),
      });
    } finally {
      setSavingProfile(false);
    }
  };

  /** Open system file picker to select a local avatar file directly. */
  const openAvatarPicker = () => {
    avatarInputRef.current?.click();
  };

  /** Open "Change Full Name" modal and sync draft (prefers saved name, falls back to session) */
  const openFullNameModal = () => {
    setDraftName(
      name || session?.user?.displayName || session?.user?.name || "",
    );
    setAccountModal("fullName");
  };

  /** Open "Change Password" modal */
  const openPasswordModal = () => {
    setPasswordModalOpen(true);
  };

  /** Close "Change Password" modal and clear sensitive inputs */
  const closePasswordModal = () => {
    setPasswordModalOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  /**
   * Upload avatar image to the unified file upload endpoint and return a publicly accessible URL.
   * @param file Locally selected image file
   */
  const uploadAvatarFile = async (file: File): Promise<string> => {
    const isImage = file.type.startsWith("image/");
    if (!isImage) {
      throw new Error("invalid_file_type");
    }

    // Avatar doesn't need to be large; frontend soft limit here, backend still has MAX_UPLOAD_BYTES as a fallback
    const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_AVATAR_BYTES) {
      throw new Error("file_too_large");
    }

    const formData = new FormData();
    formData.set("file", file);
    // Don't create a file record to avoid consuming user quota / list noise

    const response = await fetchWithAuth("/api/files/upload", {
      method: "POST",
      body: formData,
    });

    const data = (await response.json().catch(() => null)) as {
      url?: string;
      error?: string;
    } | null;

    if (!response.ok || !data?.url) {
      throw new Error(data?.error || "upload_failed");
    }

    return data.url;
  };

  /**
   * Handle avatar file selection: upload immediately after file is selected and write back to profile.avatarUrl.
   * @param file The selected avatar file this time
   */
  const handleUploadAvatarFile = async (file: File) => {
    setAvatarUploading(true);
    try {
      const url = await uploadAvatarFile(file);
      await patchProfile({ avatarUrl: url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "upload_failed";
      toast({
        type: "error",
        description:
          message === "file_too_large"
            ? t("settings.accountAvatarFileTooLarge")
            : message === "invalid_file_type"
              ? t("settings.accountAvatarFileTypeInvalid")
              : t("settings.accountAvatarUploadFailed"),
      });
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  };

  const handleUpdatePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast({
        type: "error",
        description: t("settings.passwordErrorMismatch"),
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        type: "error",
        description: t("settings.passwordErrorMismatch"),
      });
      return;
    }

    setSavingPassword(true);
    try {
      const response = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data?.error === "current_password_required") {
          toast({
            type: "error",
            description: t("settings.passwordErrorCurrentRequired"),
          });
        } else if (data?.error === "invalid_current_password") {
          toast({
            type: "error",
            description: t("settings.passwordErrorCurrentInvalid"),
          });
        } else if (data?.error === "password_mismatch") {
          toast({
            type: "error",
            description: t("settings.passwordErrorMismatch"),
          });
        } else {
          toast({
            type: "error",
            description: t("settings.passwordSaveError"),
          });
        }
        return;
      }

      setHasPassword(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        type: "success",
        description: t("settings.passwordSavedAllDevices"),
      });
      void signOut({ callbackUrl: "/login" });
    } catch (error) {
      console.error("[UserPassword] Failed to update password", error);
      toast({
        type: "error",
        description: t("settings.passwordSaveError"),
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRequestPasswordReset = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = (formData.get("email") as string)?.trim();

    if (!email) {
      toast({ type: "error", description: t("auth.resetMissingEmail") });
      return;
    }

    setIsLoadingReset(true);
    try {
      const response = await fetch("/api/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 429) {
          toast({
            type: "error",
            description: t("auth.resetRequestRateLimited"),
          });
        } else if (data?.error === "shadow_user_not_found") {
          toast({ type: "error", description: t("auth.shadowUserNotFound") });
        } else {
          toast({ type: "error", description: t("auth.resetRequestFailed") });
        }
        return;
      }
      const deliveryStatus =
        data?.deliveryStatus ?? (data?.delivered ? "queued" : undefined);

      if (deliveryStatus === "unavailable") {
        toast({
          type: "error",
          description:
            data?.reason === "smtp_not_configured"
              ? t("auth.resetRequestUnavailable")
              : t("auth.resetRequestFailed"),
        });
        return;
      }

      toast({
        type: "success",
        description: t("auth.resetRequestSuccessHeading"),
      });
      setShowForgotPasswordModal(false);
    } catch (error) {
      console.error("[ForgotPassword]", error);
      toast({ type: "error", description: t("auth.resetRequestFailed") });
    } finally {
      setIsLoadingReset(false);
    }
  };

  return (
    <div className="w-full max-w-none space-y-8">
      <div className="w-full px-1 sm:px-0 space-y-8">
        <div className="w-full flex flex-col gap-6">
          <p className="px-0 pb-0 text-base font-semibold text-foreground-secondary">
            {t("settings.accountSettings")}
          </p>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file || avatarUploading || savingProfile || profileLoading) {
                return;
              }
              void handleUploadAvatarFile(file);
            }}
          />
          {/* Avatar + name row */}
          <div className="w-full flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="size-14 shrink-0 ring-1 ring-border sm:size-16">
                <AvatarImage src={avatarPreview} alt={derivedName} />
                <AvatarFallback>{initials || "U"}</AvatarFallback>
              </Avatar>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 self-start sm:self-center"
              disabled={profileLoading || avatarUploading || savingProfile}
              onClick={openAvatarPicker}
            >
              {t("settings.accountChangeAvatar")}
            </Button>
          </div>

          {/* Username (display name, editable) */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("settings.accountUsernameLabel")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {derivedName}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 self-start sm:self-center"
              disabled={profileLoading}
              onClick={openFullNameModal}
            >
              {t("settings.accountChangeUsername")}
            </Button>
          </div>

          {/* Email (read-only, matches screenshot with no action button) */}
          <div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("settings.accountEmailLabel")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground break-all">
                {email || "—"}
              </p>
            </div>
          </div>

          {/* Password (edited in modal) */}
          {hasPassword && (
            <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t("settings.passwordTitle")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                onClick={openPasswordModal}
              >
                {t("settings.passwordSaveCta")}
              </Button>
            </div>
          )}
        </div>

        <Separator className="mb-8" />

        <div className="w-full mt-0">
          <p className="mb-6 px-0 pb-0 text-base font-semibold text-foreground-secondary">
            {t("settings.openloomiSettings")}
          </p>
          <PersonalizationSwrBoundary>
            <PersonalizationBasicSettings open />
          </PersonalizationSwrBoundary>
        </div>
      </div>

      {/* Change full name */}
      <Dialog
        open={accountModal === "fullName"}
        onOpenChange={(open) => !open && setAccountModal(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.accountModalFullNameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              id="modal-display-name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={derivedName}
              disabled={profileLoading}
            />
            <p className="text-muted-foreground text-sm">
              {t("settings.displayNameHint")}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAccountModal(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => patchProfile({ name: draftName })}
              disabled={savingProfile || profileLoading}
            >
              {savingProfile && (
                <RemixIcon
                  name="loader_2"
                  size="size-4"
                  className="mr-2 animate-spin"
                />
              )}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change password modal */}
      <Dialog
        open={passwordModalOpen}
        onOpenChange={(open) => !open && closePasswordModal()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.passwordTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password" className="font-normal">
                {t("settings.currentPasswordLabel")}
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="pr-10"
                  placeholder="••••••••"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  tabIndex={-1}
                  aria-label={
                    showCurrentPassword ? "Hide password" : "Show password"
                  }
                >
                  {showCurrentPassword ? (
                    <RemixIcon name="eye_off" size="size-4" />
                  ) : (
                    <RemixIcon name="eye" size="size-4" />
                  )}
                </Button>
              </div>
              <button
                type="button"
                className="block w-full text-right text-xs text-primary hover:underline"
                onClick={() => setShowForgotPasswordModal(true)}
              >
                {t("auth.forgotPassword")}
              </button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password" className="font-normal">
                {t("settings.newPasswordLabel")}
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="pr-10"
                  placeholder="••••••••"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  tabIndex={-1}
                  aria-label={
                    showNewPassword ? "Hide password" : "Show password"
                  }
                >
                  {showNewPassword ? (
                    <RemixIcon name="eye_off" size="size-4" />
                  ) : (
                    <RemixIcon name="eye" size="size-4" />
                  )}
                </Button>
              </div>
              {newPassword.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <RemixIcon
                      name={lengthValid ? "check" : "close"}
                      size="size-3"
                      className={
                        lengthValid ? "text-green-500" : "text-red-500"
                      }
                    />
                    <span
                      className={
                        lengthValid ? "text-green-500" : "text-red-500"
                      }
                    >
                      {t("auth.passwordRuleLength")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <RemixIcon
                      name={compositionValid ? "check" : "close"}
                      size="size-3"
                      className={
                        compositionValid ? "text-green-500" : "text-red-500"
                      }
                    />
                    <span
                      className={
                        compositionValid ? "text-green-500" : "text-red-500"
                      }
                    >
                      {t("auth.passwordRuleComposition")}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="font-normal">
                {t("settings.confirmPasswordLabel")}
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="pr-10"
                  placeholder="••••••••"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex={-1}
                  aria-label={
                    showConfirmPassword ? "Hide password" : "Show password"
                  }
                >
                  {showConfirmPassword ? (
                    <RemixIcon name="eye_off" size="size-4" />
                  ) : (
                    <RemixIcon name="eye" size="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.passwordHelper")}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={closePasswordModal}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleUpdatePassword}
              disabled={savingPassword || !canSubmitPassword}
            >
              {savingPassword && (
                <RemixIcon
                  name="loader_2"
                  size="size-4"
                  className="mr-2 animate-spin"
                />
              )}
              {t("common.update")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Forgot Password Modal */}
      <Dialog
        open={showForgotPasswordModal}
        onOpenChange={setShowForgotPasswordModal}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.forgotPasswordTitle")}</DialogTitle>
            <DialogDescription>
              {t("auth.forgotPasswordSubtitle")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleRequestPasswordReset}>
            <div className="space-y-2">
              <Label
                htmlFor="reset-email"
                className="text-sm font-medium text-foreground/80"
              >
                {t("auth.emailLabel")}
              </Label>
              <Input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder={t("auth.emailPlaceholder")}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoadingReset}>
              {isLoadingReset
                ? t("auth.resetRequestSending")
                : t("auth.resetRequestCta")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
