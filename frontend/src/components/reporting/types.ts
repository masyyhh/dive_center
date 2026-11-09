import type { DashboardReport } from '../../types';

export type DownloadChartCsv = (name: string, headers: string[], rows: unknown[][]) => void;
export interface ReportPanelProps {
  report: DashboardReport | null;
  currencySymbol: string;
  downloadChartCsv: DownloadChartCsv;
}
