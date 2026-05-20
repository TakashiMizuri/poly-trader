import { createContext, useContext, type ReactNode } from "react";

type AuthContextValue = {
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  logout,
}: {
  children: ReactNode;
  logout: () => void;
}) {
  return <AuthContext.Provider value={{ logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthGate");
  return ctx;
}
