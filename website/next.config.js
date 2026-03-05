"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mdx_1 = __importDefault(require("@next/mdx"));
const nextConfig = {
    output: "standalone",
    pageExtensions: ["ts", "tsx", "md", "mdx"],
};
const withMDX = (0, mdx_1.default)({});
exports.default = withMDX(nextConfig);
