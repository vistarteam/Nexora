import { COLLECTION_LIMITS, COLLECTIONS, type Collection, type Storage } from '../storage/index.js';
import type { AnalysisReport, AnalysisSummary } from '../types/domain.js';

/**
 * Persistence for generated analysis reports.
 *
 * Reports are immutable once written, so the API is intentionally small: add,
 * list, read one, delete one. Everything goes through the `Collection`
 * interface, which is what makes a PostgreSQL swap a driver change rather than
 * a rewrite.
 */
export class HistoryService {
  private readonly reports: Collection<AnalysisReport>;

  constructor(storage: Storage) {
    this.reports = storage.collection<AnalysisReport>(COLLECTIONS.reports, {
      maxItems: COLLECTION_LIMITS.reports,
    });
  }

  async save(report: AnalysisReport): Promise<AnalysisReport> {
    return this.reports.put(report);
  }

  /** Newest-first list of compact summaries; the full report is fetched by id. */
  async list(limit = 50): Promise<AnalysisSummary[]> {
    const reports = await this.reports.list({ limit });
    return reports.map(toSummary);
  }

  async get(id: string): Promise<AnalysisReport | null> {
    return this.reports.get(id);
  }

  async remove(id: string): Promise<boolean> {
    return this.reports.delete(id);
  }

  async count(): Promise<number> {
    return this.reports.count();
  }
}

export function toSummary(report: AnalysisReport): AnalysisSummary {
  return {
    id: report.id,
    symbol: report.symbol,
    tvSymbol: report.tvSymbol,
    name: report.name,
    assetClass: report.assetClass,
    timeframe: report.timeframe,
    createdAt: report.createdAt,
    mode: report.mode,
    status: report.status,
    engine: report.engine.id,
    price: report.facts?.lastCandle?.close ?? null,
    trendDirection: report.facts?.trend?.direction ?? null,
  };
}
