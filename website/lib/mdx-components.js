"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mdxComponents = void 0;
exports.useMDXComponents = useMDXComponents;
const link_1 = __importDefault(require("next/link"));
const CodeBlock_1 = require("@/components/CodeBlock");
const docs_1 = require("@/components/docs");
const skills_1 = require("@/components/skills");
// Custom heading component with auto-generated IDs for TOC
function createHeading(level) {
    const Tag = `h${level}`;
    return function Heading({ children }) {
        const text = typeof children === "string" ? children : "";
        const id = text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");
        return (<Tag id={id} className="scroll-mt-20">
        {children}
      </Tag>);
    };
}
// Custom link component
function CustomLink({ href, children, ...props }) {
    if (!href)
        return <span {...props}>{children}</span>;
    // External links
    if (href.startsWith("http")) {
        return (<a href={href} target="_blank" rel="noopener noreferrer" className="text-neo-purple hover:text-neo-purple/80 underline underline-offset-2" {...props}>
        {children}
      </a>);
    }
    // Internal links
    return (<link_1.default href={href} className="text-neo-purple hover:text-neo-purple/80 underline underline-offset-2" {...props}>
      {children}
    </link_1.default>);
}
// Custom code block component for fenced code blocks
async function CustomCode({ children, className, ...props }) {
    const code = typeof children === "string" ? children : "";
    // Check if this is a code block (has language class)
    const match = /language-(\w+)/.exec(className || "");
    if (match) {
        const language = match[1];
        return <CodeBlock_1.CodeBlock code={code} language={language}/>;
    }
    // If no language but has newlines, it's a code block (like ASCII diagrams)
    if (code.includes("\n")) {
        return <CodeBlock_1.CodeBlock code={code} language="text"/>;
    }
    // Inline code
    return (<code className="px-1.5 py-0.5 bg-neo-dark/10 rounded text-sm font-mono text-neo-dark" {...props}>
      {children}
    </code>);
}
// Custom pre element (wrapper for code blocks)
function CustomPre({ children }) {
    // Just pass through - the code element handles everything
    return <>{children}</>;
}
// Custom table components with neo-brutalist styling
function CustomTable({ children }) {
    return (<div className="my-6 overflow-x-auto">
      <table className="w-full border-2 border-black shadow-neo bg-white">
        {children}
      </table>
    </div>);
}
function CustomThead({ children }) {
    return <thead className="bg-neo-yellow/30">{children}</thead>;
}
function CustomTbody({ children }) {
    return <tbody className="divide-y divide-neo-dark/10">{children}</tbody>;
}
function CustomTr({ children }) {
    return <tr className="hover:bg-neo-dark/5 transition-colors">{children}</tr>;
}
function CustomTh({ children }) {
    return (<th className="px-4 py-3 text-left font-heading font-bold text-neo-dark border-b-2 border-black">
      {children}
    </th>);
}
function CustomTd({ children }) {
    return (<td className="px-4 py-3 text-neo-dark/80">{children}</td>);
}
// Custom blockquote
function CustomBlockquote({ children }) {
    return (<blockquote className="my-4 pl-4 border-l-4 border-neo-purple/50 text-neo-dark/70 italic">
      {children}
    </blockquote>);
}
// Custom horizontal rule
function CustomHr() {
    return <hr className="my-8 border-t-2 border-neo-dark/10"/>;
}
// Custom list components
function CustomUl({ children }) {
    return <ul className="my-4 pl-6 list-disc space-y-2">{children}</ul>;
}
function CustomOl({ children }) {
    return <ol className="my-4 pl-6 list-decimal space-y-2">{children}</ol>;
}
function CustomLi({ children }) {
    return <li className="text-neo-dark/80">{children}</li>;
}
exports.mdxComponents = {
    // Headings
    h1: createHeading(1),
    h2: createHeading(2),
    h3: createHeading(3),
    h4: createHeading(4),
    h5: createHeading(5),
    h6: createHeading(6),
    // Links
    a: CustomLink,
    // Code
    code: CustomCode,
    pre: CustomPre,
    // Tables
    table: CustomTable,
    thead: CustomThead,
    tbody: CustomTbody,
    tr: CustomTr,
    th: CustomTh,
    td: CustomTd,
    // Other elements
    blockquote: CustomBlockquote,
    hr: CustomHr,
    ul: CustomUl,
    ol: CustomOl,
    li: CustomLi,
    // Custom components
    QuickStartChecklist: docs_1.QuickStartChecklist,
    Callout: docs_1.Callout,
    Collapsible: docs_1.Collapsible,
    FAQItem: docs_1.FAQItem,
    Steps: docs_1.Steps,
    Step: docs_1.Step,
    CodeBlock: CodeBlock_1.CodeBlock,
    SkillsGrid: skills_1.SkillsGrid,
    SkillCard: skills_1.SkillCard,
};
function useMDXComponents(components) {
    return {
        ...exports.mdxComponents,
        ...components,
    };
}
