"use client";
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AnalyzeModal;
const react_1 = require("react");
const AgentReasoningPanel_1 = __importDefault(require("./AgentReasoningPanel"));
const DataSourcesPanel_1 = __importDefault(require("./DataSourcesPanel"));
function AnalyzeModal({ marketId, question, onClose, }) {
    // Close on Escape key
    (0, react_1.useEffect)(() => {
        const handleKey = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);
    // Prevent body scroll
    (0, react_1.useEffect)(() => {
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = "";
        };
    }, []);
    return (<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}/>

      {/* Modal */}
      <div className="relative z-10 w-full max-w-4xl max-h-[85vh] flex flex-col neo-card border-2 border-black bg-white shadow-neo-lg animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neo-dark border-b-2 border-black shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-heading font-bold text-sm text-neo-green uppercase tracking-wider shrink-0">
              Analyze
            </span>
            <span className="font-mono text-xs text-white/40 truncate">
              {question}
            </span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center border-2 border-white/30 text-white hover:bg-white/10 text-xs font-mono transition-colors shrink-0 ml-3">
            ESC
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Research Data */}
          <DataSourcesPanel_1.default question={question}/>

          {/* Agent Reasoning */}
          <AgentReasoningPanel_1.default marketId={marketId} question={question}/>
        </div>
      </div>
    </div>);
}
