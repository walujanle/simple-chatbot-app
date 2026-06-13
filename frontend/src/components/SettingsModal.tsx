import {
  cloneElement,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, api } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { exceedsPasswordByteLimit } from "@/lib/password";
import type { AIProvider, ProviderConfig, ProviderConfigInput, ReasoningEffort } from "@/types";

interface SettingsModalProps {
  onClose: () => void;
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  "openai-compatible": "OpenAI Compatible",
  anthropic: "Claude",
  gemini: "Gemini",
};

const PROVIDER_DEFAULTS: Record<AIProvider, ProviderConfigInput> = {
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    apiVersion: null,
    model: "gpt-5.5",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    temperature: 0.7,
    reasoningEffort: "medium",
    isActive: true,
  },
  anthropic: {
    baseUrl: null,
    apiVersion: null,
    model: "claude-sonnet-4-6",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    temperature: 1,
    reasoningEffort: "medium",
    isActive: true,
  },
  gemini: {
    baseUrl: null,
    apiVersion: "v1beta",
    model: "gemini-3.5-flash",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    temperature: 0.7,
    reasoningEffort: "medium",
    isActive: true,
  },
};

function fromSaved(config: ProviderConfig): ProviderConfigInput {
  return {
    baseUrl: config.baseUrl,
    apiVersion: config.apiVersion,
    model: config.model,
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
    reasoningEffort: config.reasoningEffort,
    isActive: config.isActive,
  };
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { updateUser, clearCredentialResetNotice } = useAuth();
  const [activeTab, setActiveTab] = useState<"profile" | "ai" | "security">("ai");
  const [username, setUsername] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("openai-compatible");
  const [providerForms, setProviderForms] = useState<Record<AIProvider, ProviderConfigInput>>(PROVIDER_DEFAULTS);
  const [savedProviders, setSavedProviders] = useState<ProviderConfig[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const currentForm = providerForms[selectedProvider];
  const currentSaved = useMemo(
    () => savedProviders.find((provider) => provider.provider === selectedProvider),
    [savedProviders, selectedProvider],
  );

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profile, providers] = await Promise.all([api.getProfile(), api.getProviders()]);
      setUsername(profile.user.username);
      setSystemPrompt(profile.user.system_prompt || "");
      setSavedProviders(providers.providers);
      setProviderForms((current) => {
        const next = { ...current };
        for (const provider of providers.providers) next[provider.provider] = fromSaved(provider);
        return next;
      });
      const active = providers.providers.find((provider) => provider.isActive);
      if (active) setSelectedProvider(active.provider);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) || [],
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const updateProviderForm = <K extends keyof ProviderConfigInput>(key: K, value: ProviderConfigInput[K]) => {
    setProviderForms((current) => ({
      ...current,
      [selectedProvider]: { ...current[selectedProvider], [key]: value },
    }));
  };

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    resetMessages();
    try {
      const response = await api.updateProfile(username, systemPrompt.trim() || null);
      updateUser(response.user.username);
      setSuccess("Profile saved");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  };

  const saveAiSettings = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    resetMessages();
    try {
      await api.updateProfile(username, systemPrompt.trim() || null);
      const response = await api.saveProvider(selectedProvider, {
        ...currentForm,
        apiKey: apiKey.trim() || undefined,
        isActive: true,
      });
      setApiKey("");
      setSavedProviders((current) => [
        ...current
          .filter((provider) => provider.provider !== selectedProvider)
          .map((provider) => ({ ...provider, isActive: false })),
        response.provider,
      ]);
      setProviderForms((current) => ({ ...current, [selectedProvider]: fromSaved(response.provider) }));
      await clearCredentialResetNotice(false);
      setSuccess(`${PROVIDER_LABELS[selectedProvider]} saved and activated`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to save AI settings");
    } finally {
      setLoading(false);
    }
  };

  const testProvider = async () => {
    setLoading(true);
    resetMessages();
    try {
      await api.testProvider(selectedProvider);
      setSuccess("Provider connection succeeded");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Provider connection failed");
    } finally {
      setLoading(false);
    }
  };

  const removeProvider = async () => {
    setLoading(true);
    resetMessages();
    try {
      await api.deleteProvider(selectedProvider);
      setSavedProviders((current) => current.filter((provider) => provider.provider !== selectedProvider));
      setProviderForms((current) => ({ ...current, [selectedProvider]: PROVIDER_DEFAULTS[selectedProvider] }));
      setApiKey("");
      setSuccess("Stored credential removed");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to remove provider");
    } finally {
      setLoading(false);
    }
  };

  const removeAllProviders = async () => {
    if (!window.confirm("Delete all stored AI credentials? Provider settings will need to be configured again."))
      return;
    setLoading(true);
    resetMessages();
    try {
      const response = await api.deleteAllProviders();
      setSavedProviders([]);
      setProviderForms(PROVIDER_DEFAULTS);
      setApiKey("");
      await clearCredentialResetNotice(false);
      setSuccess(
        response.deletedCount === 1
          ? "Deleted 1 stored credential"
          : `Deleted ${response.deletedCount} stored credentials`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to delete stored credentials");
    } finally {
      setLoading(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    if (exceedsPasswordByteLimit(newPassword)) {
      setError("Password must not exceed 72 UTF-8 bytes");
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password updated");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#151515] shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <h2 id={titleId} className="text-lg font-semibold text-white">
            Settings
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="Close settings"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex shrink-0 overflow-x-auto border-b border-white/10 px-2 sm:px-4">
          {(["profile", "ai", "security"] as const).map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                resetMessages();
              }}
              className={`-mb-px shrink-0 border-b-2 py-3.5 px-4 text-sm font-medium capitalize transition-all duration-200 cursor-pointer ${
                activeTab === tab ? "border-white text-white" : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {tab === "ai" ? "AI Providers" : tab}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300"
            >
              {error}
            </div>
          )}
          {success && (
            <div
              role="status"
              className="mb-4 rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-sm text-green-300"
            >
              {success}
            </div>
          )}

          {activeTab === "profile" && (
            <form onSubmit={saveProfile} className="space-y-5">
              <Field label="Username">
                <input
                  className="input-field"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  minLength={3}
                  maxLength={32}
                  required
                  disabled={loading}
                />
              </Field>
              <Field label="System instruction">
                <textarea
                  className="input-field min-h-32 resize-y"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  maxLength={12000}
                  placeholder="Optional instructions applied to every conversation"
                  disabled={loading}
                />
              </Field>
              <ActionButton loading={loading}>Save profile</ActionButton>
            </form>
          )}

          {activeTab === "ai" && (
            <form onSubmit={saveAiSettings} className="space-y-5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map((provider) => (
                  <button
                    type="button"
                    key={provider}
                    onClick={() => {
                      setSelectedProvider(provider);
                      setApiKey("");
                      resetMessages();
                    }}
                    className={`min-w-0 wrap-break-word rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer ${
                      selectedProvider === provider
                        ? "border-white/25 bg-white/10 text-white shadow-[0_0_12px_rgba(255,255,255,0.03)]"
                        : "border-white/5 text-white/40 hover:bg-white/5 hover:text-white/70"
                    }`}
                  >
                    {PROVIDER_LABELS[provider]}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/2 p-4 text-xs leading-relaxed text-white/50">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1">
                    Keys are sent only to this backend, encrypted at rest, never returned by the API, and never stored
                    in browser storage.
                  </p>
                  {savedProviders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void removeAllProviders()}
                      disabled={loading}
                      className="rounded-lg border border-red-400/20 px-3 py-2 font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Delete all credentials
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-blue-400/15 bg-blue-400/5 p-4 text-xs leading-relaxed text-blue-100/60">
                Choose by API protocol, not model name. Use Claude or Gemini here only when the provider supports the
                native Anthropic Messages or Gemini generateContent API. If it exposes an OpenAI-style
                <code className="mx-1 break-all rounded bg-black/20 px-1 py-0.5">/chat/completions</code>
                endpoint, configure it under OpenAI Compatible even when the model is Claude or Gemini.
              </div>

              <Field label={`API key${currentSaved ? ` (${currentSaved.maskedApiKey})` : ""}`}>
                <input
                  type="password"
                  autoComplete="off"
                  className="input-field"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={currentSaved ? "Leave blank to keep the existing key" : "Enter your provider API key"}
                  disabled={loading}
                />
              </Field>

              <Field
                label={selectedProvider === "openai-compatible" ? "Base URL" : "Custom native base URL (optional)"}
              >
                <input
                  type="url"
                  className="input-field"
                  value={currentForm.baseUrl || ""}
                  onChange={(event) => updateProviderForm("baseUrl", event.target.value || null)}
                  placeholder={
                    selectedProvider === "openai-compatible"
                      ? "https://api.openai.com/v1"
                      : selectedProvider === "anthropic"
                        ? "Official Anthropic API when blank"
                        : "Official Gemini API when blank"
                  }
                  required={selectedProvider === "openai-compatible"}
                  disabled={loading}
                />
              </Field>

              {selectedProvider === "gemini" && (
                <Field label="Gemini API version">
                  <input
                    className="input-field"
                    value={currentForm.apiVersion || ""}
                    onChange={(event) => updateProviderForm("apiVersion", event.target.value || null)}
                    placeholder="v1beta"
                    pattern="[a-zA-Z0-9._\-]{1,32}"
                    maxLength={32}
                    disabled={loading}
                  />
                </Field>
              )}

              <Field label="Model ID">
                <input
                  className="input-field"
                  value={currentForm.model}
                  onChange={(event) => updateProviderForm("model", event.target.value)}
                  required
                  maxLength={200}
                  disabled={loading}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Context window">
                  <input
                    type="number"
                    className="input-field"
                    min={4096}
                    max={2000000}
                    value={currentForm.contextWindow}
                    onChange={(event) => updateProviderForm("contextWindow", Number(event.target.value))}
                    required
                    disabled={loading}
                  />
                </Field>
                <Field label="Maximum output tokens">
                  <input
                    type="number"
                    className="input-field"
                    min={64}
                    max={131072}
                    value={currentForm.maxOutputTokens}
                    onChange={(event) => updateProviderForm("maxOutputTokens", Number(event.target.value))}
                    required
                    disabled={loading}
                  />
                </Field>
              </div>

              {selectedProvider !== "anthropic" && (
                <Field label={`Temperature (${currentForm.temperature.toFixed(1)})`}>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={currentForm.temperature}
                    onChange={(event) => updateProviderForm("temperature", Number(event.target.value))}
                    className="w-full accent-white"
                    disabled={loading}
                  />
                </Field>
              )}

              <Field label="Reasoning effort">
                <select
                  className="input-field"
                  value={currentForm.reasoningEffort}
                  onChange={(event) => updateProviderForm("reasoningEffort", event.target.value as ReasoningEffort)}
                  disabled={loading}
                >
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </Field>

              <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
                {currentSaved && (
                  <button
                    type="button"
                    onClick={() => void removeProvider()}
                    disabled={loading}
                    className="rounded-xl px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Delete credential
                  </button>
                )}
                {currentSaved && (
                  <button
                    type="button"
                    onClick={() => void testProvider()}
                    disabled={loading}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-50"
                  >
                    Test saved config
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-white px-5 py-2 text-sm font-medium text-black hover:bg-gray-200 disabled:opacity-50"
                >
                  Save and activate
                </button>
              </div>
            </form>
          )}

          {activeTab === "security" && (
            <form onSubmit={changePassword} className="space-y-5">
              <Field label="Current password">
                <input
                  type="password"
                  autoComplete="current-password"
                  className="input-field"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  disabled={loading}
                />
              </Field>
              <Field label="New password">
                <input
                  type="password"
                  autoComplete="new-password"
                  className="input-field"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={10}
                  maxLength={72}
                  required
                  disabled={loading}
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="password"
                  autoComplete="new-password"
                  className="input-field"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={10}
                  maxLength={72}
                  required
                  disabled={loading}
                />
              </Field>
              <ActionButton loading={loading}>Change password</ActionButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  return (
    <div className="block">
      <label htmlFor={id} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/40">
        {label}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}

function ActionButton({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <div className="flex justify-end border-t border-white/10 pt-4">
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-white px-6 py-2.5 text-sm font-medium text-black hover:bg-gray-200 disabled:opacity-50"
      >
        {children}
      </button>
    </div>
  );
}
