import React, { useState, useMemo, useRef } from 'react';
import { ClientData, AccountLine, AccountType, WorkbenchTab, Inconsistency } from '../types';
import { parseFinancialDocument, classifyAccounts, extractRegulatoryRules } from '../services/geminiService';
import { ArrowLeft, UploadCloud, FileSpreadsheet, Loader2, AlertCircle, Save, FileText, Printer, Plus, Trash2, Edit3, Folder, FileMinus, BookOpen, CheckCircle, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props {
  client: ClientData;
  globalModel?: string;
  onSave: (client: ClientData) => void;
  onBack: () => void;
}

const FinancialWorkspace: React.FC<Props> = ({ client, globalModel, onSave, onBack }) => {
  const [tab, setTab] = useState<WorkbenchTab>('UPLOAD');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [accounts, setAccounts] = useState<AccountLine[]>(client.accounts);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const normInputRef = useRef<HTMLInputElement>(null);

  // --- Financial Calculations & Grouping ---
  const groupedFinancials = useMemo(() => {
    
    const groupByTypeAndCategory = (type: AccountType) => {
        const filtered = accounts.filter(a => a.type === type && !a.isGroup);
        
        const groups: Record<string, AccountLine[]> = {};
        filtered.forEach(acc => {
            const cat = acc.category || 'Otros';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(acc);
        });

        // Default order map (CNV) - used only if no custom model is present or as fallback
        const defaultOrderMap: Record<string, number> = {
            // Activo
            'Caja y Bancos': 1, 'Inversiones': 2, 'Créditos por Ventas': 3, 'Otros Créditos': 4,
            'Bienes de Cambio': 5, 'Bienes de Uso': 6, 'Activos Intangibles': 7,
            // Pasivo
            'Deudas Comerciales': 1, 'Deudas Bancarias': 2, 'Deudas Sociales y Fiscales': 3,
            'Otras Deudas': 4, 'Previsiones': 5,
            // PN
            'Capital Social': 1, 'Reservas': 2, 'Resultados Acumulados': 3
        };

        const sortedCategories = Object.keys(groups).sort((a, b) => {
             // If we have a custom regulation or global model, we prefer the AI's classification order
             // Since we can't easily know the user's intended order without parsing the text,
             // we will try to stick to default if matches, otherwise alphabetical/dynamic
             if (client.customRegulations || (globalModel && globalModel.length > 0)) {
                 // Check if both are in default map
                 const orderA = defaultOrderMap[a];
                 const orderB = defaultOrderMap[b];
                 if (orderA && orderB) return orderA - orderB;
                 if (orderA) return -1; // Standard items first
                 if (orderB) return 1;
                 return a.localeCompare(b); // Fallback to alphabetical for custom categories
             } else {
                 const orderA = defaultOrderMap[a] || 99;
                 const orderB = defaultOrderMap[b] || 99;
                 return orderA - orderB;
             }
        });

        return sortedCategories.map(cat => ({
            name: cat,
            accounts: groups[cat],
            total: groups[cat].reduce((sum, a) => sum + a.balance, 0)
        }));
    };

    const assets = groupByTypeAndCategory(AccountType.ASSET);
    const liabilities = groupByTypeAndCategory(AccountType.LIABILITY);
    const equity = groupByTypeAndCategory(AccountType.EQUITY);
    const revenue = groupByTypeAndCategory(AccountType.REVENUE);
    const expenses = groupByTypeAndCategory(AccountType.EXPENSE);

    const assetsTotal = assets.reduce((s, g) => s + g.total, 0);
    const liabilitiesTotal = liabilities.reduce((s, g) => s + g.total, 0);
    const equityTotal = equity.reduce((s, g) => s + g.total, 0);
    const revenueTotal = revenue.reduce((s, g) => s + g.total, 0);
    const expenseTotal = expenses.reduce((s, g) => s + g.total, 0);

    const netResult = Math.abs(revenueTotal) - Math.abs(expenseTotal);

    return {
        assets, assetsTotal,
        liabilities, liabilitiesTotal,
        equity, equityTotal,
        revenue, revenueTotal,
        expenses, expenseTotal,
        netResult
    };
  }, [accounts, client.customRegulations, globalModel]);

  // --- Logic for Inconsistency Detection ---
  const inconsistencies = useMemo(() => {
    const issues: Inconsistency[] = [];
    const grandTotal = accounts.filter(a => !a.isGroup).reduce((s, a) => s + a.balance, 0);

    if (Math.abs(grandTotal) > 1) { 
       issues.push({
         id: 'diff-balance',
         severity: 'high',
         message: `El balance no da cero (Diferencia: ${grandTotal.toFixed(2)}). Revisar asientos.`,
         relatedAccountIds: []
       });
    }

    return issues;
  }, [accounts]);


  // --- File Handling: Financial Data ---
  const handleFinancialUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    
    setLoading(true);
    setLoadingMsg(`Leyendo ${file.name}...`);

    const reader = new FileReader();
    
    reader.onload = async () => {
      try {
          const base64 = (reader.result as string).split(',')[1];
          
          setLoadingMsg('Analizando estructura contable con IA...');
          const mimeType = file.type || 'application/octet-stream';
          const rawAccounts = await parseFinancialDocument(base64, mimeType, file.name);
          
          if (rawAccounts.length === 0) {
              throw new Error("No se encontraron cuentas en el archivo. Verifique el formato.");
          }

          let loadMsg = 'Clasificando...';
          if (client.customRegulations) loadMsg = 'Aplicando Normativa de Cliente...';
          else if (globalModel) loadMsg = 'Aplicando Modelo Estándar Global...';
          else loadMsg = 'Clasificando según Normas CNV Estándar...';
          
          setLoadingMsg(loadMsg);
            
          // Pass the stored custom regulations OR Global Standard
          const classifiedAccounts = await classifyAccounts(
              rawAccounts, 
              client.customRegulations, 
              globalModel
          );
          
          setAccounts(classifiedAccounts);
          
          const updatedClient = {
            ...client,
            accounts: classifiedAccounts,
            files: [...client.files, { name: file.name, date: new Date().toISOString(), type: file.type }],
            lastUpdated: new Date().toISOString()
          };
          onSave(updatedClient);
          setTab('CLASSIFICATION');
      } catch (innerError: any) {
           alert(`Error al procesar el archivo: ${innerError.message}`);
           console.error(innerError);
      } finally {
           setLoading(false);
           if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
        alert("Error crítico al leer el archivo del disco.");
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.readAsDataURL(file);
  };

  // --- File Handling: Regulations ---
  const handleRegulationUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    
    setLoading(true);
    setLoadingMsg(`Procesando Normativa: ${file.name}...`);

    const reader = new FileReader();
    
    reader.onload = async () => {
      try {
          const base64 = (reader.result as string).split(',')[1];
          const mimeType = file.type || 'application/pdf';
          
          // Call service to extract rules
          const extractedRules = await extractRegulatoryRules(base64, mimeType);
          
          const updatedClient = {
              ...client,
              customRegulations: extractedRules
          };
          onSave(updatedClient);
          alert("Normativa procesada correctamente. Los próximos archivos contables que importes se clasificarán usando estas reglas.");
          
      } catch (err: any) {
          alert(`Error al procesar normativa: ${err.message}`);
      } finally {
          setLoading(false);
          if (normInputRef.current) normInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  // --- Manual Editing Functions ---
  const handleAddAccount = () => {
    const newAccount: AccountLine = {
      id: crypto.randomUUID(),
      code: '',
      name: 'Nueva Cuenta',
      debit: 0,
      credit: 0,
      balance: 0,
      type: AccountType.UNCLASSIFIED,
      category: 'Otros',
      isGroup: false,
      manualOverride: true
    };
    setAccounts(prev => [newAccount, ...prev]);
  };

  const handleDeleteAccount = (id: string) => {
    if (window.confirm('¿Estás seguro de eliminar esta línea?')) {
      setAccounts(prev => prev.filter(a => a.id !== id));
    }
  };

  const handleManualEdit = (id: string, field: keyof AccountLine, value: any) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id === id) {
        const updated = { ...acc, [field]: value, manualOverride: true };
        if (field === 'debit' || field === 'credit') {
           const d = field === 'debit' ? (value as number) : (updated.debit || 0);
           const c = field === 'credit' ? (value as number) : (updated.credit || 0);
           updated.balance = d - c;
        }
        return updated;
      }
      return acc;
    }));
  };

  const handleSaveChanges = () => {
    const updatedClient = {
      ...client,
      accounts: accounts,
      lastUpdated: new Date().toISOString()
    };
    onSave(updatedClient);
    alert("Cambios guardados correctamente.");
  };

  // --- Exporting ---
  const exportToExcel = () => {
    // We create the Excel data strictly following the grouped structure used in PDF
    // This ensures Model consistency and removes unclassified or filtered accounts (like 'Overnight' if not in model)
    const wb = XLSX.utils.book_new();
    const data: (string | number)[][] = [];

    // 1. Headers
    data.push(["EMPRESA", client.name]);
    data.push(["CUIT", client.cuit]);
    data.push(["INDUSTRIA", client.industry]);
    data.push(["FECHA", new Date().toLocaleDateString('es-AR')]);
    data.push([]); // Spacer

    // 2. Helper to add sections (Rubros)
    const addExcelSection = (sectionTitle: string, groups: {name: string, accounts: AccountLine[], total: number}[], sectionTotal: number) => {
         data.push([sectionTitle.toUpperCase(), "", ""]); // Section Header (e.g., ACTIVO)
         
         if (groups.length === 0) {
             data.push(["Sin Movimientos", "", ""]);
         }

         groups.forEach(g => {
             // Rubro Header
             data.push([g.name.toUpperCase(), "", ""]); 
             
             // Accounts
             g.accounts.forEach(acc => {
                 // Indent name slightly logic is visual, but here we just put in 2nd column for structure or same column
                 // Let's use Col A for Structure, Col B for Detail Name, Col C for Amount to look professional
                 data.push(["", acc.name, Math.abs(acc.balance)]); 
             });

             // Subtotal Rubro
             data.push(["", `TOTAL ${g.name.toUpperCase()}`, Math.abs(g.total)]);
             data.push([]); // Spacer
         });

         // Section Total
         data.push([`TOTAL ${sectionTitle}`, "", Math.abs(sectionTotal)]);
         data.push([]);
         data.push([]);
    };

    // 3. Build the content
    addExcelSection("ACTIVO", groupedFinancials.assets, groupedFinancials.assetsTotal);
    addExcelSection("PASIVO", groupedFinancials.liabilities, groupedFinancials.liabilitiesTotal);
    
    // Equity needs specific handling for Result of period just like PDF
    data.push(["PATRIMONIO NETO", "", ""]);
    groupedFinancials.equity.forEach(g => {
         data.push([g.name.toUpperCase(), "", ""]);
         g.accounts.forEach(acc => {
             data.push(["", acc.name, Math.abs(acc.balance)]);
         });
         data.push(["", `TOTAL ${g.name.toUpperCase()}`, Math.abs(g.total)]);
         data.push([]);
    });

    // Add Net Result line (mimicking PDF)
    data.push(["RESULTADO DEL EJERCICIO", "", ""]);
    data.push(["", "Ganancia/Pérdida del Periodo", groupedFinancials.netResult]);
    data.push([]);

    const totalPN = groupedFinancials.equityTotal + groupedFinancials.netResult;
    data.push(["TOTAL PATRIMONIO NETO", "", totalPN]);
    data.push([]);
    data.push([]);

    // Final Validation Check
    const totalPasivoPN = groupedFinancials.liabilitiesTotal + totalPN;
    data.push(["TOTAL PASIVO + PATRIMONIO NETO", "", totalPasivoPN]);

    // 4. Create Sheet
    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // Set Column Widths (A=30, B=50, C=20)
    ws['!cols'] = [{ wch: 30 }, { wch: 50 }, { wch: 20 }];

    XLSX.utils.book_append_sheet(wb, ws, "Estados Contables");
    XLSX.writeFile(wb, `AuditAI_${client.name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Balance General - ${client.name}`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 28);
    
    // Prepare data flat list but structured
    const body: any[] = [];
    
    const addSection = (title: string, groups: {name: string, accounts: AccountLine[], total: number}[], total: number) => {
        body.push([{content: title, colSpan: 2, styles: {fillColor: [220, 220, 220], fontStyle: 'bold'}}]);
        groups.forEach(g => {
             body.push([{content: g.name, colSpan: 2, styles: {fontStyle: 'bold', textColor: [0, 0, 100]}}]);
             g.accounts.forEach(acc => {
                 body.push([acc.name, Math.abs(acc.balance).toLocaleString('es-AR', {minimumFractionDigits: 2})]);
             });
             body.push([
                 {content: `TOTAL ${g.name.toUpperCase()}`, styles: {fontStyle: 'bold', halign: 'right'}},
                 {content: Math.abs(g.total).toLocaleString('es-AR', {minimumFractionDigits: 2}), styles: {fontStyle: 'bold'}}
             ]);
        });
        body.push([
            {content: `TOTAL ${title}`, styles: {fillColor: [50, 50, 50], textColor: [255,255,255], fontStyle: 'bold', halign: 'right'}},
            {content: Math.abs(total).toLocaleString('es-AR', {minimumFractionDigits: 2}), styles: {fillColor: [50, 50, 50], textColor: [255,255,255], fontStyle: 'bold'}}
        ]);
        body.push([{content: '', colSpan: 2, styles: {minCellHeight: 5}}]); // Spacer
    };

    addSection('ACTIVO', groupedFinancials.assets, groupedFinancials.assetsTotal);
    addSection('PASIVO', groupedFinancials.liabilities, groupedFinancials.liabilitiesTotal);
    addSection('PATRIMONIO NETO', groupedFinancials.equity, groupedFinancials.equityTotal);

    autoTable(doc, {
      body: body,
      startY: 35,
      columns: [{header: 'Concepto'}, {header: 'Importe'}],
      columnStyles: {
        1: { halign: 'right' }
      }
    });
    
    doc.save(`Reporte_CNV_${client.name}.pdf`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Hidden File Inputs (Always Mounted) */}
      <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept=".pdf,.csv,.xlsx,.xls,.txt" 
          onChange={handleFinancialUpload}
      />
      <input 
          type="file" 
          ref={normInputRef} 
          className="hidden" 
          accept=".pdf,.txt,.docx" 
          onChange={handleRegulationUpload}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{client.name}</h1>
            <p className="text-slate-500 text-sm">CUIT: {client.cuit} • {client.industry}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          
          {/* Global Regulation Button - High Visibility */}
          <button 
             onClick={() => normInputRef.current?.click()}
             className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all shadow-md transform hover:scale-105
                ${client.customRegulations 
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'}
             `}
             title="Cargar Normativa CNV o Plan de Cuentas Personalizado"
          >
             {client.customRegulations ? <CheckCircle size={18} /> : <Upload size={18} />}
             {client.customRegulations ? 'Normativa Activa' : 'SUBIR NORMATIVA'}
          </button>

          <div className="h-8 w-px bg-slate-200 mx-1"></div>

          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            {(['UPLOAD', 'CLASSIFICATION', 'REPORTS', 'EXPORT'] as WorkbenchTab[]).map(t => (
              <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
              >
                  {t === 'UPLOAD' && 'Importar'}
                  {t === 'CLASSIFICATION' && 'Edición'}
                  {t === 'REPORTS' && 'Reportes'}
                  {t === 'EXPORT' && 'Exportar'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col relative mt-4">
        
        {loading && (
          <div className="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center">
            <Loader2 className="animate-spin text-corporate-600 mb-4" size={48} />
            <p className="text-corporate-800 font-medium">{loadingMsg}</p>
          </div>
        )}

        {/* Tab: UPLOAD */}
        {tab === 'UPLOAD' && (
          <div className="flex-1 p-8 bg-slate-50 overflow-y-auto">
            <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
              
              {/* Main Action: Upload Financials */}
              <div className="bg-white border-2 border-dashed border-corporate-200 rounded-xl flex flex-col items-center justify-center p-12 text-center hover:bg-corporate-50/30 transition-colors shadow-sm relative group h-full min-h-[400px]">
                  <div className="w-20 h-20 bg-corporate-100 rounded-full flex items-center justify-center mb-6 text-corporate-600 group-hover:scale-110 transition-transform">
                  <UploadCloud size={40} />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800 mb-2">1. Cargar Sumas y Saldos</h3>
                  <p className="text-slate-500 max-w-sm mb-8">
                      Sube el archivo principal con los datos contables (Excel, CSV, PDF). 
                      El sistema detectará cuentas y saldos automáticamente.
                  </p>
                  
                  <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-corporate-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-corporate-700 transition-colors shadow-lg hover:shadow-xl w-full max-w-xs"
                  >
                      Seleccionar Archivo Contable
                  </button>
              </div>

              {/* Secondary Action: Upload Regulations */}
              <div className={`bg-white border rounded-xl p-8 flex flex-col shadow-sm h-full min-h-[400px] transition-all
                  ${client.customRegulations ? 'border-emerald-200 bg-emerald-50/20' : 'border-indigo-100'}
              `}>
                  <div className="flex items-center gap-3 mb-6 text-indigo-700">
                      <div className="p-3 bg-indigo-100 rounded-lg">
                        <BookOpen size={28} />
                      </div>
                      <h3 className="text-xl font-bold text-slate-900">2. Normativa y Criterios</h3>
                  </div>
                  
                  <div className="flex-1">
                      <p className="text-slate-600 mb-4 leading-relaxed">
                          Si tu cliente requiere un Plan de Cuentas específico (CNV, Seguros, Bancos) o tienes un manual de cuentas propio, cárgalo aquí.
                          <br/><br/>
                          <span className="text-xs text-slate-400">
                            Nota: Si no cargas nada aquí, se usará tu <b>Modelo Estándar Global</b> (definido en Configuración) o el predeterminado.
                          </span>
                      </p>
                      
                      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm mb-6">
                        <h4 className="font-semibold text-slate-800 mb-2">Estado Actual:</h4>
                        {client.customRegulations ? (
                           <div className="flex items-start gap-2 text-emerald-700">
                               <CheckCircle size={16} className="mt-0.5" />
                               <div>
                                 <p className="font-bold">Normativa Específica de Cliente Activa</p>
                                 <p className="opacity-80 text-xs mt-1">Anula el modelo global.</p>
                                </div>
                           </div>
                        ) : globalModel ? (
                            <div className="flex items-start gap-2 text-sky-700">
                                <CheckCircle size={16} className="mt-0.5" />
                                <div>
                                    <p className="font-bold">Usando Modelo Estándar Global</p>
                                    <p className="opacity-80 text-xs mt-1">Tu modelo personalizado por defecto.</p>
                                </div>
                            </div>
                        ) : (
                           <div className="flex items-start gap-2 text-slate-500">
                               <AlertCircle size={16} className="mt-0.5" />
                               <p>Utilizando Normativa Estándar CNV (General).</p>
                           </div>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 mb-2">Formatos soportados: PDF, TXT, DOCX.</p>
                  </div>

                  <button 
                      onClick={() => normInputRef.current?.click()}
                      className={`w-full py-3 rounded-lg font-bold border transition-colors flex items-center justify-center gap-2
                          ${client.customRegulations 
                              ? 'bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50' 
                              : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 shadow-md'}
                      `}
                  >
                      {client.customRegulations ? (
                          <>
                            <BookOpen size={18} /> Reemplazar Normativa
                          </>
                      ) : (
                          <>
                            <Upload size={18} /> CARGAR NORMATIVA ESPECÍFICA
                          </>
                      )}
                  </button>
              </div>

            </div>
          </div>
        )}

        {/* Tab: CLASSIFICATION (Editor) */}
        {tab === 'CLASSIFICATION' && (
          <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
              <div className="flex items-center gap-4">
                 <button 
                   onClick={handleAddAccount}
                   className="flex items-center gap-2 bg-corporate-600 hover:bg-corporate-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium text-sm shadow-sm"
                 >
                   <Plus size={16} /> Agregar Cuenta
                 </button>
                 <div className="h-6 w-px bg-slate-200"></div>
                 <div className={`flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full border ${inconsistencies.length > 0 ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-green-50 text-green-600 border-green-200'}`}>
                    <AlertCircle size={16} />
                    {inconsistencies.length > 0 ? `${inconsistencies.length} Alertas` : 'Balanceado'}
                 </div>
              </div>
              
              <div className="flex items-center gap-3">
                
                {/* Inline Regulation Button for Editor */}
                <button 
                  onClick={() => normInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100"
                  title="Cambiar Normativa de Clasificación"
                >
                    <BookOpen size={14} /> 
                    {client.customRegulations ? 'Normativa: Específica' : globalModel ? 'Normativa: Tu Estándar' : 'Normativa: CNV General'}
                </button>

                <button 
                    onClick={handleSaveChanges}
                    className="flex items-center gap-2 text-corporate-700 hover:bg-corporate-50 px-3 py-1.5 rounded-lg transition-colors font-medium text-sm"
                >
                    <Save size={16} /> Guardar Cambios
                </button>
              </div>
            </div>

            {/* Inconsistencies Banner */}
            {inconsistencies.length > 0 && (
              <div className="bg-amber-50 border-b border-amber-100 p-3 shrink-0">
                {inconsistencies.map(inc => (
                  <div key={inc.id} className="text-xs text-amber-800 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                    {inc.message}
                  </div>
                ))}
              </div>
            )}

            {/* Data Grid */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm text-xs uppercase text-slate-500 font-semibold">
                  <tr>
                    <th className="p-3 border-b border-r border-slate-200 w-24">Código</th>
                    <th className="p-3 border-b border-r border-slate-200 min-w-[200px]">Cuenta</th>
                    <th className="p-3 border-b border-r border-slate-200 w-32">Rubro</th>
                    <th className="p-3 border-b border-r border-slate-200 w-32 text-right">Debe</th>
                    <th className="p-3 border-b border-r border-slate-200 w-32 text-right">Haber</th>
                    <th className="p-3 border-b border-r border-slate-200 w-32 text-right font-bold text-slate-700">Saldo</th>
                    <th className="p-3 border-b border-r border-slate-200 w-48">Clasificación</th>
                    <th className="p-3 border-b border-slate-200 w-12 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map(acc => (
                    <tr key={acc.id} className={`hover:bg-slate-50 group ${acc.isGroup ? 'bg-slate-100/50' : ''}`}>
                      <td className="p-1 border-r border-slate-100">
                         <input 
                           value={acc.code} 
                           onChange={(e) => handleManualEdit(acc.id, 'code', e.target.value)}
                           className={`w-full px-2 py-1 bg-transparent outline-none rounded font-mono text-slate-600 text-xs ${acc.isGroup ? 'font-bold' : ''}`}
                           placeholder="S/C"
                         />
                      </td>
                      <td className="p-1 border-r border-slate-100">
                        <input 
                          value={acc.name} 
                          onChange={(e) => handleManualEdit(acc.id, 'name', e.target.value)}
                          className={`w-full px-2 py-1 bg-transparent outline-none rounded text-slate-800 ${acc.isGroup ? 'font-bold uppercase tracking-wide' : 'font-medium'}`}
                        />
                      </td>
                      <td className="p-1 border-r border-slate-100">
                         <input 
                           value={acc.category} 
                           onChange={(e) => handleManualEdit(acc.id, 'category', e.target.value)}
                           className="w-full px-2 py-1 bg-transparent outline-none rounded text-xs text-slate-600"
                         />
                      </td>
                      <td className="p-1 border-r border-slate-100">
                        <input 
                           type="number"
                           value={acc.debit || ''}
                           onChange={(e) => handleManualEdit(acc.id, 'debit', parseFloat(e.target.value) || 0)}
                           className="w-full px-2 py-1 bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-corporate-200 rounded text-right font-mono text-slate-600"
                           placeholder="0.00"
                        />
                      </td>
                      <td className="p-1 border-r border-slate-100">
                        <input 
                           type="number"
                           value={acc.credit || ''}
                           onChange={(e) => handleManualEdit(acc.id, 'credit', parseFloat(e.target.value) || 0)}
                           className="w-full px-2 py-1 bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-corporate-200 rounded text-right font-mono text-slate-600"
                           placeholder="0.00"
                        />
                      </td>
                      <td className="p-1 border-r border-slate-100 bg-slate-50">
                        <input 
                           type="number"
                           value={acc.balance}
                           onChange={(e) => handleManualEdit(acc.id, 'balance', parseFloat(e.target.value))}
                           className={`w-full px-2 py-1 bg-transparent outline-none text-right font-mono font-bold ${acc.balance < 0 ? 'text-red-600' : 'text-slate-800'}`}
                        />
                      </td>
                      <td className="p-1 border-r border-slate-100">
                        <select 
                          value={acc.type}
                          onChange={(e) => handleManualEdit(acc.id, 'type', e.target.value)}
                          className={`w-full text-xs font-medium px-2 py-1.5 rounded border-0 outline-none cursor-pointer appearance-none
                            ${acc.type === AccountType.ASSET ? 'bg-green-100 text-green-800' : ''}
                            ${acc.type === AccountType.LIABILITY ? 'bg-red-100 text-red-800' : ''}
                            ${acc.type === AccountType.EQUITY ? 'bg-blue-100 text-blue-800' : ''}
                            ${acc.type === AccountType.REVENUE ? 'bg-teal-100 text-teal-800' : ''}
                            ${acc.type === AccountType.EXPENSE ? 'bg-orange-100 text-orange-800' : ''}
                            ${acc.type === AccountType.UNCLASSIFIED ? 'bg-gray-200 text-gray-600' : ''}
                          `}
                        >
                          {Object.values(AccountType).map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1 text-center">
                        <button 
                            onClick={() => handleDeleteAccount(acc.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                            title="Eliminar cuenta"
                        >
                            <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {accounts.length === 0 && (
                      <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-400">
                              No hay cuentas registradas. Importa un archivo o agrega una manualmente.
                          </td>
                      </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: REPORTS (VERTICAL BALANCE SHEET) */}
        {tab === 'REPORTS' && (
          <div className="flex-1 overflow-auto bg-gray-100 p-8 flex justify-center">
            {/* Paper Container */}
            <div className="w-full max-w-4xl bg-white shadow-xl min-h-[29.7cm] p-12 text-slate-900 relative">
                
                <button 
                    onClick={() => window.print()} 
                    className="absolute top-8 right-8 print:hidden text-slate-400 hover:text-slate-800 transition-colors"
                >
                    <Printer size={24} />
                </button>

                {/* Header */}
                <div className="text-center mb-10 border-b-2 border-slate-900 pb-6">
                    <h2 className="text-3xl font-bold uppercase tracking-widest mb-2">{client.name}</h2>
                    <p className="text-sm font-semibold uppercase text-slate-500 tracking-wide">
                        Estados Contables al {new Date().toLocaleDateString('es-AR')}
                    </p>
                </div>

                {/* Vertical Balance Structure */}
                <div className="space-y-12">
                    
                    {/* ACTIVO */}
                    <section>
                        <h3 className="text-xl font-bold bg-slate-800 text-white p-2 pl-4 uppercase tracking-widest mb-4">
                            ACTIVO
                        </h3>
                        <div className="pl-4 pr-2 space-y-6">
                            {groupedFinancials.assets.map((rubro) => (
                                <div key={rubro.name}>
                                    <h4 className="font-bold text-slate-800 uppercase border-b border-slate-300 mb-2">
                                        {rubro.name}
                                    </h4>
                                    <table className="w-full text-sm mb-2">
                                        <tbody>
                                            {rubro.accounts.map(acc => (
                                                <tr key={acc.id} className="border-b border-dashed border-slate-100">
                                                    <td className="py-1 pl-2 text-slate-600">{acc.name}</td>
                                                    <td className="py-1 text-right font-mono text-slate-500">
                                                        {Math.abs(acc.balance).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr className="font-bold text-slate-800 bg-slate-50">
                                                <td className="py-1 pl-2 text-right uppercase text-xs pt-2">Total {rubro.name}</td>
                                                <td className="py-1 text-right font-mono pt-2">
                                                    {Math.abs(rubro.total).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 flex justify-between items-center bg-slate-100 p-3 border-t-2 border-slate-800 font-bold text-lg">
                            <span>TOTAL ACTIVO</span>
                            <span>$ {groupedFinancials.assetsTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                        </div>
                    </section>

                    {/* PASIVO */}
                    <section>
                        <h3 className="text-xl font-bold bg-slate-800 text-white p-2 pl-4 uppercase tracking-widest mb-4">
                            PASIVO
                        </h3>
                        <div className="pl-4 pr-2 space-y-6">
                            {groupedFinancials.liabilities.map((rubro) => (
                                <div key={rubro.name}>
                                    <h4 className="font-bold text-slate-800 uppercase border-b border-slate-300 mb-2">
                                        {rubro.name}
                                    </h4>
                                    <table className="w-full text-sm mb-2">
                                        <tbody>
                                            {rubro.accounts.map(acc => (
                                                <tr key={acc.id} className="border-b border-dashed border-slate-100">
                                                    <td className="py-1 pl-2 text-slate-600">{acc.name}</td>
                                                    <td className="py-1 text-right font-mono text-slate-500">
                                                        {Math.abs(acc.balance).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr className="font-bold text-slate-800 bg-slate-50">
                                                <td className="py-1 pl-2 text-right uppercase text-xs pt-2">Total {rubro.name}</td>
                                                <td className="py-1 text-right font-mono pt-2">
                                                    {Math.abs(rubro.total).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            ))}
                            {groupedFinancials.liabilities.length === 0 && (
                                <p className="italic text-slate-400">Sin Movimientos de Pasivo.</p>
                            )}
                        </div>
                        <div className="mt-4 flex justify-between items-center bg-slate-100 p-3 border-t-2 border-slate-800 font-bold text-lg">
                            <span>TOTAL PASIVO</span>
                            <span>$ {groupedFinancials.liabilitiesTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                        </div>
                    </section>

                    {/* PATRIMONIO NETO */}
                    <section>
                        <h3 className="text-xl font-bold bg-slate-800 text-white p-2 pl-4 uppercase tracking-widest mb-4">
                            PATRIMONIO NETO
                        </h3>
                        <div className="pl-4 pr-2 space-y-6">
                            {groupedFinancials.equity.map((rubro) => (
                                <div key={rubro.name}>
                                    <h4 className="font-bold text-slate-800 uppercase border-b border-slate-300 mb-2">
                                        {rubro.name}
                                    </h4>
                                    <table className="w-full text-sm mb-2">
                                        <tbody>
                                            {rubro.accounts.map(acc => (
                                                <tr key={acc.id} className="border-b border-dashed border-slate-100">
                                                    <td className="py-1 pl-2 text-slate-600">{acc.name}</td>
                                                    <td className="py-1 text-right font-mono text-slate-500">
                                                        {Math.abs(acc.balance).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr className="font-bold text-slate-800 bg-slate-50">
                                                <td className="py-1 pl-2 text-right uppercase text-xs pt-2">Total {rubro.name}</td>
                                                <td className="py-1 text-right font-mono pt-2">
                                                    {Math.abs(rubro.total).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            ))}

                            {/* Resultado del Ejercicio Injection */}
                            <div>
                                <h4 className="font-bold text-slate-800 uppercase border-b border-slate-300 mb-2">
                                    Resultado del Ejercicio
                                </h4>
                                <table className="w-full text-sm">
                                    <tbody>
                                         <tr className="font-bold text-slate-800 bg-slate-50">
                                            <td className="py-1 pl-2 text-right uppercase text-xs pt-2">Ganancia/Pérdida del Periodo</td>
                                            <td className="py-1 text-right font-mono pt-2">
                                                {groupedFinancials.netResult.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                        </div>
                        <div className="mt-4 flex justify-between items-center bg-slate-100 p-3 border-t-2 border-slate-800 font-bold text-lg">
                            <span>TOTAL PATRIMONIO NETO</span>
                            <span>$ {(groupedFinancials.equityTotal + groupedFinancials.netResult).toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                        </div>
                    </section>
                    
                    {/* TOTAL PASIVO + PN CHECK */}
                    <div className="mt-8 flex justify-between items-center bg-slate-900 text-white p-4 font-bold text-xl uppercase tracking-widest">
                         <span>Total Pasivo + P.N.</span>
                         <span>$ {(groupedFinancials.liabilitiesTotal + groupedFinancials.equityTotal + groupedFinancials.netResult).toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                    </div>

                </div>
                
                {/* Signatures */}
                <div className="mt-24 pt-8 border-t border-slate-200 grid grid-cols-3 gap-8 text-center break-inside-avoid">
                    <div className="pt-8 border-t border-slate-400 mx-4">
                        <p className="text-xs uppercase font-bold">Presidente</p>
                    </div>
                    <div className="pt-8 border-t border-slate-400 mx-4">
                        <p className="text-xs uppercase font-bold">Síndico</p>
                    </div>
                    <div className="pt-8 border-t border-slate-400 mx-4">
                        <p className="text-xs uppercase font-bold">Auditor Externo</p>
                    </div>
                </div>

            </div>
          </div>
        )}

        {/* Tab: EXPORT */}
        {tab === 'EXPORT' && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 gap-6">
            <h3 className="text-xl font-bold text-slate-800">Exportar Reportes Finales</h3>
            <p className="text-slate-500 max-w-lg text-center">
              Genera los archivos finales para presentar ante la CNV o para archivo interno.
              Los reportes incluyen las marcas de auditoría y notas generadas.
            </p>
            
            <div className="flex gap-4">
              <button 
                onClick={exportToPDF}
                className="flex items-center gap-3 bg-red-600 hover:bg-red-700 text-white px-6 py-4 rounded-xl shadow-lg hover:shadow-xl transition-all"
              >
                <FileText size={24} />
                <div>
                  <div className="font-bold">Descargar PDF</div>
                  <div className="text-xs opacity-80">Formato Presentación</div>
                </div>
              </button>

              <button 
                onClick={exportToExcel}
                className="flex items-center gap-3 bg-green-600 hover:bg-green-700 text-white px-6 py-4 rounded-xl shadow-lg hover:shadow-xl transition-all"
              >
                <FileSpreadsheet size={24} />
                <div>
                  <div className="font-bold">Descargar Excel</div>
                  <div className="text-xs opacity-80">Planillas de Trabajo</div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FinancialWorkspace;