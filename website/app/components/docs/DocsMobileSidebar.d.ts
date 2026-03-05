interface DocsMobileSidebarProps {
    /** "slide" = slide-in panel from left, "fullscreen" = centered fullscreen modal */
    mode?: "slide" | "fullscreen";
    /** Hide the label text (icon only) */
    iconOnly?: boolean;
}
export declare function DocsMobileSidebar({ mode, iconOnly }: DocsMobileSidebarProps): import("react").JSX.Element;
export {};
