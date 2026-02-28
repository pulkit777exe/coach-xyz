'use client';

import { useState, useRef } from 'react';

interface UploadSectionProps {
  onFileSelect: (file: File | null) => void;
  onStartAnalysis: () => void;
  selectedFile: File | null;
}

const UploadSection = ({ onFileSelect, onStartAnalysis, selectedFile }: UploadSectionProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      alert('Please select a video file');
      return;
    }

    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
      alert(`File is too large. Maximum size is 500MB.`);
      return;
    }

    onFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  return (
    <section id="upload" className="py-20 bg-linear-to-b from-gray-900 to-gray-800">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <div className="text-indigo-500 text-sm font-semibold uppercase tracking-wider mb-2">
            Step 1
          </div>
          <h2 className="text-4xl font-bold mb-4">Upload Your Video</h2>
          <p className="text-xl text-gray-400">
            Supports .mp4, .mov, .avi, .mkv · Max 500 MB
          </p>
        </div>

        {!selectedFile ? (
          <div 
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-300 ${
              isDragging 
                ? 'border-indigo-500 bg-indigo-500/10' 
                : 'border-gray-700 bg-gray-800/50 hover:border-indigo-400 hover:bg-gray-800'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleFile(e.target.files[0]);
                }
              }}
            />

            <div className="text-6xl mb-4">🎬</div>
            <h3 className="text-xl font-semibold mb-2">Drag & drop your video here</h3>
            <p className="text-gray-400 mb-6">or</p>
            <button 
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-semibold transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Browse File
            </button>
          </div>
        ) : (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-8">
            <div className="mb-6">
              <video 
                src={URL.createObjectURL(selectedFile)} 
                controls 
                className="w-full max-h-96 rounded-lg bg-black"
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{selectedFile.name}</div>
              </div>
              <div className="text-center">
                <div className="text-lg text-gray-400">{(selectedFile.size / (1024 * 1024)).toFixed(1)} MB</div>
              </div>
              <div className="text-center">
                <div className="text-lg text-gray-400">{selectedFile.type}</div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6 mb-8">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  🎬 Render overlay video
                </label>
                <p className="text-xs text-gray-600 mb-2">Adds AI annotations directly onto your video</p>
                <div className="flex items-center">
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500" />
                </div>
              </div>

              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  AI Model
                </label>
                <select className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (fastest)</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (most accurate)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-center gap-4">
              <button
                onClick={() => onStartAnalysis()}
                className="px-8 py-4 bg-linear-to-r from-indigo-600 to-cyan-600 hover:from-indigo-700 hover:to-cyan-700 rounded-lg font-semibold text-lg transition-all duration-300"
              >
                <span>Start AI Analysis</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>
              
              <button
                onClick={() => onFileSelect(null)}
                className="px-6 py-4 border border-gray-600 text-gray-300 hover:bg-gray-700 rounded-lg font-semibold transition-colors"
              >
                Change File
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default UploadSection;
