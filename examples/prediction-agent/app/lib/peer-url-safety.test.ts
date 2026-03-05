import { describe, expect, it } from "vitest";
import { validatePeerUrl } from "./peer-url-safety";

describe("peer-url-safety", () => {
  it("accepts public https URL in production mode", () => {
    const result = validatePeerUrl("https://agent.example/.well-known/agent-card.json", false);
    expect(result.ok).toBe(true);
  });

  it("rejects non-https URL in production mode", () => {
    const result = validatePeerUrl("http://agent.example/agent.json", false);
    expect(result.ok).toBe(false);
  });

  it("rejects localhost/private addresses in production mode", () => {
    expect(validatePeerUrl("https://localhost:3000/agent.json", false).ok).toBe(false);
    expect(validatePeerUrl("https://127.0.0.1/agent.json", false).ok).toBe(false);
    expect(validatePeerUrl("https://10.0.0.7/agent.json", false).ok).toBe(false);
    expect(validatePeerUrl("https://172.20.1.9/agent.json", false).ok).toBe(false);
    expect(validatePeerUrl("https://192.168.1.20/agent.json", false).ok).toBe(false);
  });

  it("allows http localhost in explicit private-peer mode", () => {
    const result = validatePeerUrl("http://localhost:3000/agent.json", true);
    expect(result.ok).toBe(true);
  });
});
