"use client";
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NavbarMobile = NavbarMobile;
const react_1 = require("react");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("@/data/navigation");
function MobileNavLink({ href, label, onClick, }) {
    const isInternal = href.startsWith("/");
    if (isInternal) {
        return (<link_1.default href={href} onClick={onClick} className="font-heading font-medium py-2">
        {label}
      </link_1.default>);
    }
    return (<a href={href} onClick={onClick} className="font-heading font-medium py-2">
      {label}
    </a>);
}
function NavbarMobile() {
    const [mobileOpen, setMobileOpen] = (0, react_1.useState)(false);
    return (<>
      <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden neo-btn-secondary py-2 px-3" aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen} aria-controls="mobile-nav">
        <span className="text-lg" aria-hidden="true">
          {mobileOpen ? "✕" : "☰"}
        </span>
      </button>

      {mobileOpen && (<div id="mobile-nav" className="absolute top-full left-0 right-0 md:hidden border-t-2 border-black bg-cream px-6 py-4 flex flex-col gap-3">
          {navigation_1.NAV_LINKS.map((link) => (<MobileNavLink key={link.href} href={link.href} label={link.label} onClick={() => setMobileOpen(false)}/>))}
          <a href="#get-started" onClick={() => setMobileOpen(false)} className="neo-btn-primary text-sm py-2 px-4 text-center">
            Get Started
          </a>
        </div>)}
    </>);
}
