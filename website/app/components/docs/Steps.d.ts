import type { ReactNode } from "react";
interface StepProps {
    number: number;
    title: string;
    children: ReactNode;
}
export declare function Step({ number, title, children }: StepProps): import("react").JSX.Element;
interface StepsProps {
    children: ReactNode;
}
export declare function Steps({ children }: StepsProps): import("react").JSX.Element;
export {};
