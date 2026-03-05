import type { HedgeRecipe } from "./types.js";
export declare function pickHedgeRecipe(params: {
    isStarknetNative: boolean;
    canAssessLiquidity: boolean;
    isIntermittent: boolean;
}): HedgeRecipe;
export declare function hedgeRecipeToString(recipe: HedgeRecipe): string;
