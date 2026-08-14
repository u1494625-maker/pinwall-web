"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import ImageCropModal from "@/components/profile/ImageCropModal";
import { PROFILE_HEADER_ASPECT } from "@/components/profile/ProfileHeader";
import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH, updateProfile, type Profile } from "@/lib/profiles";
import { uploadProfileImage } from "@/lib/storage";

type EditProfileFormProps = {
  userId: string;
  profile: Profile;
};

type CropTarget = "avatar" | "background" | null;

export default function EditProfileForm({ userId, profile }: EditProfileFormProps) {
  const router = useRouter();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(profile.avatarUrl);
  const [backgroundPreviewUrl, setBackgroundPreviewUrl] = useState(profile.backgroundUrl);
  const [pendingAvatarBlob, setPendingAvatarBlob] = useState<Blob | null>(null);
  const [pendingBackgroundBlob, setPendingBackgroundBlob] = useState<Blob | null>(null);
  const [cropTarget, setCropTarget] = useState<CropTarget>(null);
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileSelected(target: CropTarget) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = ""; // allow re-selecting the same file later
      if (!file) return;
      setCropSourceUrl(URL.createObjectURL(file));
      setCropTarget(target);
    };
  }

  function closeCropModal() {
    if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    setCropSourceUrl(null);
    setCropTarget(null);
  }

  function handleCropped(blob: Blob) {
    const previewUrl = URL.createObjectURL(blob);
    if (cropTarget === "avatar") {
      setPendingAvatarBlob(blob);
      setAvatarPreviewUrl(previewUrl);
    } else if (cropTarget === "background") {
      setPendingBackgroundBlob(blob);
      setBackgroundPreviewUrl(previewUrl);
    }
    closeCropModal();
  }

  const trimmedName = displayName.trim();
  const trimmedBio = bio.trim();

  async function handleSave() {
    setError(null);

    if (trimmedName.length === 0) {
      setError("Add a display name before saving.");
      return;
    }
    if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
      setError(`Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`);
      return;
    }
    if (trimmedBio.length > MAX_BIO_LENGTH) {
      setError(`Bio must be ${MAX_BIO_LENGTH} characters or fewer.`);
      return;
    }

    setIsSaving(true);
    try {
      const [avatarUrl, backgroundUrl] = await Promise.all([
        pendingAvatarBlob ? uploadProfileImage(pendingAvatarBlob, userId, "avatar") : Promise.resolve(profile.avatarUrl),
        pendingBackgroundBlob
          ? uploadProfileImage(pendingBackgroundBlob, userId, "background")
          : Promise.resolve(profile.backgroundUrl),
      ]);

      await updateProfile(userId, {
        displayName: trimmedName,
        bio: trimmedBio.length > 0 ? trimmedBio : null,
        avatarUrl,
        backgroundUrl,
      });

      router.replace("/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSaving(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Cancel"
          className="text-sm font-semibold text-stone-500"
        >
          Cancel
        </button>
        <h1 className="text-sm font-black text-stone-900">Edit Profile</h1>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="text-sm font-black text-orange-600 disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="relative h-40 w-full bg-stone-800">
        {backgroundPreviewUrl ? <DemoPhoto src={backgroundPreviewUrl} alt="" className="absolute inset-0" /> : null}
        <div className="absolute inset-0 bg-black/25" />
        {/* Anchored top-right, not spanning the bottom edge — the avatar
            below overlaps the bottom of this banner via a negative margin,
            so a bottom-edge button here would sit underneath it and be
            unclickable. */}
        <button
          type="button"
          onClick={() => backgroundInputRef.current?.click()}
          className="absolute right-3 top-3 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm"
        >
          Change background
        </button>
        <input
          ref={backgroundInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelected("background")}
          className="hidden"
        />
      </div>

      <div className="px-5">
        <div className="-mt-10 flex justify-center">
          <button type="button" onClick={() => avatarInputRef.current?.click()} className="relative">
            {avatarPreviewUrl ? (
              <DemoPhoto
                src={avatarPreviewUrl}
                alt="Profile photo"
                className="size-20 rounded-full border-4 border-[#fbfaf7] shadow-lg"
              />
            ) : (
              <div className="grid size-20 place-items-center rounded-full border-4 border-[#fbfaf7] bg-stone-200 text-xl font-black text-stone-600 shadow-lg">
                {(trimmedName || "P").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full bg-stone-900 text-xs text-white shadow">
              ✎
            </span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileSelected("avatar")}
            className="hidden"
          />
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <label htmlFor="display-name" className="text-xs font-bold text-stone-500">
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              placeholder="Your name"
              className="mt-1.5 w-full border-none bg-transparent text-base font-bold text-stone-900 outline-none placeholder:font-normal placeholder:text-stone-400"
            />
            <p className="mt-1 text-right text-[11px] font-medium tabular-nums text-stone-400">
              {MAX_DISPLAY_NAME_LENGTH - displayName.length}
            </p>
          </div>

          <div className="border-t border-stone-100 pt-4">
            <label htmlFor="bio" className="text-xs font-bold text-stone-500">
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              maxLength={MAX_BIO_LENGTH}
              rows={3}
              placeholder="Tell people a bit about yourself…"
              className="mt-1.5 w-full resize-none border-none bg-transparent text-sm leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
            />
            <p className="text-right text-[11px] font-medium tabular-nums text-stone-400">
              {MAX_BIO_LENGTH - bio.length}
            </p>
          </div>
        </div>

        {error ? <p className="mt-4 text-center text-xs font-semibold text-red-600">{error}</p> : null}
      </div>

      {cropTarget && cropSourceUrl ? (
        <ImageCropModal
          imageSrc={cropSourceUrl}
          shape={cropTarget === "avatar" ? "round" : "rect"}
          aspect={cropTarget === "avatar" ? 1 : PROFILE_HEADER_ASPECT}
          onCancel={closeCropModal}
          onCropped={handleCropped}
        />
      ) : null}
    </main>
  );
}
