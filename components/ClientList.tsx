import React, { useState } from 'react';
import { ClientData } from '../types';
import { Plus, Users, FolderOpen, ArrowRight } from 'lucide-react';

interface Props {
  clients: ClientData[];
  onCreateClient: (name: string, cuit: string, industry: string) => void;
  onSelectClient: (client: ClientData) => void;
}

const ClientList: React.FC<Props> = ({ clients, onCreateClient, onSelectClient }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', cuit: '', industry: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newClient.name) {
      onCreateClient(newClient.name, newClient.cuit, newClient.industry);
      setIsModalOpen(false);
      setNewClient({ name: '', cuit: '', industry: '' });
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Panel de Control</h1>
          <p className="text-slate-500 mt-2">Administra tus clientes y auditorías contables.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-corporate-600 hover:bg-corporate-800 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 shadow-sm transition-all"
        >
          <Plus size={18} />
          Nuevo Cliente
        </button>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
              <Users size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Clientes Activos</p>
              <p className="text-2xl font-bold text-slate-800">{clients.length} / 50</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
              <FolderOpen size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Archivos Procesados</p>
              <p className="text-2xl font-bold text-slate-800">
                {clients.reduce((acc, c) => acc + c.files.length, 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold text-slate-800 mb-4">Cartera de Clientes</h2>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Empresa</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">CUIT</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Industria</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Última Actualización</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.map(client => (
              <tr key={client.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-6 py-4 font-medium text-slate-900">{client.name}</td>
                <td className="px-6 py-4 text-slate-600">{client.cuit}</td>
                <td className="px-6 py-4 text-slate-600">
                  <span className="px-2 py-1 bg-slate-100 rounded text-xs font-medium text-slate-600 border border-slate-200">
                    {client.industry}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-500 text-sm">{new Date(client.lastUpdated).toLocaleDateString()}</td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => onSelectClient(client)}
                    className="text-corporate-600 hover:text-corporate-800 font-medium inline-flex items-center gap-1 group-hover:translate-x-1 transition-transform"
                  >
                    Abrir <ArrowRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                  No hay clientes registrados. Crea uno nuevo para comenzar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-6">Nuevo Cliente</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Razón Social</label>
                <input 
                  type="text" 
                  required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-corporate-500 outline-none"
                  value={newClient.name}
                  onChange={e => setNewClient({...newClient, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">CUIT</label>
                <input 
                  type="text" 
                  required
                  placeholder="XX-XXXXXXXX-X"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-corporate-500 outline-none"
                  value={newClient.cuit}
                  onChange={e => setNewClient({...newClient, cuit: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Industria / Sector</label>
                <input 
                  type="text" 
                  required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-corporate-500 outline-none"
                  value={newClient.industry}
                  onChange={e => setNewClient({...newClient, industry: e.target.value})}
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2 bg-corporate-600 text-white rounded-lg hover:bg-corporate-700"
                >
                  Crear Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientList;
