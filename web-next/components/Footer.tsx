const Footer = () => {
  return (
    <footer className="py-12 bg-gray-900 border-t border-gray-800">
      <div className="container mx-auto px-6 text-center">
        <div className="flex items-center justify-center gap-2 text-2xl font-bold mb-4">
          <span>⚡</span>
          <span>CoachAI</span>
        </div>
        <p className="text-gray-400 mb-6">
          Powered by <strong className="text-white">Google Gemini AI</strong> · Open Source
        </p>
        <div className="text-sm text-gray-500">
          <p>© 2024 CoachAI. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
