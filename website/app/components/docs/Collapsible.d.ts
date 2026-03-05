import { type ReactNode } from "react";
interface CollapsibleProps {
    title: string;
    children: ReactNode;
    defaultOpen?: boolean;
}
export declare function Collapsible({ title, children, defaultOpen }: CollapsibleProps): import("react").JSX.Element;
interface FAQItemProps {
    question: string;
    children: ReactNode;
}
export declare function FAQItem({ question, children }: FAQItemProps): import("react").JSX.Element;
export {};
