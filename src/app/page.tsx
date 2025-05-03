import { Conversation } from './components/conversation';

export default function Home() {
  return (
    <main className="min-h-screen w-full bg-gradient-to-b from-yellow-50 to-orange-100 flex flex-col items-center justify-start">
      <Conversation />
    </main>
  );
}

