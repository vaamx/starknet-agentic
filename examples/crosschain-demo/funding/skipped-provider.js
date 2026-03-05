export const skippedFundingProvider = {
    name: "skipped",
    async preflight(_config) {
        // No external dependencies in PR1.
    },
    async fund(_params) {
        return {
            provider: "skipped",
            status: "skipped",
            source_chain: "none",
            confirmed_at: new Date().toISOString(),
            skipped_reason: "already_funded",
        };
    },
};
