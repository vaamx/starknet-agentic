import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/require-auth";
import {
  listRecentExecutions,
  listRecentForecasts,
  listRecentResearchArtifacts,
} from "@/lib/ops-store";

type ExportDataset = "forecasts" | "research" | "executions";

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replaceAll("\"", "\"\"")}"`;
  }
  return str;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const header = columns.join(",");
  const dataRows = rows.map((row) =>
    columns.map((column) => escapeCsv(row[column])).join(",")
  );
  return [header, ...dataRows].join("\n");
}

function normalizeDataset(raw: string | null): ExportDataset | null {
  if (raw === "forecasts" || raw === "research" || raw === "executions") {
    return raw;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dataset = normalizeDataset(request.nextUrl.searchParams.get("dataset"));
  if (!dataset) {
    return NextResponse.json(
      { error: "Invalid dataset. Use forecasts, research, or executions." },
      { status: 400 }
    );
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "500");
  const finalLimit = Math.min(5000, Math.max(1, Number.isFinite(limit) ? limit : 500));

  let rows: Array<Record<string, unknown>>;
  if (dataset === "forecasts") {
    rows = (await listRecentForecasts(
      context.membership.organizationId,
      finalLimit
    )) as Array<Record<string, unknown>>;
  } else if (dataset === "research") {
    rows = (await listRecentResearchArtifacts(
      context.membership.organizationId,
      finalLimit
    )) as Array<Record<string, unknown>>;
  } else {
    rows = (await listRecentExecutions(
      context.membership.organizationId,
      finalLimit
    )) as Array<Record<string, unknown>>;
  }

  const csv = toCsv(rows);
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${dataset}-${date}.csv\"`,
      "Cache-Control": "no-store",
    },
  });
}
