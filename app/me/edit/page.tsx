"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/auth/RequireAuth";
import EditProfileForm from "@/components/profile/EditProfileForm";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getProfile, type Profile } from "@/lib/profiles";

function EditProfileContent() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getProfile(user.id).then((result) => {
      if (!cancelled) {
        setProfile(result);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading || !user) {
    return <main className="min-h-screen bg-[#fbfaf7]" />;
  }

  if (!profile) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
        <h1 className="text-lg font-black">Couldn&apos;t load your profile</h1>
        <p className="mt-2 text-sm text-stone-500">Please try again.</p>
      </main>
    );
  }

  return <EditProfileForm userId={user.id} profile={profile} />;
}

export default function EditProfilePage() {
  return (
    <RequireAuth>
      <EditProfileContent />
    </RequireAuth>
  );
}
