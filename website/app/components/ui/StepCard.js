"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StepCard = StepCard;
function StepCard({ item }) {
    return (<article className="neo-card p-6 bg-white text-left">
      <div className="w-10 h-10 bg-neo-dark text-white border-2 border-black shadow-neo-sm flex items-center justify-center font-heading font-black text-lg mb-4" aria-hidden="true">
        {item.step}
      </div>
      <h3 className="font-heading font-bold text-lg mb-2">{item.title}</h3>
      <p className="font-body text-sm text-neo-dark/70">{item.desc}</p>
    </article>);
}
