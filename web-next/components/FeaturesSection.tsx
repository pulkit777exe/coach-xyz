const FeaturesSection = () => {
  const features = [
    {
      icon: '🎯',
      title: 'Form Scoring',
      description: 'Every shot gets a 1–10 form score based on biomechanics — stance, release, follow-through, and more.'
    },
    {
      icon: '⏱️',
      title: 'Precise Timestamps',
      description: 'Every event is pinned to the exact frame. Jump straight to any moment in your video.'
    },
    {
      icon: '🎬',
      title: 'Annotated Video',
      description: 'Get back the original video with overlaid stats, feedback captions, and a session summary screen.'
    },
    {
      icon: '🏀',
      title: 'Multi-Sport',
      description: 'Auto-detects basketball, football (soccer), and cricket. One upload — sport-specific feedback.'
    },
    {
      icon: '💬',
      title: 'Actionable Feedback',
      description: 'Not just scores — specific coaching cues for each event that tell you exactly what to fix.'
    },
    {
      icon: '📈',
      title: 'Session Summary',
      description: 'Strengths, recurring issues, and your #1 drill to work on before the next session.'
    }
  ];

  return (
    <section id="features" className="py-20 bg-gray-900">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <div className="text-indigo-500 text-sm font-semibold uppercase tracking-wider mb-2">
            Why CoachAI
          </div>
          <h2 className="text-4xl font-bold mb-4">Built for Serious Athletes</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div key={index} className="bg-gray-800/50 border border-gray-700 rounded-xl p-8 hover:border-indigo-500/30 transition-all duration-300">
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
              <p className="text-gray-400 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
