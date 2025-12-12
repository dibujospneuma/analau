export enum AccountType {
  ASSET = 'ACTIVO',
  LIABILITY = 'PASIVO',
  EQUITY = 'PATRIMONIO_NETO',
  REVENUE = 'INGRESOS',
  EXPENSE = 'EGRESOS',
  UNCLASSIFIED = 'SIN_CLASIFICAR'
}

export interface AccountLine {
  id: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
  balance: number;
  type: AccountType;
  category: string; // Rubro CNV (e.g., "Caja y Bancos", "Bienes de Uso")
  isGroup: boolean; // True = Rubro (Header), False = Sub-cuenta (Detail)
  manualOverride: boolean;
}

export interface ClientData {
  id: string;
  name: string;
  cuit: string;
  industry: string;
  lastUpdated: string;
  accounts: AccountLine[];
  files: { name: string; date: string; type: string }[];
  notes: string[];
  customRegulations?: string; // Stores the extracted rules from the uploaded normative file
}

export interface Inconsistency {
  id: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  relatedAccountIds: string[];
}

export interface RegulatoryUpdate {
  source: 'BCRA' | 'CNV';
  date: string;
  title: string;
  summary: string;
  impactLevel: 'High' | 'Medium' | 'Low';
  url?: string;
}

export type ViewState = 'DASHBOARD' | 'CLIENT_WORKBENCH' | 'REGULATIONS';
export type WorkbenchTab = 'UPLOAD' | 'CLASSIFICATION' | 'REPORTS' | 'EXPORT';