import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  FileText, 
  Scale, 
  AlertTriangle, 
  Settings, 
  Plus, 
  ArrowLeft,
  Briefcase,
  Search,
  Save,
  CheckCircle,
  Upload,
  Loader2
} from 'lucide-react';
import { ClientData, ViewState, AccountLine } from './types';
import { classifyAccounts, parseFinancialDocument, fetchRegulatoryUpdates, extractStructureFromExcel } from './services/geminiService';

// Components (Inline for single file structure requirement, effectively separated logic)
import ClientList from './components/ClientList';
import FinancialWorkspace from './components/FinancialWorkspace';
import RegulatoryFeed from './components/RegulatoryFeed';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState | 'SETTINGS'>('DASHBOARD');
  const [clients, setClients] = useState<ClientData[]>([]);
  const [activeClient, setActiveClient] = useState<ClientData | null>(null);
  const [globalModel, setGlobalModel] = useState<string>('');
  const [isSaved, setIsSaved] = useState(false);
  const [isImportingModel, setIsImportingModel] = useState(false);
  const modelInputRef = useRef<HTMLInputElement>(null);
  
  // Load mock data or local storage on mount
  useEffect(() => {
    const storedClients = localStorage.getItem('auditai_clients');
    const storedModel = localStorage.getItem('auditai_global_model');

    if (storedClients) {
      setClients(JSON.parse(storedClients));
    } else {
      // Seed with a demo client
      const demoClient: ClientData = {
        id: '1',
        name: 'Empresa Demo S.A.',
        cuit: '30-12345678-9',
        industry: 'Retail',
        lastUpdated: new Date().toISOString(),
        accounts: [],
        files: [],
        notes: []
      };
      setClients([demoClient]);
      localStorage.setItem('auditai_clients', JSON.stringify([demoClient]));
    }

    if (storedModel) {
      setGlobalModel(storedModel);
    }
  }, []);

  const saveClientData = (updatedClient: ClientData) => {
    const updatedClients = clients.map(c => c.id === updatedClient.id ? updatedClient : c);
    setClients(updatedClients);
    localStorage.setItem('auditai_clients', JSON.stringify(updatedClients));
    setActiveClient(updatedClient);
  };

  const saveGlobalModel = () => {
    localStorage.setItem('auditai_global_model', globalModel);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleCreateClient = (name: string, cuit: string, industry: string) => {
    const newClient: ClientData = {
      id: crypto.randomUUID(),
      name,
      cuit,
      industry,
      lastUpdated: new Date().toISOString(),
      accounts: [],
      files: [],
      notes: []
    };
    const updated = [...clients, newClient];
    setClients(updated);
    localStorage.setItem('auditai_clients', JSON.stringify(updated));
    setActiveClient(newClient);
    setView('CLIENT_WORKBENCH');
  };

  const handleImportModel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    
    setIsImportingModel(true);
    try {
        const reader = new FileReader();
        reader.onload = async () => {
            const base64 = (reader.result as string).split(',')[1];
            // Call the specialized service function
            const extractedModel = await extractStructureFromExcel(base64);
            setGlobalModel(extractedModel);
            setIsImportingModel(false);
            if (modelInputRef.current) modelInputRef.current.value = '';
        };
        reader.readAsDataURL(file);
    } catch (error) {
        console.error(error);
        alert("Error al importar el modelo.");
        setIsImportingModel(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50 font-sans text-slate-800">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col fixed h-full z-10">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <Scale className="text-sky-400" />
            <span>AuditAI <span className="text-sky-400">Pro</span></span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Gestión Contable Inteligente</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button 
            onClick={() => { setView('DASHBOARD'); setActiveClient(null); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${view === 'DASHBOARD' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
          >
            <LayoutDashboard size={20} />
            Dashboard
          </button>
          
          <button 
             onClick={() => setView('REGULATIONS')}
             className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${view === 'REGULATIONS' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
          >
            <Search size={20} />
            Normativas (Live)
          </button>

          <button 
             onClick={() => setView('SETTINGS')}
             className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${view === 'SETTINGS' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
          >
            <Settings size={20} />
            Configuración
          </button>

          <div className="pt-6 pb-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Clientes Recientes
          </div>
          
          {clients.slice(0, 5).map(client => (
            <button
              key={client.id}
              onClick={() => { setActiveClient(client); setView('CLIENT_WORKBENCH'); }}
              className={`w-full flex items-center gap-3 px-4 py-2 text-sm rounded-lg transition-colors ${activeClient?.id === client.id ? 'bg-slate-800 text-sky-400' : 'text-slate-400 hover:text-white'}`}
            >
              <Briefcase size={16} />
              <span className="truncate">{client.name}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800 text-xs text-slate-500 text-center">
          v1.1.0 • Powered by Gemini 2.5
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 p-8 overflow-y-auto h-screen">
        {view === 'DASHBOARD' && (
          <ClientList clients={clients} onCreateClient={handleCreateClient} onSelectClient={(c) => { setActiveClient(c); setView('CLIENT_WORKBENCH'); }} />
        )}

        {view === 'CLIENT_WORKBENCH' && activeClient && (
          <FinancialWorkspace 
            client={activeClient} 
            globalModel={globalModel}
            onSave={saveClientData} 
            onBack={() => { setView('DASHBOARD'); setActiveClient(null); }} 
          />
        )}

        {view === 'REGULATIONS' && (
          <RegulatoryFeed />
        )}

        {view === 'SETTINGS' && (
          <div className="max-w-4xl mx-auto">
             <header className="mb-8">
               <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
                 <Settings className="text-slate-400" /> Configuración Global
               </h1>
               <p className="text-slate-500 mt-2">Define los parámetros que se aplicarán a todos los clientes por defecto.</p>
             </header>

             <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                   <div>
                       <h2 className="text-lg font-bold text-slate-800">Modelo de Balance Estándar ("Tu Estándar")</h2>
                       <p className="text-sm text-slate-500 mt-1">
                         Define aquí los Rubros (Categorías) para la clasificación automática.
                       </p>
                   </div>
                   
                   <div>
                       <input 
                         type="file" 
                         ref={modelInputRef} 
                         className="hidden" 
                         accept=".xlsx,.xls,.csv" 
                         onChange={handleImportModel}
                       />
                       <button 
                         onClick={() => modelInputRef.current?.click()}
                         disabled={isImportingModel}
                         className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
                       >
                         {isImportingModel ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                         {isImportingModel ? 'Analizando Modelo...' : 'Importar desde Excel'}
                       </button>
                   </div>
                </div>
                
                <div className="p-6">
                   <textarea 
                      value={globalModel}
                      onChange={(e) => setGlobalModel(e.target.value)}
                      placeholder={`Ejemplo:
ACTIVO:
- Disponibilidades
- Inversiones Transitorias
- Créditos por Ventas
- Otros Créditos
- Bienes de Cambio
...

PASIVO:
- Deudas Comerciales
...`}
                      className="w-full h-96 p-4 border border-slate-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-sky-500 outline-none resize-none"
                   />
                </div>
                <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end">
                   <button 
                     onClick={saveGlobalModel}
                     className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-white transition-all
                        ${isSaved ? 'bg-green-600' : 'bg-sky-600 hover:bg-sky-700'}
                     `}
                   >
                     {isSaved ? <CheckCircle size={20} /> : <Save size={20} />}
                     {isSaved ? 'Guardado Exitosamente' : 'Guardar Modelo Estándar'}
                   </button>
                </div>
             </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;