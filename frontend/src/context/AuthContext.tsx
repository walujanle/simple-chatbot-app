import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { User } from "@/types";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  registrationEnabled: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (username: string) => void;
  clearCredentialResetNotice: (persist?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.getAuthConfig().catch(() => ({ registrationEnabled: false })), api.getProfile().catch(() => null)])
      .then(([authConfig, profile]) => {
        if (!active) return;
        setRegistrationEnabled(authConfig.registrationEnabled);
        setUser(profile?.user || null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    const handleUnauthorized = () => setUser(null);
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => {
      active = false;
      window.removeEventListener("auth:unauthorized", handleUnauthorized);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setUser((await api.login(username, password)).user);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    setUser((await api.register(username, password)).user);
  }, []);

  const logout = useCallback(async () => {
    api.cancelActiveStream();
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const updateUser = useCallback((username: string) => {
    setUser((current) => (current ? { ...current, username } : null));
  }, []);

  const clearCredentialResetNotice = useCallback(async (persist = true) => {
    if (persist) await api.acknowledgeCredentialReset();
    setUser((current) => (current ? { ...current, credentialResetRequired: false } : null));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        registrationEnabled,
        login,
        register,
        logout,
        updateUser,
        clearCredentialResetNotice,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
