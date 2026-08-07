import { NextResponse } from 'next/server';

import { PERMISSIONS } from '@/constants/permissions';
import { withRoute } from '@/lib/api/handler';
import { assertAdminPermission } from '@/server/auth/admin';
import { recordAudit } from '@/services/admin/audit.service';
import { REPORTS, type ReportKey, buildReport, toCsv } from '@/services/admin/report.service';

/**
 * Report exports: CSV, Excel and print-to-PDF.
 *
 * Three formats, no dependencies:
 *
 *   **CSV** — the format itself is four lines of quoting rules.
 *   **Excel** — an HTML table served as `application/vnd.ms-excel`. Excel has
 *     opened these since 1997 and it costs nothing; a real `.xlsx` needs a zip
 *     container and a schema, which is a megabyte of dependency to avoid one
 *     format warning on first open.
 *   **PDF** — a styled page with `window.print()`. The browser already has a
 *     PDF engine, and shipping a second one server-side to produce a worse
 *     result would be the definition of over-building.
 *
 * Every export is audited. An export is how customer data leaves the building,
 * so "who downloaded the customer list" has to be answerable.
 */
export const GET = withRoute(async ({ request, params }) => {
  const user = await assertAdminPermission(PERMISSIONS.reportExport);

  const raw = String((await params).key ?? 'sales');
  const key = (REPORTS.some((entry) => entry.key === raw) ? raw : 'sales') as ReportKey;

  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 7), 365);
  const format = url.searchParams.get('format') ?? 'csv';

  const report = await buildReport(key, days);

  await recordAudit({
    action: 'EXPORT',
    entityType: 'Report',
    entityId: key,
    actorId: user.id,
    changes: { format: { from: null, to: format }, rows: { from: null, to: report.rows.length } },
  });

  const filename = `intimatebunnie-${key}-${days}d`;

  if (format === 'csv') {
    return new NextResponse(toCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const table = renderTable(report, format === 'print');

  if (format === 'xls') {
    return new NextResponse(table, {
      headers: {
        'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.xls"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // Print view: opens, then triggers the browser's own PDF export.
  return new NextResponse(table, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTable(report: Awaited<ReturnType<typeof buildReport>>, print: boolean): string {
  const head = report.columns
    .map(
      (column) =>
        `<th style="text-align:${column.align ?? 'left'}">${escapeHtml(column.label)}</th>`,
    )
    .join('');

  const body = report.rows
    .map((row) => {
      const cells = report.columns
        .map((column) => {
          const value = row[column.key] ?? '';
          const text = column.money ? (Number(value) / 100).toFixed(2) : String(value);
          return `<td style="text-align:${column.align ?? 'left'}">${escapeHtml(text)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(report.title)} — INTIMATE BUNNIE</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #333; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  p.meta { color: #707070; font-size: .8rem; margin: 0 0 1.5rem; }
  table { border-collapse: collapse; width: 100%; font-size: .8rem; }
  th, td { border-bottom: 1px solid #e5e5e5; padding: .5rem .75rem; }
  th { text-transform: uppercase; font-size: .65rem; letter-spacing: .04em; color: #707070; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <h1>${escapeHtml(report.title)}</h1>
  <p class="meta">${escapeHtml(report.description)} · Exported ${new Date().toISOString().slice(0, 10)} · INTIMATE BUNNIE</p>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  ${print ? '<script>window.addEventListener("load", () => window.print());</script>' : ''}
</body></html>`;
}
