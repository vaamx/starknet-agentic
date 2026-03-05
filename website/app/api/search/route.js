"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const gray_matter_1 = __importDefault(require("gray-matter"));
const docs_1 = require("@/data/docs");
const contentDirectory = path_1.default.join(process.cwd(), "content/docs");
// Strip MDX/markdown syntax for cleaner snippets
function stripMarkdown(text) {
    return text
        // Remove code blocks
        .replace(/```[\s\S]*?```/g, " ")
        // Remove inline code
        .replace(/`[^`]+`/g, " ")
        // Remove links but keep text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        // Remove images
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, " ")
        // Remove headers
        .replace(/^#{1,6}\s+/gm, "")
        // Remove bold/italic
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        // Remove HTML tags
        .replace(/<[^>]+>/g, " ")
        // Remove JSX components
        .replace(/<[A-Z][^>]*>[\s\S]*?<\/[A-Z][^>]*>/g, " ")
        .replace(/<[A-Z][^>]*\/>/g, " ")
        // Collapse whitespace
        .replace(/\s+/g, " ")
        .trim();
}
// Extract a snippet around the match
function extractSnippet(content, query, snippetLength = 150) {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerContent.indexOf(lowerQuery);
    if (matchIndex === -1) {
        return null;
    }
    // Calculate snippet bounds
    const halfLength = Math.floor((snippetLength - query.length) / 2);
    let start = Math.max(0, matchIndex - halfLength);
    let end = Math.min(content.length, matchIndex + query.length + halfLength);
    // Adjust to word boundaries
    if (start > 0) {
        const spaceIndex = content.indexOf(" ", start);
        if (spaceIndex !== -1 && spaceIndex < matchIndex) {
            start = spaceIndex + 1;
        }
    }
    if (end < content.length) {
        const spaceIndex = content.lastIndexOf(" ", end);
        if (spaceIndex !== -1 && spaceIndex > matchIndex + query.length) {
            end = spaceIndex;
        }
    }
    const snippet = content.slice(start, end);
    const adjustedMatchStart = matchIndex - start;
    const adjustedMatchEnd = adjustedMatchStart + query.length;
    return {
        snippet: (start > 0 ? "..." : "") + snippet + (end < content.length ? "..." : ""),
        matchStart: adjustedMatchStart + (start > 0 ? 3 : 0), // Account for "..."
        matchEnd: adjustedMatchEnd + (start > 0 ? 3 : 0),
    };
}
async function GET(request) {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");
    if (!query || query.trim().length < 2) {
        return server_1.NextResponse.json({ results: [] });
    }
    const lowerQuery = query.toLowerCase().trim();
    const results = [];
    for (const category of docs_1.DOC_CATEGORIES) {
        for (const page of category.pages) {
            const filePath = path_1.default.join(contentDirectory, category.slug, `${page.slug}.mdx`);
            // Check title and description first
            const titleMatch = page.title.toLowerCase().includes(lowerQuery);
            const descMatch = page.description?.toLowerCase().includes(lowerQuery);
            let snippet;
            let matchStart;
            let matchEnd;
            let contentMatch = false;
            // Try to read and search the MDX content
            if (fs_1.default.existsSync(filePath)) {
                try {
                    const fileContents = fs_1.default.readFileSync(filePath, "utf8");
                    const { content } = (0, gray_matter_1.default)(fileContents);
                    const cleanContent = stripMarkdown(content);
                    if (cleanContent.toLowerCase().includes(lowerQuery)) {
                        contentMatch = true;
                        const snippetData = extractSnippet(cleanContent, query);
                        if (snippetData) {
                            snippet = snippetData.snippet;
                            matchStart = snippetData.matchStart;
                            matchEnd = snippetData.matchEnd;
                        }
                    }
                }
                catch {
                    // File read error, continue without content search
                }
            }
            if (titleMatch || descMatch || contentMatch) {
                results.push({
                    slug: `${category.slug}/${page.slug}`,
                    title: page.title,
                    category: category.title,
                    description: page.description,
                    snippet,
                    matchStart,
                    matchEnd,
                });
            }
            // Limit results
            if (results.length >= 8) {
                return server_1.NextResponse.json({ results });
            }
        }
    }
    return server_1.NextResponse.json({ results });
}
