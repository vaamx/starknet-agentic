"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useCopyToClipboard = useCopyToClipboard;
const react_1 = require("react");
function useCopyToClipboard(resetDelay = 2000) {
    const [copied, setCopied] = (0, react_1.useState)(false);
    const copy = (0, react_1.useCallback)(async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), resetDelay);
        }
        catch (err) {
            console.error("Failed to copy to clipboard:", err);
        }
    }, [resetDelay]);
    return { copied, copy };
}
