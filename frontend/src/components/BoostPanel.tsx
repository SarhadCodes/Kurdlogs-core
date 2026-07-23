import React, { useEffect, useState } from 'react';
import {
  Plus,
  Server,
  Copy,
  Trash2,
  RefreshCw,
  Zap,
  Cpu,
  Radio,
  KeyRound,
  CircleDot,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { boostApi } from '../services/api';
import type { BoostNode, BoostNodeStatus, BoostSummary } from '../types';
import LoadingSpinner from './LoadingSpinner';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';

const STATUS_STYLE: Record<BoostNodeStatus, string> = {
  ONLINE: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  PENDING: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  OFFLINE: 'text-gray-400 bg-gray-400/10 border-gray-500/30',
  ERROR: 'text-red-400 bg-red-400/10 border-red-400/30',
};

export default function BoostPanel() {
  const [nodes, setNodes] = useState<BoostNode[]>([]);
  const [summary, setSummary] = useState<BoostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const [formName, setFormName] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formPort, setFormPort] = useState('8443');
  const [formEncode, setFormEncode] = useState(true);
  const [formStream, setFormStream] = useState(true);
  const [formMaxChannels, setFormMaxChannels] = useState('4');
  const [formNotes, setFormNotes] = useState('');

  const coreUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const fetchNodes = async () => {
    try {
      const res = await boostApi.getNodes();
      setNodes(res.data?.nodes || []);
      setSummary(res.data?.summary || null);
    } catch {
      toast.error('Failed to load Boost nodes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
    const interval = setInterval(() => fetchNodes(), 30_000);
    return () => clearInterval(interval);
  }, []);

  const buildInstallCommand = (node: BoostNode) =>
    `curl -fsSL "${coreUrl}/api/monitoring/boost/install.sh" | bash -s -- --core ${coreUrl} --key ${node.secretKey}`;

  const resetForm = () => {
    setFormName('');
    setFormHost('');
    setFormPort('8443');
    setFormEncode(true);
    setFormStream(true);
    setFormMaxChannels('4');
    setFormNotes('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formHost.trim()) {
      toast.error('Name and host are required');
      return;
    }
    if (!formEncode && !formStream) {
      toast.error('Select at least encoding or streaming');
      return;
    }

    setCreating(true);
    try {
      await boostApi.createNode({
        name: formName.trim(),
        host: formHost.trim(),
        port: parseInt(formPort, 10) || 8443,
        encode: formEncode,
        stream: formStream,
        maxChannels: parseInt(formMaxChannels, 10) || 4,
        notes: formNotes.trim() || undefined,
      });
      toast.success('Boost node added');
      setShowModal(false);
      resetForm();
      await fetchNodes();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add node');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await boostApi.deleteNode(deleteId);
      toast.success('Node removed');
      setDeleteId(null);
      await fetchNodes();
    } catch {
      toast.error('Failed to remove node');
    } finally {
      setDeleting(false);
    }
  };

  const handleRegenerateKey = async (id: string) => {
    setRegeneratingId(id);
    try {
      const res = await boostApi.regenerateKey(id);
      if (res.data) {
        setNodes((prev) => prev.map((n) => (n.id === id ? res.data! : n)));
        setRevealedKeys((prev) => new Set(prev).add(id));
        toast.success('New node key generated');
      }
    } catch {
      toast.error('Failed to regenerate key');
    } finally {
      setRegeneratingId(null);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
  };

  const toggleKeyVisibility = (id: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[#333] bg-[#111] p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Boost — distributed workers
            </h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              Connect extra VPS servers to share encoding and streaming load. Add a node here, then
              run the install command on your VPS — it will show <span className="text-emerald-400">ONLINE</span> within ~30 seconds.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-white text-black rounded-md hover:bg-gray-200 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add VPS node
          </button>
        </div>

        <ol className="mt-5 space-y-2 text-sm text-gray-400 list-decimal list-inside border-t border-[#333] pt-4">
          <li>Add a node with your VPS IP/hostname</li>
          <li>SSH into the VPS as root</li>
          <li>Copy the install command from the node card and run it</li>
          <li>Refresh — status should become ONLINE</li>
        </ol>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total nodes" value={summary?.total ?? 0} />
        <StatCard label="Online" value={summary?.online ?? 0} accent="text-emerald-400" />
        <StatCard label="Encode capacity" value={summary?.encodeCapacity ?? 0} suffix="ch" />
        <StatCard label="Stream capacity" value={summary?.streamCapacity ?? 0} suffix="ch" />
      </div>

      <div className="rounded-lg border border-[#333] bg-[#111] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#333] flex items-center justify-between gap-3">
          <h3 className="font-medium text-white flex items-center gap-2">
            <Server className="w-4 h-4" />
            Worker nodes
          </h3>
          <button
            type="button"
            onClick={() => fetchNodes()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[#333] rounded-md text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {nodes.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={<Server className="w-12 h-12" />}
              title="No Boost nodes yet"
              description="Add a VPS to prepare for distributed encoding and streaming."
              action={
                <button
                  type="button"
                  onClick={() => setShowModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-white text-black rounded-md"
                >
                  <Plus className="w-4 h-4" />
                  Add VPS node
                </button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-[#333]">
            {nodes.map((node) => (
              <li key={node.id} className="p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium text-white">{node.name}</h4>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${STATUS_STYLE[node.status]}`}
                      >
                        {node.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1 font-mono">
                      {node.host}:{node.port}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {node.encode && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400 border border-[#333] rounded px-2 py-0.5">
                          <Cpu className="w-3 h-3" /> Encode · {node.maxChannels} ch
                        </span>
                      )}
                      {node.stream && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400 border border-[#333] rounded px-2 py-0.5">
                          <Radio className="w-3 h-3" /> Stream · {node.maxChannels} ch
                        </span>
                      )}
                    </div>
                    {node.notes && (
                      <p className="text-xs text-gray-500 mt-2">{node.notes}</p>
                    )}
                    {node.status === 'ONLINE' && (
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        {node.workerHostname && (
                          <span>Worker: <span className="text-gray-300 font-mono">{node.workerHostname}</span></span>
                        )}
                        {node.workerCpu != null && (
                          <span>CPU: <span className="text-gray-300">{node.workerCpu.toFixed(0)}%</span></span>
                        )}
                        {node.workerRam != null && (
                          <span>RAM: <span className="text-gray-300">{node.workerRam.toFixed(0)}%</span></span>
                        )}
                        {node.lastSeenAt && (
                          <span>Last seen: <span className="text-gray-300">{new Date(node.lastSeenAt).toLocaleTimeString()}</span></span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRegenerateKey(node.id)}
                      disabled={regeneratingId === node.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[#333] rounded-md text-gray-400 hover:text-white disabled:opacity-50"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      New key
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(node.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[#333] rounded-md text-gray-400 hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-[#333] bg-black p-3 space-y-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">
                    Install on VPS (run as root)
                  </p>
                  <div className="relative">
                    <pre className="text-[11px] leading-relaxed text-gray-300 font-mono whitespace-pre-wrap break-all bg-[#0a0a0a] border border-[#333] rounded-md p-3 pr-10">
                      {buildInstallCommand(node)}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyText(buildInstallCommand(node), 'Install command')}
                      className="absolute top-2 right-2 p-1.5 text-gray-500 hover:text-white rounded border border-[#333] bg-black"
                      title="Copy install command"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 text-xs">
                    <div>
                      <span className="text-gray-500">Core URL</span>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 truncate text-gray-300 font-mono">{coreUrl}</code>
                        <button
                          type="button"
                          onClick={() => copyText(coreUrl, 'Core URL')}
                          className="p-1 text-gray-500 hover:text-white"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-500">Node key</span>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 truncate text-emerald-400/90 font-mono">
                          {revealedKeys.has(node.id)
                            ? node.secretKey
                            : '••••••••••••••••••••••••••••••••••••••••'}
                        </code>
                        <button
                          type="button"
                          onClick={() => toggleKeyVisibility(node.id)}
                          className="p-1 text-gray-500 hover:text-white"
                          aria-label="Toggle key visibility"
                        >
                          <CircleDot className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => copyText(node.secretKey, 'Node key')}
                          className="p-1 text-gray-500 hover:text-white"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); resetForm(); }} title="Add Boost VPS node">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Node name">
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="EU Encoder 1"
              className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white text-sm focus:outline-none focus:border-gray-500"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Host / IP" className="sm:col-span-2">
              <input
                value={formHost}
                onChange={(e) => setFormHost(e.target.value)}
                placeholder="vps.example.com"
                className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white text-sm focus:outline-none focus:border-gray-500"
              />
            </Field>
            <Field label="Port">
              <input
                value={formPort}
                onChange={(e) => setFormPort(e.target.value)}
                type="number"
                min={1}
                max={65535}
                className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white text-sm focus:outline-none focus:border-gray-500"
              />
            </Field>
          </div>
          <Field label="Max channels per node">
            <input
              value={formMaxChannels}
              onChange={(e) => setFormMaxChannels(e.target.value)}
              type="number"
              min={1}
              max={64}
              className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white text-sm focus:outline-none focus:border-gray-500"
            />
          </Field>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={formEncode}
                onChange={(e) => setFormEncode(e.target.checked)}
                className="accent-white"
              />
              Encoding worker
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={formStream}
                onChange={(e) => setFormStream(e.target.checked)}
                className="accent-white"
              />
              Streaming worker
            </label>
          </div>
          <Field label="Notes (optional)">
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
              placeholder="Hetzner Helsinki, 8 vCPU"
              className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white text-sm focus:outline-none focus:border-gray-500 resize-none"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setShowModal(false); resetForm(); }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 text-sm bg-white text-black rounded-md hover:bg-gray-200 disabled:opacity-50"
            >
              {creating ? 'Adding…' : 'Add node'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        title="Remove Boost node?"
        message="This VPS will no longer be registered for distributed workloads."
        confirmLabel="Remove"
        onConfirm={handleDelete}
        onClose={() => setDeleteId(null)}
        loading={deleting}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  accent = 'text-white',
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-[#333] bg-[#111] p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-mono font-semibold ${accent}`}>
        {value}
        {suffix && <span className="text-sm text-gray-500 ml-1">{suffix}</span>}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="text-xs text-gray-400">{label}</span>
      {children}
    </label>
  );
}
