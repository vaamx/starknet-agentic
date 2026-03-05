"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DocNotFound;
const link_1 = __importDefault(require("next/link"));
function DocNotFound() {
    return (<div className="px-6 md:px-8 lg:px-12 py-12 md:py-16">
      <div className="max-w-2xl mx-auto text-center">
        <div className="w-16 h-16 bg-neo-pink/20 border-2 border-black shadow-neo mx-auto mb-6 flex items-center justify-center">
          <span className="text-3xl font-heading font-bold">?</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-neo-dark mb-4">
          Page Not Found
        </h1>
        <p className="text-lg text-neo-dark/70 mb-8">
          The documentation page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <link_1.default href="/docs" className="neo-btn-primary">
            Back to Docs
          </link_1.default>
          <link_1.default href="/" className="neo-btn-secondary">
            Go Home
          </link_1.default>
        </div>
      </div>
    </div>);
}
