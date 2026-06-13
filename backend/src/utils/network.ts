import dns from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import { config } from "@/config.js";

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function isAllowedAddress(address: string, allowPrivate: boolean): boolean {
  try {
    const range = ipaddr.process(address).range();
    if (range === "unicast") return true;
    return allowPrivate && ["private", "loopback", "carrierGradeNat", "uniqueLocal"].includes(range);
  } catch {
    return false;
  }
}

function blockedAddressError(): NodeJS.ErrnoException {
  const error = new Error("Private or reserved network endpoints are disabled") as NodeJS.ErrnoException;
  error.code = "EACCES";
  return error;
}

function createLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(
      hostname,
      { all: true, family: options.family, hints: options.hints, verbatim: true },
      (error, addresses) => {
        if (error) {
          callback(error, "");
          return;
        }
        if (addresses.length === 0 || addresses.some((entry) => !isAllowedAddress(entry.address, allowPrivate))) {
          callback(blockedAddressError(), "");
          return;
        }
        if (options.all) {
          callback(null, addresses);
          return;
        }
        const selected = addresses[0];
        callback(null, selected.address, selected.family);
      },
    );
  };
}

function createDispatcher(allowPrivate: boolean): Agent {
  return new Agent({
    connect: { lookup: createLookup(allowPrivate) },
    connections: 16,
    pipelining: 1,
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 30_000,
  });
}

const publicDispatcher = createDispatcher(false);
const providerDispatcher = config.ALLOW_PRIVATE_AI_ENDPOINTS ? createDispatcher(true) : publicDispatcher;

export async function closeNetworkDispatchers(): Promise<void> {
  await Promise.all([...new Set([publicDispatcher, providerDispatcher])].map((dispatcher) => dispatcher.close()));
}

async function resolveAndValidate(hostname: string, allowPrivate: boolean): Promise<void> {
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isAllowedAddress(entry.address, allowPrivate))) {
    throw blockedAddressError();
  }
}

export async function validateExternalUrl(
  value: string,
  allowPath = true,
  allowInsecure = false,
  allowPrivate = config.ALLOW_PRIVATE_AI_ENDPOINTS,
): Promise<URL> {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(allowInsecure && url.protocol === "http:") &&
    !(config.NODE_ENV !== "production" && url.protocol === "http:")
  ) {
    throw new Error("Only HTTPS endpoints are allowed");
  }
  if (url.username || url.password) {
    throw new Error("Endpoint URLs cannot contain credentials");
  }
  if (!allowPath && url.pathname !== "/") {
    throw new Error("Endpoint URL cannot contain a path");
  }
  await resolveAndValidate(url.hostname, allowPrivate);
  return url;
}

async function secureFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  allowInsecure: boolean,
  redirect: RequestRedirect,
  allowPrivate: boolean,
): Promise<Response> {
  const target = input instanceof Request ? input.url : input.toString();
  await validateExternalUrl(target, true, allowInsecure, allowPrivate);
  const response = await undiciFetch(
    input as unknown as Parameters<typeof undiciFetch>[0],
    {
      ...init,
      redirect,
      dispatcher: allowPrivate ? providerDispatcher : publicDispatcher,
    } as Parameters<typeof undiciFetch>[1],
  );
  return response as unknown as Response;
}

export function secureExternalFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return secureFetch(input, init, false, "error", config.ALLOW_PRIVATE_AI_ENDPOINTS);
}

export function secureWebFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return secureFetch(input, init, true, "manual", false);
}
