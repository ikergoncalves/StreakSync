import Hero from './components/Hero';
import Features from './components/Features';
import TechStack from './components/TechStack';
import Screenshots from './components/Screenshots';
import Footer from './components/Footer';

export default function App() {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Hero />
      <main>
        <Features />
        <TechStack />
        <Screenshots />
      </main>
      <Footer />
    </div>
  );
}
