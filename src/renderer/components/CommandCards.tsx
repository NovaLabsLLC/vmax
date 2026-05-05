import React from "react";

type Card = {
  key: string;
  title: string;
  hint: string;
  enabled: boolean;
  loading?: boolean;
  onClick: () => void;
};

export default function CommandCards({ cards }: { cards: Card[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {cards.map((c) => (
        <button
          key={c.key}
          disabled={!c.enabled || c.loading}
          onClick={c.onClick}
          className={`group relative text-left rounded-xl border px-3 py-2.5 transition-all duration-150
            overflow-hidden
            ${c.enabled
              ? "bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.07] hover:border-white/15 active:scale-[0.99]"
              : "bg-white/[0.02] border-white/[0.05] opacity-45 cursor-not-allowed"}
            ${c.loading ? "ring-1 ring-emerald-400/40 border-emerald-400/30 shimmer-sweep" : ""}`}
        >
          {/* subtle top highlight */}
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          <div className="flex items-center gap-2">
            <Dot loading={c.loading} />
            <div className="text-[12.5px] font-medium text-white tracking-tight">{c.title}</div>
          </div>
          <div className="text-[10.5px] text-white/45 mt-0.5 leading-snug truncate">{c.hint}</div>
        </button>
      ))}
    </div>
  );
}

function Dot({ loading }: { loading?: boolean }) {
  if (loading) {
    return (
      <span className="relative flex">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-60" />
      </span>
    );
  }
  return <span className="w-1.5 h-1.5 rounded-full bg-white/35 group-hover:bg-white/55 transition-colors" />;
}
