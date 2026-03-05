import type { DocCategory, DocPage } from "./types";
export declare const DOC_CATEGORIES: DocCategory[];
export declare function getAllDocPages(): (DocPage & {
    category: string;
    categorySlug: string;
})[];
export declare function findDocPage(categorySlug: string, pageSlug: string): {
    page: DocPage;
    category: DocCategory;
} | null;
export declare function getAdjacentPages(categorySlug: string, pageSlug: string): {
    prev: (DocPage & {
        categorySlug: string;
    }) | null;
    next: (DocPage & {
        categorySlug: string;
    }) | null;
};
