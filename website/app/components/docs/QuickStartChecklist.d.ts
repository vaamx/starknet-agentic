interface ChecklistItem {
    id: string;
    label: string;
    description?: string;
}
interface QuickStartChecklistProps {
    items: ChecklistItem[];
    storageKey?: string;
}
export declare function QuickStartChecklist({ items, storageKey, }: QuickStartChecklistProps): import("react").JSX.Element;
export {};
