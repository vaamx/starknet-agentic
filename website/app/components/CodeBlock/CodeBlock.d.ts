interface CodeBlockProps {
    code: string;
    language?: string;
    filename?: string;
    showLineNumbers?: boolean;
    showCopyButton?: boolean;
}
export declare function CodeBlock({ code, language, filename, showLineNumbers, showCopyButton, }: CodeBlockProps): Promise<import("react").JSX.Element>;
export {};
