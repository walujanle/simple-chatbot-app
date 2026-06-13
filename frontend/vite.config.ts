import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function staticHostHeaders(apiBaseUrl: string, scriptOrigins: string[], connectOrigins: string[]): Plugin {
  const scriptSources = new Set(["'self'", "'unsafe-inline'", ...scriptOrigins]);
  const connectSources = new Set(["'self'", ...connectOrigins]);
  if (apiBaseUrl) connectSources.add(new URL(apiBaseUrl).origin);

  return {
    name: "static-host-security-headers",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src ${[...scriptSources].join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ${[...connectSources].join(" ")}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
      });
    },
  };
}

function resolveOriginList(value: string | undefined, variableName: string, mode: string): string[] {
  const origins = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!origins?.length) return [];

  return [
    ...new Set(
      origins.map((origin) => {
        let url: URL;
        try {
          url = new URL(origin);
        } catch {
          throw new Error(`${variableName} must contain comma-separated absolute HTTP or HTTPS origins`);
        }
        if (
          (url.protocol !== "http:" && url.protocol !== "https:") ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== "/"
        ) {
          throw new Error(`${variableName} entries must be HTTP or HTTPS origins without paths or credentials`);
        }
        if (mode === "production" && url.protocol !== "https:" && !loopbackHosts.has(url.hostname)) {
          throw new Error(`Production ${variableName} entries must use HTTPS`);
        }
        return url.origin;
      }),
    ),
  ];
}

function resolveApiBaseUrl(value: string | undefined, mode: string): string {
  const configured = value?.trim().replace(/\/+$/, "") || "";
  if (!configured) return "";

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("VITE_API_BASE_URL must be an absolute HTTP or HTTPS origin");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VITE_API_BASE_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(
      "VITE_API_BASE_URL must contain only the backend origin, without credentials, path, query, or hash",
    );
  }
  if (mode === "production" && url.protocol !== "https:" && !loopbackHosts.has(url.hostname)) {
    throw new Error("Production VITE_API_BASE_URL must use HTTPS");
  }
  return url.origin;
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "VITE_");
  const apiBaseUrl = resolveApiBaseUrl(environment.VITE_API_BASE_URL, mode);
  const scriptOrigins = resolveOriginList(environment.VITE_CSP_SCRIPT_ORIGINS, "VITE_CSP_SCRIPT_ORIGINS", mode);
  const connectOrigins = resolveOriginList(environment.VITE_CSP_CONNECT_ORIGINS, "VITE_CSP_CONNECT_ORIGINS", mode);

  return {
    plugins: [react(), tailwindcss(), staticHostHeaders(apiBaseUrl, scriptOrigins, connectOrigins)],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("react-markdown") || id.includes("remark-gfm")) return "markdown";
            if (id.includes("react-dom") || id.includes("react-router") || /node_modules[/\\]react[/\\]/.test(id)) {
              return "vendor";
            }
          },
        },
      },
    },
  };
});
