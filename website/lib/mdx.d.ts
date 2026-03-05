export interface DocFrontmatter {
    title: string;
    description?: string;
    order?: number;
}
export interface DocContent {
    frontmatter: DocFrontmatter;
    content: string;
    slug: string;
}
/**
 * Get a specific document by category and slug
 */
export declare function getDocBySlug(category: string, slug: string): DocContent | null;
/**
 * Get all documents in a category
 */
export declare function getDocsByCategory(category: string): DocContent[];
/**
 * Check if a doc exists
 */
export declare function docExists(category: string, slug: string): boolean;
