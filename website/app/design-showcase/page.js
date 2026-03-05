"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DesignShowcase;
const NeoBrutalist_1 = __importDefault(require("./previews/NeoBrutalist"));
const MinimalDark_1 = __importDefault(require("./previews/MinimalDark"));
const Glassmorphism_1 = __importDefault(require("./previews/Glassmorphism"));
const CyberpunkNeon_1 = __importDefault(require("./previews/CyberpunkNeon"));
const OrganicFlow_1 = __importDefault(require("./previews/OrganicFlow"));
const BentoGrid_1 = __importDefault(require("./previews/BentoGrid"));
const TerminalHacker_1 = __importDefault(require("./previews/TerminalHacker"));
const GradientMesh_1 = __importDefault(require("./previews/GradientMesh"));
const Neumorphism_1 = __importDefault(require("./previews/Neumorphism"));
const SwissDesign_1 = __importDefault(require("./previews/SwissDesign"));
const MemphisDesign_1 = __importDefault(require("./previews/MemphisDesign"));
const RetroFuturism_1 = __importDefault(require("./previews/RetroFuturism"));
const Claymorphism_1 = __importDefault(require("./previews/Claymorphism"));
const CyberpunkNetStyle_1 = __importDefault(require("./previews/CyberpunkNetStyle"));
const OpenClawStyle_1 = __importDefault(require("./previews/OpenClawStyle"));
const StarknetOfficialStyle_1 = __importDefault(require("./previews/StarknetOfficialStyle"));
const GitHubStyle_1 = __importDefault(require("./previews/GitHubStyle"));
const AITechCyberpunk_1 = __importDefault(require("./previews/AITechCyberpunk"));
const designs = [
    {
        id: 1,
        name: "Neo-Brutalist",
        description: "Bold borders, offset shadows, vibrant colors. High-energy, unapologetic aesthetic.",
        component: NeoBrutalist_1.default,
    },
    {
        id: 2,
        name: "Minimal Dark",
        description: "Clean dark mode with subtle gradients. Sophisticated and professional.",
        component: MinimalDark_1.default,
    },
    {
        id: 3,
        name: "Glassmorphism",
        description: "Frosted glass effects and translucent layers. Modern depth through blur.",
        component: Glassmorphism_1.default,
    },
    {
        id: 4,
        name: "Cyberpunk Neon",
        description: "Neon glows on dark backgrounds. Futuristic with glitch effects.",
        component: CyberpunkNeon_1.default,
    },
    {
        id: 5,
        name: "Organic Flow",
        description: "Curved shapes and gradient blobs. Friendly and approachable.",
        component: OrganicFlow_1.default,
    },
    {
        id: 6,
        name: "Bento Grid",
        description: "Apple-style asymmetric grid. Structured yet dynamic.",
        component: BentoGrid_1.default,
    },
    {
        id: 7,
        name: "Terminal Hacker",
        description: "Monospace fonts, green-on-black. Developer-focused aesthetic.",
        component: TerminalHacker_1.default,
    },
    {
        id: 8,
        name: "Gradient Mesh",
        description: "Soft pastels and fluid shapes. Dreamy and artistic.",
        component: GradientMesh_1.default,
    },
    {
        id: 9,
        name: "Neumorphism",
        description: "Soft UI with extruded and inset shadows. Soothing, minimal contrast.",
        component: Neumorphism_1.default,
    },
    {
        id: 10,
        name: "Swiss Design",
        description: "Grid-based, bold typography, mathematical precision. Helvetica vibes.",
        component: SwissDesign_1.default,
    },
    {
        id: 11,
        name: "Memphis Design",
        description: "80s geometric chaos. Squiggles, bold colors, playful maximalism.",
        component: MemphisDesign_1.default,
    },
    {
        id: 12,
        name: "Retro Futurism",
        description: "70s/80s sci-fi aesthetic. Synthwave sunsets, chrome, perspective grids.",
        component: RetroFuturism_1.default,
    },
    {
        id: 13,
        name: "Claymorphism",
        description: "Soft 3D clay aesthetic. Puffy shapes, pastels, toy-like feel.",
        component: Claymorphism_1.default,
    },
    {
        id: 14,
        name: "Cyberpunk.net Style",
        description: "CD Projekt RED inspired. Neon yellow on deep black, stark contrast, cinematic minimalism.",
        component: CyberpunkNetStyle_1.default,
    },
    {
        id: 15,
        name: "OpenClaw Style",
        description: "Deep navy with coral/cyan glows. Futuristic yet approachable, asymmetric cards.",
        component: OpenClawStyle_1.default,
    },
    {
        id: 16,
        name: "Starknet Official Style",
        description: "Light minimalist, monospace code, pill buttons. Professional and premium.",
        component: StarknetOfficialStyle_1.default,
    },
    {
        id: 17,
        name: "GitHub Style",
        description: "Clean light background, green CTAs, card-based. Developer-friendly, trustworthy.",
        component: GitHubStyle_1.default,
    },
    {
        id: 18,
        name: "AI Tech Cyberpunk",
        description: "Neural network patterns, gradient glows. Futuristic AI aesthetic, intelligent vibe.",
        component: AITechCyberpunk_1.default,
    },
];
function DesignShowcase() {
    return (<main className="min-h-screen bg-neutral-100">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-6 py-12 md:px-12">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm text-neutral-500 uppercase tracking-wider mb-3">
            Starknet Agentic
          </p>
          <h1 className="text-3xl md:text-4xl font-light text-neutral-900 mb-4">
            Design Direction Showcase
          </h1>
          <p className="text-neutral-500 max-w-lg mx-auto">
            18 design directions for the website. Review each preview and share
            your feedback with the community.
          </p>
        </div>
      </header>

      {/* Design Previews */}
      <div className="py-12 md:py-16 space-y-12 md:space-y-16">
        {designs.map((design) => (<section key={design.id} className="px-6 md:px-12">
            <div className="max-w-6xl mx-auto">
              {/* Design Label */}
              <div className="flex items-baseline gap-4 mb-4">
                <span className="text-sm text-neutral-400 tabular-nums">
                  {String(design.id).padStart(2, "0")}
                </span>
                <h2 className="text-lg font-medium text-neutral-900">
                  {design.name}
                </h2>
                <span className="text-sm text-neutral-400">
                  {design.description}
                </span>
              </div>

              {/* Preview Container */}
              <div className="rounded-lg overflow-hidden shadow-sm ring-1 ring-neutral-200">
                <div className="h-[350px] md:h-[400px] overflow-hidden">
                  <design.component />
                </div>
              </div>
            </div>
          </section>))}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-neutral-200 px-6 py-10 md:px-12">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-neutral-600 mb-2">
            Which direction resonates with you?
          </p>
          <p className="text-sm text-neutral-400">
            Share your thoughts in the community discussion.
          </p>
        </div>
      </footer>
    </main>);
}
