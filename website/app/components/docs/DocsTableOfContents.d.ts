import type { TableOfContentsItem } from "@/data/types";
interface DocsTableOfContentsProps {
    items: TableOfContentsItem[];
}
export declare function DocsTableOfContents({ items }: DocsTableOfContentsProps): import("react").JSX.Element | null;
export declare function extractHeadings(content: string): TableOfContentsItem[];
export declare function extractHeadingsFromDOM(): TableOfContentsItem[];
export {};
