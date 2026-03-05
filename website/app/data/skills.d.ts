import type { Skill } from "./types";
export declare const SKILLS: Skill[];
export declare function getAllKeywords(): string[];
export declare function filterSkills(query: string): Skill[];
export declare function getSkillBySlug(slug: string): Skill | undefined;
