import { useEffect, useState } from "react";
import { auth, githubProvider } from "./firebase";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID || "";
const ADMIN_GH = (import.meta.env.VITE_ADMIN_GH_USERNAME || "").toLowerCase();

export function useAdminAuth() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() =>
    onAuthStateChanged(auth, u => {
      setUser(u);
      setReady(true);
      if (u && !ADMIN_UID) {
        console.log("Capture this UID and put it in .env.local as VITE_ADMIN_UID:", u.uid);
        console.log("GitHub username (screenName):", u.reloadUserInfo?.screenName);
      }
    }), []);

  const login = async () => {
    await signInWithPopup(auth, githubProvider);
  };
  const logout = async () => { await signOut(auth); };

  const ghName = (user?.reloadUserInfo?.screenName || "").toLowerCase();
  const isAdmin = !!user && (
    (ADMIN_UID && user.uid === ADMIN_UID) ||
    (ADMIN_GH && ghName === ADMIN_GH)
  );

  return { user, ready, isAdmin, login, logout };
}