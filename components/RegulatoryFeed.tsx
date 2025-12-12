import React, { useEffect, useState } from 'react';
import { RegulatoryUpdate } from '../types';
import { fetchRegulatoryUpdates } from '../services/geminiService';
import { Globe, RefreshCw, ExternalLink, ShieldAlert } from 'lucide-react';

const RegulatoryFeed: React.FC = () => {
  const [updates, setUpdates] = useState<RegulatoryUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const checkUpdates = async () => {
    setLoading(true);
    const data = await fetchRegulatoryUpdates();
    setUpdates(data);
    setLastChecked(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => {
    // Check on mount if empty
    if (updates.length === 0) {
        checkUpdates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
             <Globe className="text-sky-500" /> Centro de Normativas
          </h1>
          <p className="text-slate-500 mt-2">
            Monitoreo en tiempo real de circulares BCRA y CNV utilizando Gemini Search Grounding.
          </p>
        </div>
        <div className="text-right">
             <button 
               onClick={checkUpdates}
               disabled={loading}
               className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
             >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                {loading ? 'Buscando...' : 'Actualizar Ahora'}
             </button>
             {lastChecked && <p className="text-xs text-slate-400 mt-2">Última revisión: {lastChecked}</p>}
        </div>
      </div>

      <div className="space-y-6">
        {loading && updates.length === 0 && (
            <div className="p-12 text-center text-slate-400">
                <RefreshCw className="animate-spin mx-auto mb-4" size={32} />
                <p>Analizando fuentes oficiales...</p>
            </div>
        )}

        {!loading && updates.length === 0 && (
            <div className="p-8 bg-white rounded-xl border border-slate-200 text-center">
                <p className="text-slate-500">No se encontraron actualizaciones críticas para el día de hoy.</p>
            </div>
        )}

        {updates.map((update, idx) => (
          <div key={idx} className={`bg-white rounded-xl border shadow-sm overflow-hidden flex flex-col md:flex-row
            ${update.impactLevel === 'High' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-blue-400'}
          `}>
             <div className="p-6 flex-1">
                <div className="flex items-center gap-3 mb-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold text-white
                        ${update.source === 'BCRA' ? 'bg-indigo-600' : 'bg-emerald-600'}
                    `}>
                        {update.source}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{update.date}</span>
                    {update.impactLevel === 'High' && (
                        <span className="flex items-center gap-1 text-xs text-red-600 font-bold uppercase">
                            <ShieldAlert size={12} /> Impacto Alto
                        </span>
                    )}
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">{update.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed mb-4">
                    {update.summary}
                </p>
             </div>
          </div>
        ))}
      </div>
      
      <div className="mt-8 p-4 bg-slate-100 rounded-lg text-xs text-slate-500">
        <p>
            <strong>Nota:</strong> Esta información es generada automáticamente por IA buscando en fuentes públicas. 
            Siempre verifique los textos oficiales en los boletines correspondientes antes de tomar decisiones de auditoría.
        </p>
      </div>
    </div>
  );
};

export default RegulatoryFeed;
