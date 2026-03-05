import type { DocPage } from "@/data/types";
interface DocsPaginationProps {
    prev: (DocPage & {
        categorySlug: string;
    }) | null;
    next: (DocPage & {
        categorySlug: string;
    }) | null;
}
export declare function DocsPagination({ prev, next }: DocsPaginationProps): import("react").JSX.Element | null;
export {};
