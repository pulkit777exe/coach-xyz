'use client';

import { useState, useEffect } from 'react';

const Navbar = () => {
  const [apiStatus, setApiStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');

  useEffect(() => {
    const checkApiStatus = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/health`, {
          signal: AbortSignal.timeout(4000)
        });
        setApiStatus(res.ok ? 'online' : 'offline');
      } catch {
        setApiStatus('offline');
      }
    };

    checkApiStatus();
    const interval = setInterval(checkApiStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900/90 backdrop-blur-md border-b border-gray-800">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚡</span>
            <span className="text-xl font-bold">CoachAI</span>
          </div>

          <div className="flex items-center gap-6 text-sm text-gray-400">
            <a href="#upload" className="hover:text-white transition-colors">Analyze</a>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            
            <div className={`flex items-center gap-2 text-xs font-medium ${
              apiStatus === 'online' ? 'text-green-500' : 
              apiStatus === 'offline' ? 'text-red-500' : 'text-gray-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                apiStatus === 'online' ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]' : 
                apiStatus === 'offline' ? 'bg-red-500' : 'bg-gray-400'
              }`} />
              {apiStatus === 'online' ? 'API Connected' : 
               apiStatus === 'offline' ? 'API Offline' : 'Connecting…'}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
