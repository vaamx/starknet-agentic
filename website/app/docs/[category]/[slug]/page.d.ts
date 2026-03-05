import type { Metadata } from "next";
interface DocPageProps {
    params: Promise<{
        category: string;
        slug: string;
    }>;
}
export declare function generateMetadata({ params }: DocPageProps): Promise<Metadata>;
export default function DocPage({ params }: DocPageProps): Promise<import("react").JSX.Element>;
export {};
