/**
 * hicecaster tasks — Browse ProveWork task bounties.
 */

import pc from "picocolors";
import { createSpinner } from "../spinner.js";

export interface TasksOptions {
  apiUrl: string;
  limit: number;
  status?: string;
}

interface Task {
  taskId: string;
  description?: string;
  descriptionHash: string;
  status: string;
  rewardStrk: number;
  poster: string;
  bidsCount: number;
  deadline: number;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function timeLeft(deadline: number): string {
  const diff = deadline - Math.floor(Date.now() / 1000);
  if (diff < 0) return pc.red("expired");
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const STATUS_COLOR: Record<string, (s: string) => string> = {
  open: pc.green,
  assigned: pc.cyan,
  submitted: pc.yellow,
  approved: pc.green,
  disputed: pc.red,
  cancelled: pc.dim,
};

export async function runTasks(opts: TasksOptions): Promise<void> {
  const spinner = createSpinner("Fetching tasks");
  spinner.start();

  try {
    const url = new URL("/api/provework/tasks", opts.apiUrl);
    url.searchParams.set("limit", opts.limit.toString());
    if (opts.status) url.searchParams.set("status", opts.status);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API returned ${res.status}`);

    const data = (await res.json()) as { tasks: Task[] };
    const tasks = data.tasks;
    spinner.stop("");

    if (tasks.length === 0) {
      console.log(pc.dim("No tasks found."));
      return;
    }

    console.log(
      pc.bold(
        `  ${"ID".padEnd(5)} ${"Reward".padEnd(12)} ${"Status".padEnd(10)} ${"Bids".padEnd(5)} ${"Time".padEnd(8)} Description`
      )
    );
    console.log(pc.dim("  " + "─".repeat(78)));

    for (const t of tasks) {
      const reward = `${t.rewardStrk} STRK`.padEnd(12);
      const status = (STATUS_COLOR[t.status] || pc.dim)(t.status.padEnd(10));
      const bids = String(t.bidsCount).padEnd(5);
      const time = timeLeft(t.deadline).padEnd(8);
      const desc = t.description
        ? truncate(t.description, 35)
        : pc.dim(t.descriptionHash.slice(0, 14) + "...");

      console.log(
        `  ${pc.dim(t.taskId.padEnd(5))} ${pc.cyan(reward)} ${status} ${bids} ${time} ${desc}`
      );
    }

    console.log();
    console.log(pc.dim(`  ${tasks.length} task(s) shown`));
  } catch (err) {
    spinner.stop(pc.red("Failed"));
    console.error(pc.red("Failed to fetch tasks:"), (err as Error).message);
    process.exit(1);
  }
}
