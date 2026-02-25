const IPV4_PRIVATE_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local
  /^0\./, // current network
];

function isPrivate172(host: string): boolean {
  const match = host.match(/^172\.(\d+)\./);
  if (!match) return false;
  const octet = Number(match[1]);
  return octet >= 16 && octet <= 31;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "::1" || // loopback
    normalized === "::" ||
    normalized.startsWith("fc") || // unique local
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") // link local
  );
}

function isLocalHostname(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  );
}

function isPrivateHost(host: string): boolean {
  if (isLocalHostname(host)) return true;
  if (IPV4_PRIVATE_PATTERNS.some((r) => r.test(host))) return true;
  if (isPrivate172(host)) return true;
  if (isPrivateIpv6(host)) return true;
  return false;
}

export function validatePeerUrl(
  rawUrl: string,
  allowPrivatePeers: boolean
): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  if (!allowPrivatePeers) {
    if (url.protocol !== "https:") {
      return { ok: false, error: "Only https peer URLs are allowed in production mode" };
    }

    if (isPrivateHost(url.hostname)) {
      return { ok: false, error: `Private/loopback host blocked: ${url.hostname}` };
    }
  } else if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, error: "Only http/https URLs are supported" };
  }

  return { ok: true, url };
}
