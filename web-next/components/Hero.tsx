'use client';

const Hero = () => {
  return (
    <section className="min-h-screen flex items-center justify-center relative overflow-hidden pt-20">
      {/* Background gradients */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 w-full h-full bg-linear-to-br from-indigo-900/20 via-purple-900/10 to-transparent" />
        <div className="absolute top-0 right-0 w-full h-full bg-linear-to-bl from-cyan-900/20 via-blue-900/10 to-transparent" />
      </div>

      <div className="container mx-auto px-6 relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-12">
          <div className="flex-1 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-full text-indigo-400 text-sm font-semibold mb-6">
              <span>Powered by Google Gemini AI</span>
            </div>

            <h1 className="text-5xl lg:text-7xl font-bold mb-6 leading-tight">
              AI Sports <br />
              <span className="bg-linear-to-r from-indigo-500 to-cyan-500 bg-clip-text text-transparent">
                Coach in Your Pocket
              </span>
            </h1>

            <p className="text-xl text-gray-400 mb-8 leading-relaxed">
              Upload any basketball, football, or cricket video. Get instant form scores, 
              shot-by-shot feedback, and a professionally annotated video — all in under 60 seconds.
            </p>

            <div className="flex flex-wrap gap-4 justify-center lg:justify-start mb-8">
              <span className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-full text-sm font-medium">
                🏀 Basketball
              </span>
              <span className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-full text-sm font-medium">
                ⚽ Football
              </span>
              <span className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-full text-sm font-medium">
                🏏 Cricket
              </span>
            </div>

            <a 
              href="#upload"
              className="inline-flex items-center gap-2 px-8 py-4 bg-linear-to-r from-indigo-600 to-cyan-600 hover:from-indigo-700 hover:to-cyan-700 rounded-lg font-semibold text-lg transition-all duration-300"
            >
              <span>Analyze My Video</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>

          <div className="flex-1 flex flex-col gap-6">
            {/* Stats cards */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-linear-to-r from-indigo-500 to-purple-500 flex items-center justify-center text-xl">
                  🎯
                </div>
                <div>
                  <div className="text-3xl font-bold">9.2</div>
                  <div className="text-gray-400 text-sm">Form Score</div>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-linear-to-r from-green-500 to-emerald-500 flex items-center justify-center text-xl">
                  ✅
                </div>
                <div>
                  <div className="text-3xl font-bold">87%</div>
                  <div className="text-gray-400 text-sm">Success Rate</div>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-linear-to-r from-amber-500 to-orange-500 flex items-center justify-center text-xl">
                  ⚡
                </div>
                <div>
                  <div className="text-3xl font-bold">Elite</div>
                  <div className="text-gray-400 text-sm">Rating</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
