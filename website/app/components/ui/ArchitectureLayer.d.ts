import type { ArchitectureLayer as ArchitectureLayerType } from "@/data/types";
interface ArchitectureLayerProps {
    layer: ArchitectureLayerType;
    showConnector?: boolean;
}
export declare function ArchitectureLayer({ layer, showConnector, }: ArchitectureLayerProps): import("react").JSX.Element;
export {};
