import { ArrowLeft, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import InstallAppCard from '../components/InstallAppCard';

export default function InstallPage() {
  return (
    <Layout>
      <div className="max-w-2xl space-y-6">
        <PageHeader
          title="Install app"
          description="Add KurdLogs to your phone home screen or desktop for one-tap access."
          leading={
            <Link
              to="/"
              className="p-2.5 shrink-0 hover:bg-[#1a1a1a] rounded-md transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </Link>
          }
        />

        <InstallAppCard />

        <div className="bg-[#111] border border-[#333] rounded-lg p-5 text-sm text-gray-400 space-y-3">
          <p className="text-white font-medium flex items-center gap-2">
            <Download className="w-4 h-4" />
            Requirements
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-xs">
            <li>
              <strong className="text-gray-300">Same network / localhost:</strong> HTTP on{' '}
              <code className="text-gray-300">localhost</code> works for install on PC.
            </li>
            <li>
              <strong className="text-gray-300">Phone or remote PC:</strong> use HTTPS (TLS) on your
              server IP or domain — browsers block install over plain HTTP except localhost.
            </li>
            <li>Use Chrome, Edge, or Safari — Firefox has limited PWA install support.</li>
            <li>After install, open KurdLogs from your home screen or app list, then sign in.</li>
          </ul>
        </div>
      </div>
    </Layout>
  );
}
