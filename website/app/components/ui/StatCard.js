"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatCard = StatCard;
function StatCard({ stat }) {
    return (<div className="neo-card p-5 text-center">
      <div className="font-heading font-black text-2xl md:text-3xl text-neo-purple">
        {stat.value}
      </div>
      <div className="font-body text-sm text-neo-dark/60 mt-1">{stat.label}</div>
    </div>);
}
