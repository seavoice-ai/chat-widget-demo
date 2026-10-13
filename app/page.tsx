import { ChatWidget } from './components/chat-widget';
import { CodePanel } from './components/code-panel';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Chat widget demo</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          A live chat with a Seavoice AI agent, plus the exact code you&apos;d copy into your own
          site to embed it.
        </p>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
        <ChatWidget />
        <CodePanel />
      </div>
    </main>
  );
}
