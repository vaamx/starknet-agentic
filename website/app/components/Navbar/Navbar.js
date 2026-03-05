"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Navbar = Navbar;
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("@/data/navigation");
const NavbarMobile_1 = require("./NavbarMobile");
function NavLink({ href, label }) {
    const isInternal = href.startsWith("/");
    if (isInternal) {
        return (<link_1.default href={href} className="font-heading font-medium hover:text-neo-purple transition-colors">
        {label}
      </link_1.default>);
    }
    return (<a href={href} className="font-heading font-medium hover:text-neo-purple transition-colors">
      {label}
    </a>);
}
function Navbar() {
    return (<nav className="fixed top-0 left-0 right-0 z-50 bg-cream/90 backdrop-blur-sm border-b-2 border-black">
      <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between relative">
        <link_1.default href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 bg-neo-yellow border-2 border-black shadow-neo-sm flex items-center justify-center font-heading font-black text-sm group-hover:rotate-12 transition-transform">
            S
          </div>
          <span className="font-heading font-bold text-lg hidden sm:block">
            Starknet Agentic
          </span>
        </link_1.default>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          {navigation_1.NAV_LINKS.map((link) => (<NavLink key={link.href} href={link.href} label={link.label}/>))}
          <a href="#get-started" className="neo-btn-primary text-sm py-2 px-4">
            Get Started
          </a>
        </div>

        {/* Mobile toggle - client component */}
        <NavbarMobile_1.NavbarMobile />
      </div>
    </nav>);
}
