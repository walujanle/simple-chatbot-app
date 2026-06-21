import {
  cloneElement,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ApiError, api } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import type { AIProvider, ProviderConfig, ProviderConfigInput, ReasoningEffort } from "@/types";

interface SettingsModalProps {
  onClose: () => void;
  focusApiKey?: boolean;
  onProviderStatusChange?: (ready: boolean) => void;
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  "openai-compatible": "OpenAI Compatible",
  anthropic: "Claude (Anthropic)",
  gemini: "Gemini (Google)",
};

const DEFAULT_FORM_VALUES = (provider: AIProvider): ProviderConfigInput => {
  if (provider === "openai-compatible") {
    return {
      name: "My OpenAI Compatible Model",
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiVersion: null,
      model: "gpt-4o",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      temperature: 0.7,
      reasoningEffort: "off",
      isActive: true,
    };
  }
  if (provider === "anthropic") {
    return {
      name: "My Claude Model",
      provider: "anthropic",
      baseUrl: null,
      apiVersion: null,
      model: "claude-3-5-sonnet-latest",
      contextWindow: 200000,
      maxOutputTokens: 4096,
      temperature: 1,
      reasoningEffort: "off",
      isActive: true,
    };
  }
  return {
    name: "My Gemini Model",
    provider: "gemini",
    baseUrl: null,
    apiVersion: "v1beta",
    model: "gemini-2.5-flash",
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    temperature: 0.7,
    reasoningEffort: "off",
    isActive: true,
  };
};

export function SettingsModal({ onClose, focusApiKey = false, onProviderStatusChange }: SettingsModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const { updateUser, clearCredentialResetNotice } = useAuth();

  const [activeTab, setActiveTab] = useState<"profile" | "ai" | "security">("ai");
  const [username, setUsername] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  // AI Config List & Form State
  const [savedProviders, setSavedProviders] = useState<ProviderConfig[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formValues, setFormValues] = useState<ProviderConfigInput>(DEFAULT_FORM_VALUES("openai-compatible"));
  const [apiKey, setApiKey] = useState("");
  const [reuseKeyConfigId, setReuseKeyConfigId] = useState<string>("");
  const [apiKeySource, setApiKeySource] = useState<"direct" | "reuse">("direct");

  // Security Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profile, providers] = await Promise.all([api.getProfile(), api.getProviders()]);
      setUsername(profile.user.username);
      setSystemPrompt(profile.user.system_prompt || "");
      setSavedProviders(providers.providers);
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
    if (loading || !focusApiKey || activeTab !== "ai" || !isEditing) return;
    apiKeyInputRef.current?.focus();
  }, [activeTab, focusApiKey, loading, isEditing]);

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

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const handleProviderChangeInForm = (provider: AIProvider) => {
    setFormValues((prev) => {
      const defaults = DEFAULT_FORM_VALUES(provider);
      return {
        ...defaults,
        name: prev.name.startsWith("My ") ? defaults.name : prev.name,
      };
    });
  };

  const startAddConfig = () => {
    resetMessages();
    setEditingId(null);
    setApiKey("");
    setReuseKeyConfigId("");
    setApiKeySource("direct");
    setFormValues(DEFAULT_FORM_VALUES("openai-compatible"));
    setIsEditing(true);
  };

  const startEditConfig = (config: ProviderConfig) => {
    resetMessages();
    setEditingId(config.id);
    setApiKey("");
    setReuseKeyConfigId("");
    setApiKeySource("direct");
    setFormValues({
      name: config.name,
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiVersion: config.apiVersion,
      model: config.model,
      contextWindow: config.contextWindow,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      reasoningEffort: config.reasoningEffort,
      isActive: config.isActive,
    });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    resetMessages();
    setIsEditing(false);
    setEditingId(null);
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

  const saveAiConfig = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    resetMessages();
    try {
      const payload: ProviderConfigInput = {
        ...formValues,
        apiKey: apiKeySource === "direct" && apiKey.trim() ? apiKey.trim() : undefined,
        reuseApiKeyFromConfigId: apiKeySource === "reuse" && reuseKeyConfigId ? reuseKeyConfigId : undefined,
      };

      const result = await api.saveProvider(editingId, payload);

      setApiKey("");
      setReuseKeyConfigId("");
      setIsEditing(false);
      setEditingId(null);

      // Refresh configs
      const updated = await api.getProviders();
      setSavedProviders(updated.providers);

      await clearCredentialResetNotice(false);
      onProviderStatusChange?.(updated.providers.some((p) => p.isActive));
      setSuccess(`Configuration "${result.provider.name}" saved successfully`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to save AI configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async (id: string) => {
    setLoading(true);
    resetMessages();
    try {
      await api.activateProvider(id);
      const updated = await api.getProviders();
      setSavedProviders(updated.providers);
      onProviderStatusChange?.(true);
      setSuccess("Model activated");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to activate model");
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async (id: string) => {
    setLoading(true);
    resetMessages();
    try {
      await api.testProvider(id);
      setSuccess("Provider connection succeeded");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Provider connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete configuration "${name}"? This action cannot be undone.`)) return;
    setLoading(true);
    resetMessages();
    try {
      await api.deleteProvider(id);
      const updated = await api.getProviders();
      setSavedProviders(updated.providers);
      onProviderStatusChange?.(updated.providers.some((p) => p.isActive));
      setSuccess(`Deleted configuration "${name}"`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to delete configuration");
    } finally {
      setLoading(false);
    }
  };

  const removeAllProviders = async () => {
    if (!window.confirm("Delete all stored AI credentials? Settings will need to be configured again.")) return;
    setLoading(true);
    resetMessages();
    try {
      const response = await api.deleteAllProviders();
      setSavedProviders([]);
      await clearCredentialResetNotice(false);
      onProviderStatusChange?.(false);
      setSuccess(`Deleted ${response.deletedCount} stored credentials`);
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
        {/* Header */}
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

        {/* Tabs */}
        <div className="flex shrink-0 overflow-x-auto border-b border-white/10 px-2 sm:px-4">
          {(["profile", "ai", "security"] as const).map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setIsEditing(false);
                resetMessages();
              }}
              className={`-mb-px shrink-0 border-b-2 py-3.5 px-4 text-sm font-medium capitalize transition-all duration-200 cursor-pointer ${
                activeTab === tab ? "border-white text-white" : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {tab === "ai" ? "AI Models & Keys" : tab}
            </button>
          ))}
        </div>

        {/* Content Body */}
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

          {/* Profile Tab */}
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

          {/* AI Providers Tab */}
          {activeTab === "ai" && (
            <div>
              {!isEditing ? (
                /* Saved Configs List View */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white/80">Saved AI Models</h3>
                    <button
                      type="button"
                      onClick={startAddConfig}
                      className="rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-black hover:bg-white/90 transition-colors"
                    >
                      + Add AI Model
                    </button>
                  </div>

                  {savedProviders.length === 0 ? (
                    <div className="rounded-xl border border-white/5 bg-white/2 py-10 text-center text-sm text-white/40">
                      No models configured. Add a model with your API key to start chatting.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-white/2">
                      {savedProviders.map((config) => (
                        <div
                          key={config.id}
                          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between hover:bg-white/5 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white truncate">{config.name}</span>
                              {config.isActive && (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/40">
                              <span>Provider: {PROVIDER_LABELS[config.provider]}</span>
                              <span>•</span>
                              <span>Model: {config.model}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {!config.isActive && (
                              <button
                                type="button"
                                onClick={() => handleActivate(config.id)}
                                disabled={loading}
                                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white hover:text-black transition-colors"
                              >
                                Activate
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleTest(config.id)}
                              disabled={loading}
                              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:text-white transition-colors"
                            >
                              Test
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditConfig(config)}
                              disabled={loading}
                              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:text-white transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(config.id, config.name)}
                              disabled={loading}
                              className="rounded-lg border border-red-500/20 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {savedProviders.length > 0 && (
                    <div className="flex justify-end pt-4">
                      <button
                        type="button"
                        onClick={removeAllProviders}
                        disabled={loading}
                        className="rounded-lg border border-red-500/20 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10 transition-colors"
                      >
                        Delete All Credentials
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Add / Edit Form View */
                <form onSubmit={saveAiConfig} className="space-y-4">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <h3 className="text-sm font-semibold text-white">
                      {editingId ? "Edit AI Model" : "Add New AI Model"}
                    </h3>
                    <button type="button" onClick={cancelEdit} className="text-xs text-white/50 hover:text-white">
                      Back to list
                    </button>
                  </div>

                  <Field label="Configuration Name">
                    <input
                      className="input-field"
                      value={formValues.name}
                      onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
                      placeholder="e.g. Claude 3.5 Sonnet Work, My Custom GPT"
                      required
                      maxLength={100}
                      disabled={loading}
                    />
                  </Field>

                  <Field label="API Protocol Provider">
                    <select
                      className="input-field"
                      value={formValues.provider}
                      onChange={(e) => handleProviderChangeInForm(e.target.value as AIProvider)}
                      disabled={loading || !!editingId}
                    >
                      {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map((p) => (
                        <option key={p} value={p}>
                          {PROVIDER_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {/* API Key Source Selector (only show if not editing, or if editing and we want to change key) */}
                  {!editingId && savedProviders.length > 0 && (
                    <div className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/40">
                        API Key Selection
                      </span>
                      <div className="flex gap-4 p-1 rounded-xl bg-white/5 border border-white/5">
                        <button
                          type="button"
                          onClick={() => setApiKeySource("direct")}
                          className={`flex-1 text-center py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                            apiKeySource === "direct"
                              ? "bg-white text-black font-semibold"
                              : "text-white/60 hover:text-white"
                          }`}
                        >
                          Enter New Key
                        </button>
                        <button
                          type="button"
                          onClick={() => setApiKeySource("reuse")}
                          className={`flex-1 text-center py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                            apiKeySource === "reuse"
                              ? "bg-white text-black font-semibold"
                              : "text-white/60 hover:text-white"
                          }`}
                        >
                          Reuse Key From Model
                        </button>
                      </div>
                    </div>
                  )}

                  {apiKeySource === "direct" ? (
                    <Field label={`API Key ${editingId ? "(Configured)" : ""}`}>
                      <input
                        ref={apiKeyInputRef}
                        type="password"
                        autoComplete="off"
                        className="input-field"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={editingId ? "Leave blank to keep existing key" : "Enter your provider API key"}
                        required={!editingId}
                        disabled={loading}
                      />
                    </Field>
                  ) : (
                    <Field label="Select Model to Reuse API Key From">
                      <select
                        className="input-field"
                        value={reuseKeyConfigId}
                        onChange={(e) => setReuseKeyConfigId(e.target.value)}
                        required
                        disabled={loading}
                      >
                        <option value="">-- Choose saved model --</option>
                        {savedProviders.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({PROVIDER_LABELS[p.provider]})
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}

                  <Field
                    label={
                      formValues.provider === "openai-compatible" ? "Base URL" : "Custom Native Base URL (Optional)"
                    }
                  >
                    <input
                      type="url"
                      className="input-field"
                      value={formValues.baseUrl || ""}
                      onChange={(event) => setFormValues({ ...formValues, baseUrl: event.target.value || null })}
                      placeholder={
                        formValues.provider === "openai-compatible"
                          ? "https://api.openai.com/v1"
                          : formValues.provider === "anthropic"
                            ? "Official Anthropic API when blank"
                            : "Official Gemini API when blank"
                      }
                      required={formValues.provider === "openai-compatible"}
                      disabled={loading}
                    />
                  </Field>

                  {formValues.provider === "gemini" && (
                    <Field label="Gemini API version">
                      <input
                        className="input-field"
                        value={formValues.apiVersion || ""}
                        onChange={(event) => setFormValues({ ...formValues, apiVersion: event.target.value || null })}
                        placeholder="v1beta"
                        pattern="[a-zA-Z0-9._\-]{1,32}"
                        maxLength={32}
                        disabled={loading}
                      />
                    </Field>
                  )}

                  <Field label="Model ID / Name">
                    <input
                      className="input-field"
                      value={formValues.model}
                      onChange={(event) => setFormValues({ ...formValues, model: event.target.value })}
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
                        value={formValues.contextWindow}
                        onChange={(event) =>
                          setFormValues({ ...formValues, contextWindow: Number(event.target.value) })
                        }
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
                        value={formValues.maxOutputTokens}
                        onChange={(event) =>
                          setFormValues({ ...formValues, maxOutputTokens: Number(event.target.value) })
                        }
                        required
                        disabled={loading}
                      />
                    </Field>
                  </div>

                  {formValues.provider !== "anthropic" && (
                    <Field label={`Temperature (${formValues.temperature.toFixed(1)})`}>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={formValues.temperature}
                        onChange={(event) => setFormValues({ ...formValues, temperature: Number(event.target.value) })}
                        className="w-full accent-white"
                        disabled={loading}
                      />
                    </Field>
                  )}

                  <Field label="Reasoning effort">
                    <select
                      className="input-field"
                      value={formValues.reasoningEffort}
                      onChange={(event) =>
                        setFormValues({ ...formValues, reasoningEffort: event.target.value as ReasoningEffort })
                      }
                      disabled={loading}
                    >
                      <option value="off">Off</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </Field>

                  <div className="flex items-center gap-2 py-2">
                    <input
                      type="checkbox"
                      id="is-active-check"
                      checked={formValues.isActive}
                      onChange={(e) => setFormValues({ ...formValues, isActive: e.target.checked })}
                      className="h-4 w-4 rounded border-white/10 bg-white/5 text-white accent-white"
                      disabled={loading}
                    />
                    <label htmlFor="is-active-check" className="text-xs text-white/80 cursor-pointer">
                      Set as active model immediately
                    </label>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={loading}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/75 hover:bg-white/5 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-gray-200 disabled:opacity-50"
                    >
                      Save Configuration
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Security Tab */}
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
