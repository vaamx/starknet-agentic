/**
 * Services index - exports singleton instances.
 */
import { TokenService } from "./TokenService.js";
import { log } from "../logger.js";
let tokenServiceInstance = null;
let initializedBaseUrl;
/**
 * Get the singleton TokenService instance.
 * @param baseUrl - Optional avnu API base URL (only used on first call)
 */
export function getTokenService(baseUrl) {
    if (!tokenServiceInstance) {
        tokenServiceInstance = new TokenService(baseUrl);
        initializedBaseUrl = baseUrl;
    }
    else if (baseUrl !== undefined && baseUrl !== initializedBaseUrl) {
        log({
            level: "warn",
            event: "token_service.duplicate_init",
            details: { existingBaseUrl: initializedBaseUrl, ignoredBaseUrl: baseUrl },
        });
    }
    return tokenServiceInstance;
}
/**
 * Configure the RPC provider for TokenService on-chain fallback.
 * Call this at startup after creating the RpcProvider.
 */
export function configureTokenServiceProvider(provider) {
    getTokenService().setProvider(provider);
}
/**
 * Reset the TokenService singleton (useful for testing).
 */
export function resetTokenService() {
    tokenServiceInstance = null;
    initializedBaseUrl = undefined;
}
export { TokenService, STATIC_TOKENS, TOKENS } from "./TokenService.js";
