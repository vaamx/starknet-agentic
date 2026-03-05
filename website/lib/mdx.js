"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocBySlug = getDocBySlug;
exports.getDocsByCategory = getDocsByCategory;
exports.docExists = docExists;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const gray_matter_1 = __importDefault(require("gray-matter"));
const contentDirectory = path_1.default.join(process.cwd(), "content/docs");
/**
 * Get a specific document by category and slug
 */
function getDocBySlug(category, slug) {
    const fullPath = path_1.default.join(contentDirectory, category, `${slug}.mdx`);
    if (!fs_1.default.existsSync(fullPath)) {
        return null;
    }
    const fileContents = fs_1.default.readFileSync(fullPath, "utf8");
    const { data, content } = (0, gray_matter_1.default)(fileContents);
    return {
        frontmatter: data,
        content,
        slug,
    };
}
/**
 * Get all documents in a category
 */
function getDocsByCategory(category) {
    const categoryPath = path_1.default.join(contentDirectory, category);
    if (!fs_1.default.existsSync(categoryPath)) {
        return [];
    }
    const files = fs_1.default.readdirSync(categoryPath).filter((f) => f.endsWith(".mdx"));
    return files.map((filename) => {
        const slug = filename.replace(/\.mdx$/, "");
        const doc = getDocBySlug(category, slug);
        return doc;
    });
}
/**
 * Check if a doc exists
 */
function docExists(category, slug) {
    const fullPath = path_1.default.join(contentDirectory, category, `${slug}.mdx`);
    return fs_1.default.existsSync(fullPath);
}
