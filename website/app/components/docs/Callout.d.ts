import type { ReactNode } from "react";
type CalloutType = "info" | "warning" | "success" | "error" | "tip";
interface CalloutProps {
    type?: CalloutType;
    title?: string;
    children: ReactNode;
}
export declare function Callout({ type, title, children }: CalloutProps): import("react").JSX.Element;
export {};
