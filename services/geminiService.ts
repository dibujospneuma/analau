import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";
import { AccountLine, AccountType, RegulatoryUpdate } from "../types";

// Helper to remove markdown code blocks
const cleanJsonString = (str: string): string => {
  return str.replace(/```json/g, '').replace(/```/g, '').trim();
};

export const extractRegulatoryRules = async (
  fileBase64: string,
  mimeType: string
): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // We send the document to Gemini to extract the "Logic" of the Chart of Accounts
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: fileBase64
            }
          },
          {
            text: `This document contains accounting regulations (CNV/BCRA) or a Chart of Accounts.
            Analyze it and EXTRACT the hierarchical structure of the Balance Sheet.
            
            Specifically, list:
            1. The allowed "Rubros" (Categories) for Assets (Activo), Liabilities (Pasivo), and Equity (Patrimonio Neto).
            2. The grouping rules (which sub-accounts go into which Rubro).
            3. The exact sorting order required by this document.
            
            Return a concise, structured text summary of these rules that I can pass to another AI agent to classify accounts later. Do not include preamble.`
          }
        ]
      }
    });

    return response.text || "";

  } catch (error) {
    console.error("Error extracting regulations:", error);
    throw new Error("No se pudo leer el archivo de normativa.");
  }
};

export const extractStructureFromExcel = async (
  fileBase64: string
): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Read the Excel file to CSV to save tokens and provide clarity
    const workbook = XLSX.read(fileBase64, { type: 'base64' });
    const sheetName = workbook.SheetNames[0]; 
    const worksheet = workbook.Sheets[sheetName];
    const csvText = XLSX.utils.sheet_to_csv(worksheet);

    // INCREASED LIMIT: Gemini 2.5 Flash handles ~1M tokens. 
    // We increase the limit to 500,000 chars to ensure we capture the full chart of accounts (Assets + Liabilities + Equity).
    const truncatedText = csvText.substring(0, 500000); 

    const prompt = `
      You are an expert Accounting System Architect.
      I will provide you with the raw data of a Balance Sheet in CSV format.
      
      YOUR TASK:
      Reverse-engineer the "Chart of Accounts Model" used in this file. 
      Ignore the specific numbers/amounts. Focus ONLY on the structure of Headers (Rubros) and their hierarchy.
      Read the ENTIRE provided text to ensure you capture Activo, Pasivo, and Patrimonio Neto / Resultados.
      
      OUTPUT FORMAT:
      Produce a clean, text-based hierarchy list that I can use as a "Global Configuration Model".
      
      Example Output Format:
      ACTIVO
      - Caja y Bancos
      - Inversiones
      - ...
      PASIVO
      - Deudas Comerciales
      - ...
      PATRIMONIO NETO
      - ...
      RESULTADOS
      - ...
      
      Here is the CSV data:
      ${truncatedText}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });

    return response.text || "";
  } catch (error) {
    console.error("Error extracting structure:", error);
    throw new Error("No se pudo analizar la estructura del Excel.");
  }
};

export const parseFinancialDocument = async (
  fileBase64: string,
  mimeType: string,
  filename: string
): Promise<Partial<AccountLine>[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const lowerName = filename.toLowerCase();
    const isSpreadsheet = 
      mimeType.includes('sheet') || 
      mimeType.includes('excel') || 
      mimeType.includes('csv') || 
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls');

    // STRATEGY 1: SMART MAPPING (For Excel/CSV)
    // Instead of sending the whole file to AI (which fails on large files), 
    // we send the first 20 rows to AI to identify columns, then parse via code.
    if (isSpreadsheet) {
      const workbook = XLSX.read(fileBase64, { type: 'base64' });
      const sheetName = workbook.SheetNames[0]; 
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON array of arrays (rows)
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      if (!rows || rows.length === 0) return [];

      // Take a sample (first 20 rows) for the AI to analyze structure
      const sampleRows = rows.slice(0, 25);
      const sampleText = JSON.stringify(sampleRows);

      const mappingPrompt = `
        Analyze this sample data from an accounting spreadsheet (array of arrays).
        Identify the 0-based index of the columns representing:
        - 'code' (Account Code)
        - 'name' (Account Name/Description)
        - 'debit' (Debe)
        - 'credit' (Haber)
        - 'balance' (Saldo/Importe - can be positive/negative)

        Rules:
        1. If 'debit' and 'credit' separate columns exist, identify them.
        2. If only a single 'balance' column exists, identify it.
        3. 'name' is mandatory.
        4. Return -1 if a column is not found.
        5. Identify the 'startRow' index (the first row that contains actual account data, skipping headers).

        Return strictly JSON:
        {
          "codeIndex": number,
          "nameIndex": number,
          "debitIndex": number,
          "creditIndex": number,
          "balanceIndex": number,
          "startRow": number
        }
      `;

      const mappingResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Sample Data: ${sampleText}\n\n${mappingPrompt}`,
        config: { responseMimeType: "application/json" }
      });

      const mapping = JSON.parse(cleanJsonString(mappingResponse.text || "{}"));
      
      // PARSE USING MAPPING (Deterministic & Scalable)
      const extractedLines: Partial<AccountLine>[] = [];

      for (let i = (mapping.startRow || 0); i < rows.length; i++) {
         const row = rows[i];
         if (!row || row.length === 0) continue;

         const name = mapping.nameIndex > -1 ? String(row[mapping.nameIndex] || '').trim() : '';
         if (!name) continue; // Skip empty lines

         const code = mapping.codeIndex > -1 ? String(row[mapping.codeIndex] || '') : '';
         
         let debit = 0;
         let credit = 0;
         let balance = 0;

         // Logic: Calculate balance based on available columns
         if (mapping.debitIndex > -1 && mapping.creditIndex > -1) {
            debit = parseFloat(String(row[mapping.debitIndex]).replace(/[^0-9.-]/g, '')) || 0;
            credit = parseFloat(String(row[mapping.creditIndex]).replace(/[^0-9.-]/g, '')) || 0;
            balance = debit - credit;
         } else if (mapping.balanceIndex > -1) {
            balance = parseFloat(String(row[mapping.balanceIndex]).replace(/[^0-9.-]/g, '')) || 0;
            if (balance > 0) debit = balance;
            else credit = Math.abs(balance);
         }

         // Ignore lines that look like page numbers or empty balances if intended
         // But keep 0 balances if it's a valid account
         extractedLines.push({
             code,
             name,
             debit,
             credit,
             balance
         });
      }

      return extractedLines;
    }

    // STRATEGY 2: FULL AI PARSE (For PDFs, Images, Text files)
    // Fallback for non-structured data
    const contentPart = {
        inlineData: {
          mimeType: mimeType,
          data: fileBase64
        }
    };

    const prompt = `Act as an expert accounting auditor. 
    Extract the accounting lines from the provided document. 
    Return a JSON array where each object has:
    - 'code' (string)
    - 'name' (string)
    - 'debit' (number)
    - 'credit' (number)
    - 'balance' (number)
    
    Ignore headers, footers, titles. Only extract account detail rows.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [contentPart, { text: prompt }]
      },
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) return [];
    
    const parsedData = JSON.parse(cleanJsonString(text));
    return Array.isArray(parsedData) ? parsedData : [];

  } catch (error) {
    console.error("Error parsing document:", error);
    throw new Error("No se pudo procesar el archivo. Verifique el formato.");
  }
};

export const classifyAccounts = async (
  accounts: Partial<AccountLine>[], 
  customRegulations?: string,
  globalStandard?: string
): Promise<AccountLine[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Process in chunks to avoid context limits if list is huge
    // But for classifying, we usually need context of the whole list for structure.
    // We'll limit to 500 lines for the AI pass, which is plenty for structure.
    const accountList = accounts.slice(0, 500).map((a, i) => ({ id: i, name: a.name, code: a.code, balance: a.balance }));

    // Define context hierarchy: Client Specific > Global User Standard > Default CNV
    
    const defaultLogic = `
      Task 2: Assign a Standard CNV "Rubro" (Category) to each account. Use these specific names:
      - For ACTIVO: "Caja y Bancos", "Inversiones", "Créditos por Ventas", "Otros Créditos", "Bienes de Cambio", "Bienes de Uso", "Activos Intangibles".
      - For PASIVO: "Deudas Comerciales", "Deudas Bancarias", "Deudas Sociales y Fiscales", "Otras Deudas", "Previsiones".
      - For PATRIMONIO_NETO: "Capital Social", "Reservas", "Resultados Acumulados".
      - For RESULTADOS: "Ventas", "Costo de Ventas", "Gastos de Administración", "Gastos de Comercialización", "Resultados Financieros".
    `;

    let activeLogic = defaultLogic;

    if (globalStandard && globalStandard.length > 10) {
       activeLogic = `
         *** IMPORTANT: USE THE FOLLOWING USER-DEFINED GLOBAL STANDARD FOR CLASSIFICATION ***
         ${globalStandard}
         
         Task 2: Assign the "Rubro" (Category) strictly based on the User Standard above.
         Only use Rubro names defined in the text above.
       `;
    }

    if (customRegulations && customRegulations.length > 10) {
      activeLogic = `
      *** URGENT: USE THE FOLLOWING SPECIFIC CLIENT REGULATION RULES FOR CLASSIFICATION ***
      ${customRegulations}
      
      Task 2: Assign the "Rubro" (Category) strictly based on the rules above. 
      Only use Rubro names defined in the custom text above.
      `;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `You are a Senior Accountant auditing a Balance Sheet.
      
      Task 1: Classify each account into these Chapters:
      - ACTIVO
      - PASIVO
      - PATRIMONIO_NETO
      - INGRESOS
      - EGRESOS

      ${activeLogic}

      Task 3: Identify Structure.
      - If the line is the Header/Total itself (e.g., "TOTAL CAJA Y BANCOS"), set 'isGroup' to TRUE.
      - If it is a sub-account, set 'isGroup' to FALSE.

      Return a JSON array of objects with property 'id' (matching input), 'type' (string), 'category' (string), and 'isGroup' (boolean).
      
      Input Data:
      ${JSON.stringify(accountList)}
      `,
      config: {
        responseMimeType: "application/json"
      }
    });

    const classificationMap: Record<number, { type: string, category: string, isGroup: boolean }> = {};
    const result = JSON.parse(cleanJsonString(response.text || "[]"));
    
    result.forEach((item: any) => {
      classificationMap[item.id] = { 
        type: item.type, 
        category: item.category || 'Otros', // Fallback
        isGroup: item.isGroup 
      };
    });

    return accounts.map((acc, index) => ({
      id: crypto.randomUUID(),
      code: acc.code || '',
      name: acc.name || 'Cuenta Desconocida',
      debit: acc.debit || 0,
      credit: acc.credit || 0,
      balance: acc.balance || (acc.debit || 0) - (acc.credit || 0),
      type: (classificationMap[index]?.type as AccountType) || AccountType.UNCLASSIFIED,
      category: classificationMap[index]?.category || 'Sin Clasificar',
      isGroup: classificationMap[index]?.isGroup || false,
      manualOverride: false
    }));

  } catch (error) {
    console.error("Error classifying accounts:", error);
    return accounts.map(acc => ({
      id: crypto.randomUUID(),
      code: acc.code || '',
      name: acc.name || 'Error Clasificación',
      debit: acc.debit || 0,
      credit: acc.credit || 0,
      balance: acc.balance || 0,
      type: AccountType.UNCLASSIFIED,
      category: 'Error',
      isGroup: false,
      manualOverride: false
    }));
  }
};

export const fetchRegulatoryUpdates = async (): Promise<RegulatoryUpdate[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const today = new Date().toLocaleDateString('es-AR');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Find the latest regulations, circulars, or news from BCRA (Banco Central de la República Argentina) and CNV (Comisión Nacional de Valores) relevant for today, ${today}. 
      Focus on norms affecting financial reporting, balance sheets, and audit criteria.
      If no specific news today, get the most recent ones from this week.
      `,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const searchResultText = response.text;
    
    const formattingResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Based on the following search results about BCRA and CNV regulations:
      ---
      ${searchResultText}
      ---
      Generate a JSON array of regulatory updates. 
      Schema:
      [
        {
          "source": "BCRA" | "CNV",
          "date": "YYYY-MM-DD",
          "title": "Short title",
          "summary": "Brief summary of impact",
          "impactLevel": "High" | "Medium" | "Low"
        }
      ]
      `,
      config: {
        responseMimeType: "application/json"
      }
    });

    const structuredUpdates = JSON.parse(cleanJsonString(formattingResponse.text || "[]"));
    return structuredUpdates;

  } catch (error) {
    console.error("Error fetching regulations:", error);
    return [];
  }
};