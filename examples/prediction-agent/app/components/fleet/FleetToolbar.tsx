"use client";

type FilterStatus = "all" | "running" | "paused" | "critical";
type ViewMode = "grid" | "list";
type SortBy = "name" | "brier" | "balance" | "activity";

interface FleetToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterStatus: FilterStatus;
  onFilterChange: (f: FilterStatus) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
  onDeployClick: () => void;
  deployDisabled?: boolean;
  deployDisabledReason?: string | null;
}

const FILTERS: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "paused", label: "Paused" },
  { value: "critical", label: "Critical" },
];

const SORTS: { value: SortBy; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "brier", label: "Brier Score" },
  { value: "balance", label: "Balance" },
  { value: "activity", label: "Activity" },
];

export default function FleetToolbar({
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterChange,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  onDeployClick,
  deployDisabled = false,
  deployDisabledReason = null,
}: FleetToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: search + filters */}
      <div className="flex flex-1 items-center gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search agents..."
          className="neo-input w-48 text-xs sm:w-56"
        />
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => onFilterChange(f.value)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide transition-colors ${
                filterStatus === f.value
                  ? "bg-neo-brand/20 text-neo-brand"
                  : "bg-white/[0.04] text-muted hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right: view toggle + sort + deploy */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-md border border-white/[0.07] bg-white/[0.03]">
          <button
            onClick={() => onViewModeChange("grid")}
            className={`px-2 py-1 text-xs transition-colors ${
              viewMode === "grid"
                ? "bg-white/[0.08] text-white"
                : "text-muted hover:text-white"
            }`}
            title="Grid view"
          >
            &#x25A6;
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            className={`px-2 py-1 text-xs transition-colors ${
              viewMode === "list"
                ? "bg-white/[0.08] text-white"
                : "text-muted hover:text-white"
            }`}
            title="List view"
          >
            &#x2630;
          </button>
        </div>

        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          className="neo-input cursor-pointer text-[10px]"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <button
          onClick={onDeployClick}
          disabled={deployDisabled}
          title={deployDisabledReason ?? undefined}
          className="neo-btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Deploy Agent
        </button>
      </div>
    </div>
  );
}

export type { FilterStatus, ViewMode, SortBy };
