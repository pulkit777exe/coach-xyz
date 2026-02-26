'use client';

interface ProgressSectionProps {
  progress: {
    percent: number;
    icon: string;
    title: string;
    message: string;
    eta?: string;
  };
  onBack: () => void;
}

const ProgressSection = ({ progress, onBack }: ProgressSectionProps) => {
  return (
    <section className="min-h-screen flex items-center justify-center bg-gray-800 py-20">
      <div className="container mx-auto px-6">
        <div className="max-w-2xl mx-auto text-center">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 text-gray-400 hover:text-white transition-colors mb-8"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Upload
          </button>

          <div className="bg-gray-700/50 border border-gray-600 rounded-2xl p-8">
            <div className="text-8xl mb-6">{progress.icon}</div>
            <h2 className="text-3xl font-bold mb-4">{progress.title}</h2>
            <p className="text-xl text-gray-400 mb-8">{progress.message}</p>
            {progress.eta && (
              <p className="text-sm text-cyan-300 mb-8">
                Estimated time remaining: {progress.eta}
              </p>
            )}
            
            <div className="max-w-md mx-auto mb-6">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-400">Progress</span>
                <span className="font-semibold">{progress.percent}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-gradient-to-r from-indigo-500 to-cyan-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-12 text-sm text-gray-500">
            <p>Estimates vary with video length, crowd density, and Gemini queue time.</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProgressSection;
