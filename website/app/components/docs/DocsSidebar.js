"use client";
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocsSidebar = DocsSidebar;
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const docs_1 = require("@/data/docs");
const react_1 = require("react");
function DocsSidebar({ onNavigate }) {
    const pathname = (0, navigation_1.usePathname)();
    const [expandedCategories, setExpandedCategories] = (0, react_1.useState)(() => {
        // Start with all categories expanded
        return new Set(docs_1.DOC_CATEGORIES.map((c) => c.slug));
    });
    const toggleCategory = (slug) => {
        setExpandedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(slug)) {
                next.delete(slug);
            }
            else {
                next.add(slug);
            }
            return next;
        });
    };
    const isActive = (categorySlug, pageSlug) => {
        return pathname === `/docs/${categorySlug}/${pageSlug}`;
    };
    const isCategoryActive = (categorySlug) => {
        return pathname.startsWith(`/docs/${categorySlug}`);
    };
    return (<nav className="space-y-6" aria-label="Documentation navigation">
      {docs_1.DOC_CATEGORIES.map((category) => (<div key={category.slug}>
          <button onClick={() => toggleCategory(category.slug)} className={`flex items-center justify-between w-full text-left font-heading font-semibold text-sm uppercase tracking-wider mb-2 px-2 py-1 rounded transition-colors ${isCategoryActive(category.slug)
                ? "text-neo-purple"
                : "text-neo-dark/60 hover:text-neo-dark"}`} aria-expanded={expandedCategories.has(category.slug)}>
            <span>{category.title}</span>
            <svg className={`w-4 h-4 transition-transform ${expandedCategories.has(category.slug) ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          {expandedCategories.has(category.slug) && (<ul className="space-y-1 pl-2 border-l-2 border-neo-dark/10">
              {category.pages.map((page) => {
                    const active = isActive(category.slug, page.slug);
                    return (<li key={page.slug}>
                    <link_1.default href={`/docs/${category.slug}/${page.slug}`} onClick={onNavigate} className={`block py-1.5 px-3 text-sm rounded-r transition-colors ${active
                            ? "bg-neo-yellow/30 text-neo-dark font-medium border-l-2 border-neo-yellow -ml-[2px]"
                            : "text-neo-dark/70 hover:text-neo-dark hover:bg-neo-dark/5"}`} aria-current={active ? "page" : undefined}>
                      {page.title}
                    </link_1.default>
                  </li>);
                })}
            </ul>)}
        </div>))}
    </nav>);
}
